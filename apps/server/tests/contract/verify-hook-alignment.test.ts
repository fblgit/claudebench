import { describe, it, expect } from "bun:test";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";
import { 
	hookPreToolInput, hookPreToolOutput,
	hookPostToolInput, hookPostToolOutput,
	hookUserPromptInput, hookUserPromptOutput,
	hookTodoWriteInput, hookTodoWriteOutput
} from "@/schemas/hook.schema";

describe("Hook Domain Contract Alignment Verification", () => {
	describe("hook.pre_tool", () => {
		const contract = contractSpec.events["hook.pre_tool"];
		
		it("should have correct request params", () => {
			const params = contract.request.properties.params.properties;
			
			// Contract says: tool (string), params (no type constraint - any)
			expect(params.tool.type).toBe("string");
			expect(params.params).toEqual({}); // Empty object means any type
			
			// Required fields
			const required = contract.request.properties.params.required;
			expect(required).toEqual(["tool", "params"]);
		});
		
		it("should have correct response result", () => {
			const result = contract.response.properties.result.properties;
			
			// Contract says: allow (boolean), reason (string), modified (any)
			expect(result.allow.type).toBe("boolean");
			expect(result.reason.type).toBe("string");
			expect(result.modified).toEqual({}); // Empty object means any type
			
			// Only allow is required
			const required = contract.response.properties.result.required;
			expect(required).toEqual(["allow"]);
		});
		
		it("should validate schema matches contract", () => {
			// Test our schema accepts contract-compliant data
			const validInput = { tool: "bash", params: { command: "ls" } };
			expect(hookPreToolInput.safeParse(validInput).success).toBe(true);
			
			const validOutput = { allow: true, reason: "safe", modified: { timeout: 5000 } };
			expect(hookPreToolOutput.safeParse(validOutput).success).toBe(true);
		});
	});
	
	describe("hook.post_tool", () => {
		const contract = contractSpec.events["hook.post_tool"];
		
		it("should have correct request params", () => {
			const params = contract.request.properties.params.properties;
			
			// Contract says: tool (string), result (any)
			expect(params.tool.type).toBe("string");
			expect(params.result).toEqual({}); // Empty object means any type
			
			// Required fields
			const required = contract.request.properties.params.required;
			expect(required).toEqual(["tool", "result"]);
		});
		
		it("should have correct response result", () => {
			const result = contract.response.properties.result.properties;
			
			// Contract says: processed (ANY TYPE - not boolean!)
			expect(result.processed).toEqual({}); // Empty object means any type
			
			// processed is required
			const required = contract.response.properties.result.required;
			expect(required).toEqual(["processed"]);
		});
		
		it("should validate schema matches contract", () => {
			const validInput = { tool: "write", result: { success: true } };
			expect(hookPostToolInput.safeParse(validInput).success).toBe(true);
			
			// processed can be ANY type
			const validOutputs = [
				{ processed: true },
				{ processed: "completed" },
				{ processed: { acknowledged: true } },
				{ processed: 42 },
				{ processed: null },
			];
			
			for (const output of validOutputs) {
				expect(hookPostToolOutput.safeParse(output).success).toBe(true);
			}
		});
	});
	
	describe("hook.user_prompt", () => {
		const contract = contractSpec.events["hook.user_prompt"];
		
		it("should have correct request params", () => {
			const params = contract.request.properties.params.properties;
			
			// Contract says: prompt (string), context (object)
			expect(params.prompt.type).toBe("string");
			expect(params.context.type).toBe("object");
			
			// Required fields
			const required = contract.request.properties.params.required;
			expect(required).toEqual(["prompt", "context"]);
		});
		
		it("should have correct response result", () => {
			const result = contract.response.properties.result.properties;
			
			// Contract says: modified (string) - optional
			expect(result.modified.type).toBe("string");
			
			// No required fields in response
			const resultSpec = contract.response.properties.result as any;
			expect(resultSpec.required).toBeUndefined();
		});
		
		it("should validate schema matches contract", () => {
			const validInput = { prompt: "test", context: { key: "value" } };
			expect(hookUserPromptInput.safeParse(validInput).success).toBe(true);
			
			const validOutputs = [
				{ modified: "changed prompt" },
				{}, // modified is optional
			];
			
			for (const output of validOutputs) {
				expect(hookUserPromptOutput.safeParse(output).success).toBe(true);
			}
		});
	});
	
	describe("hook.todo_write", () => {
		const contract = contractSpec.events["hook.todo_write"];
		
		it("should have correct request params", () => {
			const params = contract.request.properties.params.properties;
			
			// Contract says: todos (array of TodoItem)
			expect(params.todos.type).toBe("array");
			expect(params.todos.items.type).toBe("object");
			
			const todoItem = params.todos.items.properties;
			expect(todoItem.content.type).toBe("string");
			expect(todoItem.status.enum).toEqual(["pending", "in_progress", "completed"]);
			expect(todoItem.activeForm.type).toBe("string");
			
			// Required fields in TodoItem
			const todoRequired = params.todos.items.required;
			expect(todoRequired).toEqual(["content", "status"]);
			
			// Required fields in params
			const required = contract.request.properties.params.required;
			expect(required).toEqual(["todos"]);
		});
		
		it("should have correct response result", () => {
			const result = contract.response.properties.result.properties;
			
			// Contract says: processed (boolean) - NOT any type!
			expect(result.processed.type).toBe("boolean");
			
			// processed is required
			const required = contract.response.properties.result.required;
			expect(required).toEqual(["processed"]);
		});
		
		it("should validate schema matches contract", () => {
			const validInput = {
				todos: [
					{ content: "Task 1", status: "pending" },
					{ content: "Task 2", status: "in_progress", activeForm: "Working" },
				]
			};
			expect(hookTodoWriteInput.safeParse(validInput).success).toBe(true);
			
			const validOutput = { processed: true };
			expect(hookTodoWriteOutput.safeParse(validOutput).success).toBe(true);
			
			// processed must be boolean
			const invalidOutputs = [
				{ processed: "true" },
				{ processed: 1 },
				{ processed: { success: true } },
			];
			
			for (const output of invalidOutputs) {
				expect(hookTodoWriteOutput.safeParse(output).success).toBe(false);
			}
		});
	});
	
	describe("Schema Type Verification", () => {
		it("hook.post_tool processed should accept ANY type", () => {
			// This is the critical fix - processed is {} in contract (any type)
			const testValues = [
				true,
				false, 
				"string",
				123,
				{ complex: "object" },
				["array"],
				null,
				undefined,
			];
			
			for (const value of testValues) {
				const output = { processed: value };
				const result = hookPostToolOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
		
		it("hook.todo_write processed should ONLY accept boolean", () => {
			// processed must be boolean for todo_write
			expect(hookTodoWriteOutput.safeParse({ processed: true }).success).toBe(true);
			expect(hookTodoWriteOutput.safeParse({ processed: false }).success).toBe(true);
			
			// Should reject non-boolean
			expect(hookTodoWriteOutput.safeParse({ processed: "true" }).success).toBe(false);
			expect(hookTodoWriteOutput.safeParse({ processed: 1 }).success).toBe(false);
		});
	});
});