import "reflect-metadata";
import type { z } from "zod";

export interface EventHandlerConfig {
	event: string;
	inputSchema: z.ZodSchema<any>;
	outputSchema: z.ZodSchema<any>;
	persist?: boolean;
	roles?: string[];
	rateLimit?: number;
	description?: string;
}

export interface HandlerMetadata extends EventHandlerConfig {
	className: string;
	handler: Function;
}

const HANDLER_METADATA_KEY = Symbol("eventHandler");

export function EventHandler(config: EventHandlerConfig) {
	return function <T extends { new(...args: any[]): {} }>(constructor: T) {
		const metadata: HandlerMetadata = {
			...config,
			className: constructor.name,
			handler: constructor,
		};

		// Store metadata on the class
		Reflect.defineMetadata(HANDLER_METADATA_KEY, metadata, constructor);

		// Store in global registry for discovery
		const handlers = global.__handlers || [];
		handlers.push(metadata);
		global.__handlers = handlers;

		return constructor;
	};
}

export function getHandlerMetadata(target: any): HandlerMetadata | undefined {
	return Reflect.getMetadata(HANDLER_METADATA_KEY, target);
}

export function getAllHandlers(): HandlerMetadata[] {
	return global.__handlers || [];
}

// Helper to generate MCP tool definition from handler
export function toMcpTool(metadata: HandlerMetadata) {
	return {
		name: metadata.event.replace(".", "__"),
		description: metadata.description || `Handle ${metadata.event} event`,
		inputSchema: metadata.inputSchema,
	};
}

// Helper to generate HTTP route from handler
export function toHttpRoute(metadata: HandlerMetadata) {
	const [domain, action] = metadata.event.split(".");
	return {
		method: "POST" as const,
		path: `/${domain}/${action}`,
		event: metadata.event,
	};
}

// Declare global type
declare global {
	var __handlers: HandlerMetadata[] | undefined;
}