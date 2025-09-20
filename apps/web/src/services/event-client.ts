import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * JSONRPC 2.0 Types
 */
interface JsonRpcRequest {
	jsonrpc: "2.0";
	method: string;
	params?: any;
	id?: string | number | null;
	metadata?: {
		sessionId?: string;
		correlationId?: string;
		timestamp?: number;
	};
}

interface JsonRpcSuccessResponse {
	jsonrpc: "2.0";
	result: any;
	id: string | number | null;
}

interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	error: {
		code: number;
		message: string;
		data?: any;
	};
	id: string | number | null;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * JSONRPC Error codes
 */
export const JsonRpcErrorCodes = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	// Custom errors
	RATE_LIMIT_EXCEEDED: -32000,
	CIRCUIT_BREAKER_OPEN: -32001,
	UNAUTHORIZED: -32002,
	HOOK_BLOCKED: -32003,
} as const;

/**
 * Event Client Configuration
 */
export interface EventClientConfig {
	apiUrl: string;
	timeout?: number;
	retries?: number;
	sessionId?: string;
}

/**
 * Event Client for ClaudeBench JSONRPC API
 */
export class EventClient {
	private config: Required<EventClientConfig>;
	private requestId: number = 0;

	constructor(config: EventClientConfig) {
		this.config = {
			apiUrl: config.apiUrl,
			timeout: config.timeout ?? 30000,
			retries: config.retries ?? 3,
			sessionId: config.sessionId ?? crypto.randomUUID(),
		};
	}

	/**
	 * Send a JSONRPC request
	 */
	async request<T = any>(method: string, params?: any): Promise<T> {
		const id = ++this.requestId;
		
		// Use longer timeout for context generation and other long-running operations
		const longRunningMethods = ['task.context', 'swarm.context', 'swarm.decompose', 'swarm.synthesize', 'swarm.resolve'];
		const isLongRunning = longRunningMethods.includes(method);
		const originalTimeout = this.config.timeout;
		
		if (isLongRunning) {
			// Use 6 minutes timeout for long-running operations (360 seconds)
			this.config.timeout = 360000;
		}
		
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			method,
			params,
			id,
			metadata: {
				sessionId: this.config.sessionId,
				correlationId: crypto.randomUUID(),
				timestamp: Date.now(),
			},
		};

		let lastError: Error | undefined;
		
		try {
			for (let attempt = 0; attempt <= this.config.retries; attempt++) {
				try {
					const response = await this.sendRequest(request);
					
					if ("error" in response) {
						throw new JsonRpcError(
							response.error.message,
							response.error.code,
							response.error.data
						);
					}
					
					return response.result as T;
				} catch (error) {
					lastError = error as Error;
					
					// Don't retry on certain errors
					if (error instanceof JsonRpcError) {
						if (
							error.code === JsonRpcErrorCodes.METHOD_NOT_FOUND ||
							error.code === JsonRpcErrorCodes.INVALID_PARAMS ||
							error.code === JsonRpcErrorCodes.UNAUTHORIZED ||
							error.code === JsonRpcErrorCodes.HOOK_BLOCKED
						) {
							throw error;
						}
					}
					
					// Wait before retry (exponential backoff)
					if (attempt < this.config.retries) {
						await this.sleep(Math.pow(2, attempt) * 1000);
					}
				}
			}
			
			throw lastError;
		} finally {
			// Restore original timeout
			if (isLongRunning) {
				this.config.timeout = originalTimeout;
			}
		}
	}

	/**
	 * Send a notification (no response expected)
	 */
	async notify(method: string, params?: any): Promise<void> {
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			method,
			params,
			// No ID for notifications
			metadata: {
				sessionId: this.config.sessionId,
				correlationId: crypto.randomUUID(),
				timestamp: Date.now(),
			},
		};

		await this.sendRequest(request);
	}

	/**
	 * Send batch requests
	 */
	async batch(requests: Array<{ method: string; params?: any }>): Promise<any[]> {
		const batchRequests: JsonRpcRequest[] = requests.map((req, index) => ({
			jsonrpc: "2.0",
			method: req.method,
			params: req.params,
			id: `${++this.requestId}-${index}`,
			metadata: {
				sessionId: this.config.sessionId,
				correlationId: crypto.randomUUID(),
				timestamp: Date.now(),
			},
		}));

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

		try {
			const response = await fetch(`${this.config.apiUrl}/rpc`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(batchRequests),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const results = await response.json();
			
			if (!Array.isArray(results)) {
				throw new Error("Invalid batch response");
			}

			// Process batch results
			return results.map((res: JsonRpcResponse) => {
				if ("error" in res) {
					throw new JsonRpcError(
						res.error.message,
						res.error.code,
						res.error.data
					);
				}
				return res.result;
			});
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Request timeout");
			}
			throw error;
		}
	}

	/**
	 * Discover available methods from the server
	 * The server's handler registry is the source of truth
	 */
	async discoverMethods(domain?: string): Promise<{
		methods: Array<{
			name: string;
			description?: string;
			inputSchema?: any;
			outputSchema?: any;
			metadata?: {
				persist?: boolean;
				rateLimit?: number;
				roles?: string[];
			};
		}>;
	}> {
		// Call the system.discover handler to get all registered methods
		return this.request("system.discover", { domain });
	}

	/**
	 * Dynamic method invocation - pass through to handlers
	 * The handlers define their own schemas and validation
	 */
	async invoke<T = any>(method: string, params?: any): Promise<T> {
		return this.request<T>(method, params);
	}

	/**
	 * Subscribe to events via WebSocket
	 */
	subscribeToEvents(
		eventTypes?: string[],
		onMessage?: (data: any) => void,
		onError?: (error: Error) => void,
		onConnect?: () => void,
		onDisconnect?: () => void
	): WebSocketConnection {
		const wsUrl = this.config.apiUrl.replace(/^http/, "ws") + "/ws";
		const ws = new WebSocket(wsUrl);
		const connection: WebSocketConnection = {
			ws,
			subscriptions: new Set(eventTypes || []),
			close: () => ws.close(),
		};

		ws.onopen = () => {
			console.log("WebSocket connected");
			if (onConnect) onConnect();
			
			// Subscribe to events - if none specified, subscribe to all
			const eventsToSubscribe = eventTypes?.length ? eventTypes : ["*"];
			ws.send(JSON.stringify({
				action: "subscribe",
				events: eventsToSubscribe,
			}));
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				
				// Handle different message types
				if (data.type === "event" && onMessage) {
					onMessage(data);
				} else if (data.type === "connected") {
					console.log("WebSocket connection confirmed:", data.clientId);
				} else if (data.type === "subscribed") {
					console.log("Subscribed to events:", data.events);
				} else if (data.type === "error") {
					if (onError) onError(new Error(data.error.message));
				}
			} catch (error) {
				console.error("Failed to parse WebSocket message:", error);
				if (onError) onError(error as Error);
			}
		};

		ws.onerror = (event) => {
			console.error("WebSocket error:", event);
			if (onError) onError(new Error("WebSocket error"));
		};

		ws.onclose = () => {
			console.log("WebSocket disconnected");
			if (onDisconnect) onDisconnect();
			
			// Auto-reconnect after 5 seconds
			setTimeout(() => {
				if (ws.readyState === WebSocket.CLOSED) {
					this.subscribeToEvents(eventTypes, onMessage, onError, onConnect, onDisconnect);
				}
			}, 5000);
		};

		return connection;
	}

	/**
	 * Execute a JSONRPC request via WebSocket
	 */
	async executeViaWebSocket<T = any>(
		ws: WebSocket,
		method: string,
		params?: any
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			
			const request = {
				action: "execute",
				request: {
					jsonrpc: "2.0",
					method,
					params,
					id,
				},
			};

			const handler = (event: MessageEvent) => {
				try {
					const data = JSON.parse(event.data);
					if (data.jsonrpc === "2.0" && data.id === id) {
						ws.removeEventListener("message", handler);
						
						if ("error" in data) {
							reject(new JsonRpcError(
								data.error.message,
								data.error.code,
								data.error.data
							));
						} else {
							resolve(data.result as T);
						}
					}
				} catch (error) {
					// Continue listening for the right message
				}
			};

			ws.addEventListener("message", handler);
			ws.send(JSON.stringify(request));

			// Timeout after configured time
			setTimeout(() => {
				ws.removeEventListener("message", handler);
				reject(new Error("Request timeout"));
			}, this.config.timeout);
		});
	}

	/**
	 * Private helper to send a request
	 */
	private async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

		try {
			const response = await fetch(`${this.config.apiUrl}/rpc`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(request),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			// Handle notifications (204 No Content)
			if (response.status === 204) {
				return { jsonrpc: "2.0", result: null, id: null };
			}

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			return await response.json();
		} catch (error) {
			clearTimeout(timeoutId);
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Request timeout");
			}
			throw error;
		}
	}

	/**
	 * Sleep helper for retries
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * WebSocket connection interface
 */
interface WebSocketConnection {
	ws: WebSocket;
	subscriptions: Set<string>;
	close: () => void;
}

/**
 * Custom error class for JSONRPC errors
 */
export class JsonRpcError extends Error {
	constructor(
		message: string,
		public code: number,
		public data?: any
	) {
		super(message);
		this.name = "JsonRpcError";
	}
}

/**
 * Create a singleton instance for the app
 */
let clientInstance: EventClient | null = null;

export function getEventClient(config?: EventClientConfig): EventClient {
	if (!clientInstance) {
		const apiUrl = config?.apiUrl || import.meta.env.VITE_API_URL || "http://localhost:3000";
		clientInstance = new EventClient({ apiUrl, ...config });
	}
	return clientInstance;
}

/**
 * React Query hooks for dynamic event invocation
 */

/**
 * Generic hook for querying any event method
 */
export function useEventQuery<T = any>(
	method: string,
	params?: any,
	options?: {
		refetchInterval?: number;
		enabled?: boolean;
	}
) {
	const client = getEventClient();
	return useQuery<T>({
		queryKey: [method, params],
		queryFn: () => client.invoke<T>(method, params),
		...options,
	});
}

/**
 * Generic hook for mutating via any event method
 */
export function useEventMutation<TParams = any, TResult = any>(
	method: string,
	options?: {
		onSuccess?: (data: TResult) => void;
		invalidateQueries?: string[][];
	}
) {
	const client = getEventClient();
	const queryClient = useQueryClient();
	
	return useMutation<TResult, Error, TParams>({
		mutationFn: (params) => client.invoke<TResult>(method, params),
		onSuccess: (data) => {
			options?.onSuccess?.(data);
			options?.invalidateQueries?.forEach(queryKey => {
				queryClient.invalidateQueries({ queryKey });
			});
		},
	});
}

/**
 * Convenience hooks for common queries
 */
export const useSystemHealth = () => 
	useEventQuery("system.health", {}, { refetchInterval: 30000 }); // 30 seconds

export const useSystemState = () => 
	useEventQuery("system.get_state", {}, { refetchInterval: 30000 }); // 30 seconds

export const useSystemMetrics = (params = {}) => 
	useEventQuery("system.metrics", params, { refetchInterval: 30000 }); // 30 seconds

/**
 * Convenience hooks for common mutations
 */
export const useCreateTask = () => 
	useEventMutation("task.create", { 
		invalidateQueries: [["system.get_state"], ["tasks"]] 
	});

export const useUpdateTask = () => 
	useEventMutation("task.update", { 
		invalidateQueries: [["system.get_state"], ["tasks"]] 
	});

export const useCompleteTask = () => 
	useEventMutation("task.complete", { 
		invalidateQueries: [["system.get_state"], ["tasks"]] 
	});

export const useDeleteTask = () => 
	useEventMutation("task.delete", { 
		invalidateQueries: [["system.get_state"], ["tasks"], ["task.list"]] 
	});

export const useGenerateContext = () =>
	useEventMutation("task.context", {
		invalidateQueries: [["tasks"], ["task.list"]]
	});