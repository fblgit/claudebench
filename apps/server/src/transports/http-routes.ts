import type { Hono } from "hono";
import type { HandlerRegistry } from "../core/registry";
import { z } from "zod";

/**
 * Auto-generate HTTP routes from handler registry
 * 
 * This function creates RESTful HTTP endpoints for each registered handler.
 * Each handler's event name (e.g., "task.create") becomes a route (e.g., "POST /task/create").
 */
export function registerHttpRoutes(app: Hono, registry: HandlerRegistry) {
	const handlers = registry.getAllHandlers();
	const routes = registry.getHttpRoutes();
	
	// Register each handler as an HTTP route
	routes.forEach(route => {
		const handler = handlers.find(h => h.event === route.event);
		
		if (!handler) {
			console.warn(`⚠️  No handler found for route ${route.path}`);
			return;
		}
		
		// Register the route
		app.on(route.method, route.path, async (c) => {
			try {
				// Get request body
				const body = await c.req.json().catch(() => ({}));
				
				// Execute handler through registry (includes validation)
				const result = await registry.executeHandler(route.event, body);
				
				// Return successful response
				return c.json({
					success: true,
					data: result,
					event: route.event,
					timestamp: new Date().toISOString(),
				});
				
			} catch (error: any) {
				// Handle Zod validation errors
				if (error.name === "ZodError") {
					return c.json({
						success: false,
						error: "Validation failed",
						details: error.errors,
						event: route.event,
					}, 400);
				}
				
				// Handle rate limit errors
				if (error.message?.includes("rate limit")) {
					return c.json({
						success: false,
						error: "Rate limit exceeded",
						event: route.event,
					}, 429);
				}
				
				// Handle circuit breaker errors
				if (error.message?.includes("circuit breaker")) {
					return c.json({
						success: false,
						error: "Service temporarily unavailable",
						event: route.event,
					}, 503);
				}
				
				// Handle authorization errors
				if (error.message?.includes("unauthorized") || error.message?.includes("role")) {
					return c.json({
						success: false,
						error: "Unauthorized",
						event: route.event,
					}, 403);
				}
				
				// Handle hook blocked errors
				if (error.message?.includes("hook blocked")) {
					return c.json({
						success: false,
						error: "Request blocked by hook",
						reason: error.reason,
						event: route.event,
					}, 403);
				}
				
				// Generic error
				console.error(`Error in ${route.path}:`, error);
				return c.json({
					success: false,
					error: "Internal server error",
					event: route.event,
					...(process.env.NODE_ENV === "development" && { 
						message: error.message,
						stack: error.stack,
					}),
				}, 500);
			}
		});
		
		// Also register OPTIONS for CORS preflight
		app.options(route.path, (c) => {
			return c.body(null, 204);
		});
	});
	
	// Register route listing endpoint
	app.get("/routes", (c) => {
		const routeList = routes.map(r => ({
			method: r.method,
			path: r.path,
			event: r.event,
			handler: handlers.find(h => h.event === r.event)?.className,
			description: handlers.find(h => h.event === r.event)?.description,
		}));
		
		return c.json({
			total: routeList.length,
			routes: routeList,
		});
	});
	
	// Register handler info endpoint
	app.get("/handlers", (c) => {
		const handlerList = handlers.map(h => ({
			event: h.event,
			className: h.className,
			description: h.description,
			persist: h.persist,
			roles: h.roles,
			rateLimit: h.rateLimit,
			httpRoute: routes.find(r => r.event === h.event),
		}));
		
		return c.json({
			total: handlerList.length,
			handlers: handlerList,
		});
	});
	
	// Register schema documentation endpoint
	app.get("/schemas/:event", (c) => {
		const eventType = c.req.param("event");
		const handler = handlers.find(h => h.event === eventType);
		
		if (!handler) {
			return c.json({
				error: "Handler not found",
				event: eventType,
			}, 404);
		}
		
		// Convert Zod schemas to JSON Schema format (simplified)
		const inputSchema = zodToJsonSchema(handler.inputSchema);
		const outputSchema = zodToJsonSchema(handler.outputSchema);
		
		return c.json({
			event: handler.event,
			className: handler.className,
			description: handler.description,
			schemas: {
				input: inputSchema,
				output: outputSchema,
			},
		});
	});
}

/**
 * Simple Zod to JSON Schema converter
 * Note: This is a simplified version. For production, use a library like zod-to-json-schema
 */
function zodToJsonSchema(schema: z.ZodSchema<any>): any {
	try {
		// Get the shape if it's an object
		const def = (schema as any)._def;
		if (def && def.typeName === "ZodObject") {
			const shape = (schema as any).shape;
			const properties: any = {};
			const required: string[] = [];
			
			for (const [key, value] of Object.entries(shape)) {
				properties[key] = getSchemaType(value as z.ZodSchema<any>);
				
				// Check if field is required
				if (!(value as any).isOptional()) {
					required.push(key);
				}
			}
			
			return {
				type: "object",
				properties,
				required: required.length > 0 ? required : undefined,
			};
		}
		
		// Return basic type info for non-objects
		return getSchemaType(schema);
		
	} catch (error) {
		// Fallback to description only
		return {
			description: "Schema information not available",
			type: "unknown",
		};
	}
}

/**
 * Get JSON Schema type from Zod schema
 */
function getSchemaType(schema: z.ZodSchema<any>): any {
	const def = (schema as any)._def;
	if (!def) return { type: "unknown" };
	
	const typeName = def.typeName;
	
	switch (typeName) {
		case "ZodString":
			return { type: "string" };
		case "ZodNumber":
			return { type: "number" };
		case "ZodBoolean":
			return { type: "boolean" };
		case "ZodArray":
			return { type: "array", items: def.type ? getSchemaType(def.type) : { type: "unknown" } };
		case "ZodEnum":
			return { type: "string", enum: def.values || [] };
		case "ZodOptional":
			return { ...getSchemaType(def.innerType), optional: true };
		case "ZodNullable":
			return { ...getSchemaType(def.innerType), nullable: true };
		case "ZodUnion":
			return { oneOf: (def.options || []).map(getSchemaType) };
		case "ZodLiteral":
			return { const: def.value };
		default:
			return { type: "unknown" };
	}
}