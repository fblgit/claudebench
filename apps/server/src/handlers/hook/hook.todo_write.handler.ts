import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookTodoWriteInput, hookTodoWriteOutput } from "@/schemas/hook.schema";
import type { HookTodoWriteInput, HookTodoWriteOutput } from "@/schemas/hook.schema";
import { todoManager } from "@/core/todo-manager";

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
		// 1. Update state and history
		await todoManager.setState(input.todos, instanceId, sessionId);
		await todoManager.addToHistory(input.todos, instanceId);
		await todoManager.aggregateTodos(input.todos, instanceId);
		
		// 2. Get previous state and detect changes
		const previous = await todoManager.getPreviousState(instanceId);
		const changes = todoManager.detectChanges(previous, input.todos);
		
		// 3. Track changes and statistics
		await todoManager.trackStatusChanges(changes, instanceId);
		const stats = await todoManager.setStatistics(input.todos, instanceId);
		
		// 4. Process new todos into tasks (if persist is enabled)
		if (ctx.persist && changes.newTodos.length > 0) {
			for (const todo of changes.newTodos) {
				// Skip completed todos
				if (todo.status === "completed") continue;
				
				// Check if task already exists for this todo
				const existingTaskId = await todoManager.getTaskForTodo(todo.content, sessionId);
				if (existingTaskId) continue;
				
				// Create new task
				const taskId = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				
				// Persist to database via Prisma (handler responsibility)
				await ctx.prisma.task.create({
					data: {
						id: taskId,
						text: todo.content,
						status: todo.status === "in_progress" ? "in_progress" : "pending",
						priority: todo.status === "in_progress" ? 75 : 50,
						metadata: {
							source: "todo_write",
							activeForm: todo.activeForm,
						},
					},
				});
				
				// Use TodoManager for Redis operations
				await todoManager.storeTask(taskId, todo);
				await todoManager.mapTodoToTask(todo.content, taskId, sessionId);
				await todoManager.emitTaskCreateEvent(taskId, todo);
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