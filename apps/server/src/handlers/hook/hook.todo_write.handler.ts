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
		// Use instanceId from input (Claude Code hooks) or from context
		const instanceId = input.instanceId || ctx.metadata?.clientId || ctx.instanceId || "default";
		const sessionId = input.sessionId || ctx.metadata?.sessionId || instanceId || "session-123";
		
		// Auto-register the instance if it doesn't exist (for Claude Code instances)
		const instanceKey = `cb:instance:${instanceId}`;
		const instanceExists = await ctx.redis.stream.exists(instanceKey);
		if (!instanceExists) {
			try {
				// Register the instance with basic worker role
				await registry.executeHandler("system.register", {
					id: instanceId,
					roles: ["worker"],
				});
			} catch (error: any) {
				console.warn(`Could not auto-register instance ${instanceId}:`, error?.message);
				// Continue anyway - task creation will still work
			}
		}
		
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
					
					// If todo is already in_progress, assign it and update status
					if (todo.status === "in_progress") {
						try {
							// First assign the task
							await registry.executeHandler("task.assign", {
								taskId: taskResult.id,
								instanceId: instanceId,
							});
							
							// Then update status to in_progress
							await registry.executeHandler("task.update", {
								id: taskResult.id,
								updates: {
									status: "in_progress",
									metadata: {
										startedBy: "todo_write",
										startedAt: new Date().toISOString(),
									},
								},
							});
						} catch (error: any) {
							console.error(`Failed to assign/start task ${taskResult.id}:`, error?.message || error);
							// Log the full error for debugging
							if (error?.stack) console.error("Stack:", error.stack);
						}
					}
					
					// Also emit our own task event for tracking
					await todoManager.emitTaskCreateEvent(taskResult.id, todo);
				} catch (error: any) {
					// Log errors but continue with other todos
					console.error(`Failed to create task for todo "${todo.content}":`, error?.message || error);
					if (error?.stack) console.error("Stack:", error.stack);
				}
			}
		}
		
		// 4b. Process status changes for existing todos (update tasks)
		if (changes.statusChanges.length > 0) {
			for (const todo of changes.statusChanges) {
				// Get the task ID for this todo
				const taskId = await todoManager.getTaskForTodo(todo.content, sessionId);
				if (!taskId) {
					// If no task exists for this todo, create one
					try {
						const taskResult = await registry.executeHandler("task.create", {
							text: todo.content,
							priority: todo.status === "in_progress" ? 75 : 50,
							metadata: {
								source: "todo_write",
								activeForm: todo.activeForm,
								sessionId,
							},
						});
						await todoManager.mapTodoToTask(todo.content, taskResult.id, sessionId);
						
						// If todo is in_progress, assign it and update status
						if (todo.status === "in_progress") {
							await registry.executeHandler("task.assign", {
								taskId: taskResult.id,
								instanceId: instanceId,
							});
							await registry.executeHandler("task.update", {
								id: taskResult.id,
								updates: {
									status: "in_progress",
									metadata: {
										startedBy: "todo_write",
										startedAt: new Date().toISOString(),
									},
								},
							});
						}
					} catch (error: any) {
						console.error(`Failed to create task for changed todo "${todo.content}":`, error?.message || error);
						if (error?.stack) console.error("Stack:", error.stack);
					}
					continue;
				}
				
				try {
					// Map todo status to task status
					let taskStatus: string;
					if (todo.status === "completed") {
						// For completed todos, we need to handle the case where the task wasn't assigned
						// First, try to complete it normally
						try {
							await registry.executeHandler("task.complete", {
								id: taskId,
								workerId: instanceId,
								result: {
									completedBy: "todo_write",
									completedAt: new Date().toISOString(),
								},
							});
							continue;
						} catch (completeError: any) {
							// If it fails because it's not assigned, update status directly
							if (completeError?.message?.includes("not assigned")) {
								// Just update the status to completed
								await registry.executeHandler("task.update", {
									id: taskId,
									updates: {
										status: "completed",
										metadata: {
											completedBy: "todo_write",
											completedAt: new Date().toISOString(),
											activeForm: todo.activeForm,
										},
									},
								});
								continue;
							}
							// Re-throw other errors
							throw completeError;
						}
					} else if (todo.status === "in_progress") {
						taskStatus = "in_progress";
					} else {
						taskStatus = "pending";
					}
					
					// If todo is now in_progress, assign it to this instance first
					if (todo.status === "in_progress") {
						try {
							// Try to assign the task to this instance
							await registry.executeHandler("task.assign", {
								taskId: taskId,
								instanceId: instanceId,
							});
						} catch (assignError: any) {
							// If already assigned, that's ok - we'll still update the status
							if (!assignError?.message?.includes("already assigned")) {
								console.error(`Failed to assign task ${taskId}:`, assignError?.message || assignError);
								if (assignError?.stack) console.error("Stack:", assignError.stack);
								// Skip updating to in_progress if we can't assign
								taskStatus = "pending";
							}
						}
					}
					
					// Update the task with new status and activeForm
					await registry.executeHandler("task.update", {
						id: taskId,
						updates: {
							status: taskStatus,
							priority: todo.status === "in_progress" ? 75 : 50,
							metadata: {
								activeForm: todo.activeForm,
								lastUpdatedBy: "todo_write",
							},
						},
					});
				} catch (error: any) {
					console.error(`Failed to update task for todo "${todo.content}":`, error?.message || error);
					if (error?.stack) console.error("Stack:", error.stack);
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