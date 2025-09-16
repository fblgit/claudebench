import { EventHandler } from "../../core/decorator";
import { registry } from "../../core/registry";
import type { EventContext } from "../../core/context";
import {
	systemDiscoverInput,
	systemDiscoverOutput,
	type SystemDiscoverInput,
	type SystemDiscoverOutput,
} from "../../schemas/system.schema";

/**
 * System Discover Handler
 * Exposes all registered handlers and their schemas for dynamic client discovery
 */
@EventHandler({
	event: "system.discover",
	inputSchema: systemDiscoverInput,
	outputSchema: systemDiscoverOutput,
	description: "Discover available methods and their schemas",
	persist: false,
	rateLimit: 100,
})
export class SystemDiscoverHandler {
	async handle(
		input: SystemDiscoverInput,
		context: EventContext
	): Promise<SystemDiscoverOutput> {
		// Get all registered handlers from the registry
		const handlers = registry.getAllHandlers();
		
		// Filter by domain if specified
		const filteredHandlers = input.domain
			? handlers.filter(h => h.event.startsWith(input.domain + "."))
			: handlers;
		
		// Map handlers to discovery format
		const methods = filteredHandlers.map(handler => {
			// Convert Zod schemas to JSON representation
			// Use .shape property directly for ZodObject schemas
			const inputSchemaJson = (handler.inputSchema as any)?.shape 
				? this.zodObjectToJson(handler.inputSchema as any)
				: (handler.inputSchema as any)?._def 
				? this.zodSchemaToJson((handler.inputSchema as any)._def)
				: undefined;
				
			const outputSchemaJson = (handler.outputSchema as any)?.shape
				? this.zodObjectToJson(handler.outputSchema as any)
				: (handler.outputSchema as any)?._def
				? this.zodSchemaToJson((handler.outputSchema as any)._def)
				: undefined;
			
			return {
				name: handler.event,
				description: handler.description,
				inputSchema: inputSchemaJson,
				outputSchema: outputSchemaJson,
				metadata: {
					persist: handler.persist,
					rateLimit: handler.rateLimit,
					roles: handler.roles,
				},
			};
		});
		
		return { methods };
	}
	
	/**
	 * Convert ZodObject directly to JSON Schema
	 */
	private zodObjectToJson(schema: any): any {
		if (!schema.shape) {
			return { type: "object", properties: {}, required: [] };
		}
		
		const properties: any = {};
		const required: string[] = [];
		
		// Process each property in the shape
		for (const [key, value] of Object.entries(schema.shape)) {
			const propSchema = value as any;
			
			// Check if property is optional
			const isOptional = propSchema._def?.typeName === "ZodOptional";
			if (!isOptional) {
				required.push(key);
			}
			
			// Get the actual schema (unwrap optional if needed)
			const actualSchema = isOptional ? propSchema._def.innerType : propSchema;
			
			// Convert the property schema
			properties[key] = this.zodSchemaToJson(actualSchema._def);
		}
		
		return {
			type: "object",
			properties,
			required,
		};
	}
	
	/**
	 * Convert Zod schema definition to a simpler JSON representation
	 * This provides a basic schema structure that clients can use
	 */
	private zodSchemaToJson(def: any): any {
		// Handle different Zod types
		switch (def.typeName) {
			case "ZodObject":
				const shape: any = {};
				if (def.shape) {
					for (const [key, value] of Object.entries(def.shape)) {
						shape[key] = this.zodSchemaToJson((value as any)._def);
					}
				}
				return {
					type: "object",
					properties: shape,
					required: def.nonstrict ? [] : Object.keys(shape),
				};
				
			case "ZodString":
				const stringSchema: any = { type: "string" };
				if (def.minLength) stringSchema.minLength = def.minLength.value;
				if (def.maxLength) stringSchema.maxLength = def.maxLength.value;
				return stringSchema;
				
			case "ZodNumber":
				const numberSchema: any = { type: "number" };
				if (def.minimum) numberSchema.minimum = def.minimum.value;
				if (def.maximum) numberSchema.maximum = def.maximum.value;
				return numberSchema;
				
			case "ZodBoolean":
				return { type: "boolean" };
				
			case "ZodArray":
				return {
					type: "array",
					items: def.type ? this.zodSchemaToJson(def.type._def) : { type: "any" },
				};
				
			case "ZodEnum":
				return {
					type: "string",
					enum: def.values,
				};
				
			case "ZodOptional":
				const optionalSchema = this.zodSchemaToJson(def.innerType._def);
				optionalSchema.optional = true;
				return optionalSchema;
				
			case "ZodUnion":
				return {
					oneOf: def.options.map((opt: any) => this.zodSchemaToJson(opt._def)),
				};
				
			case "ZodLiteral":
				return {
					const: def.value,
				};
				
			case "ZodAny":
				return { type: "any" };
				
			default:
				// For unknown types, return a generic description
				return { type: def.typeName || "unknown" };
		}
	}
}
