/**
 * MCP Tools Registration - Auto-generate from handlers
 * 
 * Registers ClaudeBench event handlers as MCP tools.
 * Uses Zod schemas for proper input validation.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HandlerRegistry } from "../core/registry";
import { z } from "zod";

/**
 * Convert handler's Zod schema to MCP-compatible format
 * MCP SDK expects the .shape property for object schemas
 */
function extractZodShape(schema: z.ZodSchema<any>): Record<string, z.ZodTypeAny> {
	// If it's a ZodObject, return its shape directly (which contains Zod field definitions)
	if (schema instanceof z.ZodObject) {
		return schema.shape as Record<string, z.ZodTypeAny>;
	}
	
	// If it's wrapped in effects/transforms, try to unwrap
	if ('_def' in schema) {
		const def = (schema as any)._def;
		if (def.schema) {
			return extractZodShape(def.schema);
		}
		if (def.innerType) {
			return extractZodShape(def.innerType);
		}
	}
	
	// For non-object schemas, wrap in an object with a value field
	return {
		value: schema as z.ZodTypeAny
	};
}

/**
 * Register ClaudeBench handlers as MCP tools
 */
export async function registerTools(
	mcpServer: McpServer,
	registry: HandlerRegistry
): Promise<void> {
	const handlers = registry.getAllHandlers();
	let toolCount = 0;

	for (const handler of handlers) {
		// Convert event name to MCP tool name (dots to double underscores)
		const toolName = handler.event.replace(/\./g, "__");
		
		try {
			// For MCP SDK, we need to handle the schema registration carefully
			// The SDK accepts either a Zod schema or a shape object with Zod field definitions
			let mcpSchema: any;
			
			if (handler.inputSchema instanceof z.ZodObject) {
				// Use the ZodObject directly - the SDK knows how to handle it
				mcpSchema = handler.inputSchema;
			} else {
				// Try to extract and use the shape
				mcpSchema = extractZodShape(handler.inputSchema);
			}
			
			// Use the new registerTool method which is recommended for new code
			// It properly handles arguments passing
			mcpServer.registerTool(
				toolName,
				{
					title: handler.description || `Execute ${handler.event} event handler`,
					description: handler.description || `Execute ${handler.event} event handler`,
					inputSchema: mcpSchema
				},
				async (toolArgs: any) => {
					try {
						// With registerTool, the handler receives the actual arguments directly
						console.log(`[MCP Tool] Executing ${toolName} with args:`, toolArgs);
						
						// Validate input with original schema
						const validatedInput = handler.inputSchema.parse(toolArgs);
						
						// Execute the handler through the registry
						const result = await registry.executeHandler(handler.event, validatedInput);
						
						// Return the result in MCP format
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(result, null, 2),
								},
							],
						};
					} catch (error) {
						// Handle validation and execution errors
						const errorMessage = error instanceof Error ? error.message : String(error);
						
						// Return error in MCP format (not throwing to avoid breaking the connection)
						return {
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										error: errorMessage,
										event: handler.event,
									}, null, 2),
								},
							],
							isError: true,
						};
					}
				}
			);

			toolCount++;
			console.log(`   ✅ Registered MCP tool: ${toolName}`);
		} catch (error) {
			console.error(`   ❌ Failed to register MCP tool ${toolName}:`, error);
		}
	}

	console.log(`🎯 Registered ${toolCount} MCP tools from handlers`);
}

/**
 * Get list of available MCP tools (for documentation/discovery)
 */
export function getMcpToolList(registry: HandlerRegistry): any[] {
	const handlers = registry.getAllHandlers();
	
	return handlers.map(handler => {
		const toolName = handler.event.replace(/\./g, "__");
		
		return {
			name: toolName,
			description: handler.description || `Execute ${handler.event} event handler`,
			event: handler.event,
			persist: handler.persist || false,
			roles: handler.roles || [],
			rateLimit: handler.rateLimit,
		};
	});
}