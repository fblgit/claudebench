import { getAllHandlers, getHandlerMetadata, toHttpRoute, toMcpTool } from "./decorator";
import type { HandlerMetadata } from "./decorator";
import { createContext } from "./context";
import type { EventContext } from "./context";
import { eventBus } from "./bus";
import { rateLimiter } from "./rate-limiter";
import { circuitBreaker } from "./circuit-breaker";
import { instance } from "../config";

export class HandlerRegistry {
	private handlers: Map<string, HandlerMetadata> = new Map();
	private instances: Map<string, any> = new Map();

	async discover(): Promise<void> {
		const allHandlers = getAllHandlers();
		for (const metadata of allHandlers) {
			this.handlers.set(metadata.event, metadata);
			
			// Create instance of handler class
			const instance = new (metadata.handler as any)();
			this.instances.set(metadata.event, instance);
			
			// Subscribe to event bus
			await eventBus.subscribe(metadata.event, async (event) => {
				await this.executeHandler(metadata.event, event.payload);
			});
		}
	}

	async executeHandler(eventType: string, input: any, clientId?: string): Promise<any> {
		const metadata = this.handlers.get(eventType);
		const handlerInstance = this.instances.get(eventType);
		
		if (!metadata || !handlerInstance) {
			throw new Error(`No handler registered for event: ${eventType}`);
		}

		// Check rate limit
		if (metadata.rateLimit) {
			const rateLimitResult = await rateLimiter.checkLimit(
				eventType,
				clientId || instance.id,
				metadata.rateLimit
			);
			
			if (!rateLimitResult.allowed) {
				const error = new Error(`Rate limit exceeded for ${eventType}`);
				(error as any).code = -32000; // Custom JSONRPC error code
				(error as any).data = {
					remaining: rateLimitResult.remaining,
					resetAt: rateLimitResult.resetAt,
				};
				throw error;
			}
		}

		// Check circuit breaker
		const canExecute = await circuitBreaker.canExecute(eventType);
		if (!canExecute) {
			// Return fallback response
			const fallback = await circuitBreaker.getFallbackResponse(eventType);
			const error = new Error(fallback.error);
			(error as any).code = -32001; // Circuit breaker open
			(error as any).data = { fallback: true };
			throw error;
		}

		// Validate input first (validation errors shouldn't trigger circuit breaker)
		let validatedInput;
		try {
			validatedInput = metadata.inputSchema.parse(input);
		} catch (validationError) {
			// Input validation errors are client errors, not service failures
			throw validationError;
		}

		try {
			// Execute handler
			const context = await this.createContext(eventType);
			const result = await handlerInstance.handle(validatedInput, context);
			
			// Validate output
			const validatedOutput = metadata.outputSchema.parse(result);
			
			// Record success
			await circuitBreaker.recordSuccess(eventType);
			
			return validatedOutput;
		} catch (error) {
			// Only record failures for actual handler errors, not validation
			const failureType = error instanceof Error && error.message.includes("timeout")
				? "timeout"
				: error instanceof Error && error.message.includes("reject")
				? "rejection"
				: "error";
			
			await circuitBreaker.recordFailure(eventType, failureType);
			
			// Re-throw the error
			throw error;
		}
	}

	private async createContext(eventType: string): Promise<EventContext> {
		const metadata = this.handlers.get(eventType);
		const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		return createContext(eventType, eventId, metadata?.persist || false);
	}

	getHandler(eventType: string): HandlerMetadata | undefined {
		return this.handlers.get(eventType);
	}

	getAllHandlers(): HandlerMetadata[] {
		return Array.from(this.handlers.values());
	}

	getHttpRoutes() {
		return this.getAllHandlers().map(toHttpRoute);
	}

	getMcpTools() {
		return this.getAllHandlers().map(toMcpTool);
	}
}

export const registry = new HandlerRegistry();