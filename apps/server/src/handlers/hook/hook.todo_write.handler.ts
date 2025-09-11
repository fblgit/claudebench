import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookTodoWriteInput, hookTodoWriteOutput } from "@/schemas/hook.schema";
import type { HookTodoWriteInput, HookTodoWriteOutput } from "@/schemas/hook.schema";
import { todoManager } from "@/core/todo-manager";
import { registry } from "@/core/registry";

@EventHandler({
	event: "hook.todo_write",
	inputSchema: hookTodoWriteInput,
	outputSchema: hookTodoWriteOutput,
	persist: true,
	rateLimit: 50,
	description: "Process TodoWrite events",
})
export class TodoWriteHookHandler {
	@Instrumented(60) // Cache for 1 minute - todos change frequently
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 requests per minute
		timeout: 5000, // 5 second timeout for DB writes
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				processed: true // Always mark as processed
			})
		}
	})
	async handle(input: HookTodoWriteInput, ctx: EventContext): Promise<HookTodoWriteOutput> {
		const sessionId = ctx.metadata?.sessionId || "session-123";
		const instanceId = ctx.instanceId || "default";
		
		// Use TodoManager for all Redis operations
		// 1. Get previous state BEFORE updating current state
		const previous = await todoManager.getCurrentState(instanceId);
		const changes = todoManager.detectChanges(previous, input.todos);
		
		// 2. Update state and history
		await todoManager.setState(input.todos, instanceId, sessionId);
		await todoManager.addToHistory(input.todos, instanceId);
		await todoManager.aggregateTodos(input.todos, instanceId);
		
		// 3. Track changes and statistics
		await todoManager.trackStatusChanges(changes, instanceId);
		const stats = await todoManager.setStatistics(input.todos, instanceId);
		
		// 4. Process new todos into tasks (always create tasks from new todos)
		if (changes.newTodos.length > 0) {
			for (const todo of changes.newTodos) {
				// Skip completed todos
				if (todo.status === "completed") continue;
				
				// Check if task already exists for this todo
				const existingTaskId = await todoManager.getTaskForTodo(todo.content, sessionId);
				if (existingTaskId) continue;
				
				try {
					// Create task via the task.create handler
					const taskResult = await registry.executeHandler("task.create", {
						text: todo.content, // task.create expects 'text' not 'title'
						priority: todo.status === "in_progress" ? 75 : 50,
						metadata: {
							source: "todo_write",
							activeForm: todo.activeForm,
							sessionId,
						},
					});
					
					// Map the created task to this todo
					await todoManager.mapTodoToTask(todo.content, taskResult.id, sessionId);
					
					// Also emit our own task event for tracking
					await todoManager.emitTaskCreateEvent(taskResult.id, todo);
				} catch (error) {
					// Log errors but continue with other todos
					console.error(`Failed to create task for todo "${todo.content}":`, error);
				}
			}
		}
		
		// 5. Handle special cases
		await todoManager.setHighPriorityFlag(input.todos);
		await todoManager.emitCompletedNotifications(changes.completed, instanceId);
		await todoManager.scheduleCleanup(changes.completed);
		await todoManager.enforceSessionLimits(input.todos.length, sessionId);
		
		// 6. Publish execution event (handler responsibility)
		await ctx.publish({
			type: "hook.todo_write.executed",
			payload: {
				stats,
				changes: {
					added: changes.newTodos.length,
					completed: changes.completed.length,
					modified: changes.statusChanges.length,
				},
			},
		});
		
		// Always return processed: true per contract
		return {
			processed: true,
		};
	}
}