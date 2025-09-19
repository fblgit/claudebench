import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { hookTodoWriteInput, hookTodoWriteOutput } from "@/schemas/hook.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../helpers/test-setup";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: hook.todo_write", () => {
	let redis: any;

	beforeAll(async () => {
		redis = await setupContractTest();
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Input Schema Contract", () => {
		const contractInput = contractSpec.events["hook.todo_write"].request.properties.params.properties;

		it("should match contract input schema", () => {
			// Contract requires: todos (array of TodoItem)
			expect(contractInput.todos.type).toBe("array");
		});

		it("should accept valid todos array", () => {
			const input = {
				todos: [
					{ content: "Write tests", status: "pending" as const },
					{ content: "Review PR", status: "in_progress" as const },
					{ content: "Deploy to prod", status: "completed" as const },
				],
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept todos with optional activeForm", () => {
			const input = {
				todos: [
					{ 
						content: "Write documentation", 
						status: "pending" as const,
						activeForm: "Writing documentation"
					},
					{ 
						content: "Fix bug", 
						status: "in_progress" as const
						// No activeForm - it's optional
					},
				],
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept empty todos array", () => {
			const input = {
				todos: [],
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should enforce status enum values", () => {
			const validInput = {
				todos: [
					{ content: "Task 1", status: "pending" as const },
					{ content: "Task 2", status: "in_progress" as const },
					{ content: "Task 3", status: "completed" as const },
				],
			};
			
			const result = hookTodoWriteInput.safeParse(validInput);
			expect(result.success).toBe(true);
		});

		it("should reject invalid status values", () => {
			const invalidInputs = [
				{
					todos: [
						{ content: "Task", status: "PENDING" }, // Wrong case
					],
				},
				{
					todos: [
						{ content: "Task", status: "done" }, // Wrong value
					],
				},
				{
					todos: [
						{ content: "Task", status: "IN_PROGRESS" }, // Wrong case
					],
				},
			];

			for (const input of invalidInputs) {
				const result = hookTodoWriteInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should reject todos missing required fields", () => {
			const invalidInputs = [
				{
					todos: [
						{ content: "Task" }, // Missing status
					],
				},
				{
					todos: [
						{ status: "pending" }, // Missing content
					],
				},
				{
					todos: [
						{}, // Missing both
					],
				},
			];

			for (const input of invalidInputs) {
				const result = hookTodoWriteInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should reject input missing todos array", () => {
			const invalidInputs = [
				{ todo: [] }, // Wrong field name
				{}, // Missing todos
			];

			for (const input of invalidInputs) {
				const result = hookTodoWriteInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Output Schema Contract", () => {
		const contractOutput = contractSpec.events["hook.todo_write"].response.properties.result.properties;

		it("should match contract output schema", () => {
			// Contract requires: processed (boolean)
			expect(contractOutput.processed).toEqual({ type: "boolean" });
		});

		it("should validate output with processed boolean", () => {
			const output = {
				processed: true,
			};
			
			const result = hookTodoWriteOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should accept processed as true", () => {
			const output = {
				processed: true,
			};
			
			const result = hookTodoWriteOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should accept processed as false", () => {
			const output = {
				processed: false,
			};
			
			const result = hookTodoWriteOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should reject non-boolean processed values", () => {
			const invalidOutputs = [
				{ processed: "true" }, // String not boolean
				{ processed: 1 }, // Number not boolean
				{ processed: { success: true } }, // Object not boolean
				{ processed: null }, // Null not boolean
			];

			for (const output of invalidOutputs) {
				const result = hookTodoWriteOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});

		it("should reject output missing processed field", () => {
			const invalidOutputs = [
				{ accepted: true }, // Wrong field name
				{ success: true }, // Wrong field name
				{}, // Missing processed
			];

			for (const output of invalidOutputs) {
				const result = hookTodoWriteOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Contract Field Names", () => {
		it("should use 'todos' not 'todoList' in input", () => {
			const inputWithWrongField = {
				todoList: [], // Wrong field name
			};
			
			const result = hookTodoWriteInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'content' not 'text' for todo items", () => {
			const inputWithWrongField = {
				todos: [
					{ text: "Task", status: "pending" }, // Wrong field name
				],
			};
			
			const result = hookTodoWriteInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'content' not 'title' for todo items", () => {
			const inputWithWrongField = {
				todos: [
					{ title: "Task", status: "pending" }, // Wrong field name
				],
			};
			
			const result = hookTodoWriteInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'processed' not 'accepted' in output", () => {
			const outputWithWrongField = {
				accepted: true, // Wrong field name
			};
			
			const result = hookTodoWriteOutput.safeParse(outputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'processed' not 'success' in output", () => {
			const outputWithWrongField = {
				success: true, // Wrong field name
			};
			
			const result = hookTodoWriteOutput.safeParse(outputWithWrongField as any);
			expect(result.success).toBe(false);
		});
	});

	describe("TodoItem Structure", () => {
		const todoItemDef = contractSpec.events["hook.todo_write"].request.properties.params.properties.todos.items.properties;

		it("should match TodoItem definition from contract", () => {
			// Contract defines TodoItem with content, status, and optional activeForm
			expect(todoItemDef.content.type).toBe("string");
			expect(todoItemDef.status.enum).toEqual(["pending", "in_progress", "completed"]);
			expect(todoItemDef.activeForm.type).toBe("string");
		});

		it("should validate TodoItem with all fields", () => {
			const input = {
				todos: [
					{
						content: "Complete task",
						status: "in_progress" as const,
						activeForm: "Completing task",
					},
				],
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should validate TodoItem without optional activeForm", () => {
			const input = {
				todos: [
					{
						content: "Simple task",
						status: "pending" as const,
					},
				],
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});
	});

	describe("Complex Scenarios", () => {
		it("should handle todos with mixed activeForm presence", () => {
			const input = {
				todos: [
					{ 
						content: "Task with active form", 
						status: "in_progress" as const,
						activeForm: "Working on task"
					},
					{ 
						content: "Task without active form", 
						status: "pending" as const
					},
					{ 
						content: "Completed with active form", 
						status: "completed" as const,
						activeForm: "Completed task"
					},
				],
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should handle large todo lists", () => {
			const largeTodoList = Array.from({ length: 100 }, (_, i) => ({
				content: `Task ${i + 1}`,
				status: ["pending", "in_progress", "completed"][i % 3] as "pending" | "in_progress" | "completed",
				...(i % 2 === 0 ? { activeForm: `Working on task ${i + 1}` } : {}),
			}));

			const input = {
				todos: largeTodoList,
			};
			
			const result = hookTodoWriteInput.safeParse(input);
			expect(result.success).toBe(true);
		});
	});

	describe("Handler Registration", () => {
		it("should register hook.todo_write handler", () => {
			const handler = registry.getHandler("hook.todo_write");
			expect(handler).toBeDefined();
			if (handler) {
				expect(handler.event).toBe("hook.todo_write");
			}
		});
	});
});
