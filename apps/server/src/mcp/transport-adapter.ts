/**
 * MCP Transport Adapter for Hono
 * 
 * Creates a proper transport adapter that works with the MCP SDK
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Create a mock request/response pair that works with MCP SDK
 */
export function createMockHttpObjects(headers: Record<string, string>, body?: any) {
	let responseData: any = null;
	let responseStatus = 200;
	let responseHeaders: Record<string, string> = {};
	const responseCallbacks: Record<string, Function[]> = {};
	
	// Mock request object
	const mockReq = {
		body: body ? JSON.stringify(body) : undefined,
		headers: {
			...headers,
			"host": headers["host"] || "localhost:3000",
		},
		method: "POST",
	};
	
	// Mock response object with chainable methods
	const mockRes: any = {
		statusCode: 200,
		
		writeHead: function(code: number, headers?: any) {
			responseStatus = code;
			this.statusCode = code;
			if (headers) {
				Object.assign(responseHeaders, headers);
			}
			return this;
		},
		
		write: function(data: any) {
			console.log("[MCP Transport] Response write:", data);
			responseData = data;
			return true;
		},
		
		end: function(data?: any) {
			console.log("[MCP Transport] Response end:", data);
			if (data !== undefined) {
				responseData = data;
			}
			// Trigger close callbacks
			if (responseCallbacks["close"]) {
				responseCallbacks["close"].forEach(cb => cb());
			}
			return this;
		},
		
		on: function(event: string, handler: Function) {
			if (!responseCallbacks[event]) {
				responseCallbacks[event] = [];
			}
			responseCallbacks[event].push(handler);
			return this;
		},
		
		once: function(event: string, handler: Function) {
			return this.on(event, handler);
		},
		
		setHeader: function(name: string, value: string) {
			responseHeaders[name] = value;
			return this;
		},
		
		getHeader: function(name: string) {
			return responseHeaders[name];
		},
		
		removeHeader: function(name: string) {
			delete responseHeaders[name];
			return this;
		},
	};
	
	// Store getters for extracting response
	mockRes._getResponseData = () => responseData;
	mockRes._getResponseStatus = () => responseStatus;
	mockRes._getResponseHeaders = () => responseHeaders;
	
	return { mockReq, mockRes };
}

/**
 * Process a request through MCP transport and extract response
 */
export async function processMcpRequest(
	transport: StreamableHTTPServerTransport,
	headers: Record<string, string>,
	body?: any
): Promise<{ data: any; status: number; headers: Record<string, string> }> {
	const { mockReq, mockRes } = createMockHttpObjects(headers, body);
	
	// Create a promise that resolves when response is written
	const responsePromise = new Promise<void>((resolve) => {
		const originalEnd = mockRes.end;
		mockRes.end = function(data?: any) {
			originalEnd.call(this, data);
			resolve();
		};
	});
	
	// Process through transport
	console.log("[MCP Transport] Processing request:", body?.method || "unknown");
	const handlePromise = transport.handleRequest(mockReq, mockRes, body);
	
	// Wait for both with timeout
	const raceResult = await Promise.race([
		Promise.all([handlePromise, responsePromise]).then(() => "completed"),
		new Promise(resolve => setTimeout(() => resolve("timeout"), 5000))
	]);
	
	if (raceResult === "timeout") {
		console.log("[MCP Transport] Request timed out after 5 seconds");
	}
	
	// Extract response
	const responseData = mockRes._getResponseData();
	const responseStatus = mockRes._getResponseStatus();
	const responseHeaders = mockRes._getResponseHeaders();
	
	// Parse response data
	let parsedData = responseData;
	if (typeof responseData === "string") {
		// Check for SSE format
		if (responseData.includes("event:") && responseData.includes("data:")) {
			const lines = responseData.split("\n");
			for (const line of lines) {
				if (line.startsWith("data: ")) {
					try {
						parsedData = JSON.parse(line.substring(6));
						console.log("[MCP Transport] Parsed SSE data:", parsedData);
						break;
					} catch (e) {
						console.error("[MCP Transport] Failed to parse SSE data:", e);
					}
				}
			}
		} else {
			// Try to parse as regular JSON
			try {
				parsedData = JSON.parse(responseData);
			} catch (e) {
				// Keep as string if not JSON
			}
		}
	}
	
	return {
		data: parsedData,
		status: responseStatus,
		headers: responseHeaders
	};
}