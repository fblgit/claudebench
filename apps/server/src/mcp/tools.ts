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
			// MCP SDK expects a Zod object schema, not just the shape
			// We need to ensure we're passing the actual Zod schema object
			let mcpInputSchema: z.ZodObject<any> | Record<string, z.ZodTypeAny>;
			
			if (handler.inputSchema instanceof z.ZodObject) {
				// If it's already a ZodObject, use it directly
				mcpInputSchema = handler.inputSchema;
			} else {
				// Otherwise, extract the shape and create a new ZodObject
				const shape = extractZodShape(handler.inputSchema);
				mcpInputSchema = z.object(shape);
			}
			
			// Register the tool with MCP server
			// The SDK's tool method expects: name, description, inputSchema (ZodObject or shape), handler
			mcpServer.tool(
				toolName,
				handler.description || `Execute ${handler.event} event handler`,
				mcpInputSchema,
				async (args: any) => {
					try {
						// Validate input with original schema
						const validatedInput = handler.inputSchema.parse(args);
						
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