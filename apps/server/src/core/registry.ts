import { getAllHandlers, getHandlerMetadata, toHttpRoute, toMcpTool } from "./decorator";
import type { HandlerMetadata } from "./decorator";
import { createContext } from "./context";
import type { EventContext } from "./context";
import { eventBus } from "./bus";

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

	async executeHandler(eventType: string, input: any): Promise<any> {
		const metadata = this.handlers.get(eventType);
		const instance = this.instances.get(eventType);
		
		if (!metadata || !instance) {
			throw new Error(`No handler registered for event: ${eventType}`);
		}

		// Validate input
		const validatedInput = metadata.inputSchema.parse(input);
		
		// Execute handler
		const context = await this.createContext(eventType);
		const result = await instance.handle(validatedInput, context);
		
		// Validate output
		return metadata.outputSchema.parse(result);
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