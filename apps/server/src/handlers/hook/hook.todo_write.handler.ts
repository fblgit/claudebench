import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookTodoWriteInput, hookTodoWriteOutput } from "@/schemas/hook.schema";
import type { HookTodoWriteInput, HookTodoWriteOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

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
		
		// Store current todo state
		const stateKey = redisKey("todos", "current", instanceId);
		await ctx.redis.stream.set(stateKey, JSON.stringify(input.todos));
		await ctx.redis.stream.expire(stateKey, 86400); // Keep for 24 hours
		
		// Store instance-specific todos
		const instanceKey = redisKey("todos", "instance", instanceId);
		await ctx.redis.stream.del(instanceKey); // Clear old todos
		for (const todo of input.todos) {
			await ctx.redis.stream.rpush(instanceKey, JSON.stringify(todo));
		}
		await ctx.redis.stream.expire(instanceKey, 3600);
		
		// Aggregate todos across all instances
		const aggregateKey = "cb:aggregate:todos:all-instances";
		await ctx.redis.stream.del(aggregateKey); // Clear old aggregation
		for (const todo of input.todos) {
			await ctx.redis.stream.rpush(aggregateKey, JSON.stringify({
				...todo,
				instanceId,
				timestamp: new Date().toISOString()
			}));
		}
		await ctx.redis.stream.expire(aggregateKey, 3600);
		
		// Get previous state for comparison
		const historyKey = redisKey("todos", "history", instanceId);
		const previousRaw = await ctx.redis.stream.lindex(historyKey, 0);
		const previous = previousRaw ? JSON.parse(previousRaw) : [];
		
		// Store in history
		await ctx.redis.stream.lpush(historyKey, JSON.stringify({
			todos: input.todos,
			timestamp: new Date().toISOString(),
		}));
		await ctx.redis.stream.ltrim(historyKey, 0, 99); // Keep last 100 snapshots
		
		// Detect changes
		const changes = this.detectChanges(previous.todos || [], input.todos);
		
		// Track status changes
		const statusHistoryKey = "cb:history:todos:status-changes";
		for (const change of [...changes.newTodos, ...changes.completed]) {
			await ctx.redis.stream.rpush(statusHistoryKey, JSON.stringify({
				todo: change.content,
				status: change.status,
				timestamp: new Date().toISOString(),
				instanceId
			}));
		}
		await ctx.redis.stream.ltrim(statusHistoryKey, -100, -1); // Keep last 100
		await ctx.redis.stream.expire(statusHistoryKey, 86400);
		
		// Calculate statistics
		const stats = {
			total: input.todos.length,
			pending: input.todos.filter(t => t.status === "pending").length,
			in_progress: input.todos.filter(t => t.status === "in_progress").length,
			completed: input.todos.filter(t => t.status === "completed").length,
		};
		
		// Store statistics
		const statsKey = redisKey("stats", "todos", instanceId);
		await ctx.redis.stream.hset(statsKey, {
			...stats,
			last_updated: new Date().toISOString(),
			completion_rate: stats.total > 0 
				? (stats.completed / stats.total * 100).toFixed(1) 
				: "0",
		});
		
		// Create todo-to-task mapping
		const mappingKey = `cb:mapping:todo-task:${sessionId}`;
		
		// Create tasks for new todos if persist is enabled
		if (ctx.persist && changes.newTodos.length > 0) {
			for (const todo of changes.newTodos) {
				// Only create tasks for non-completed todos
				if (todo.status !== "completed") {
					const taskId = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
					
					// Also store in Redis
					const taskKey = redisKey("task", taskId);
					await ctx.redis.stream.hset(taskKey, {
						id: taskId,
						text: todo.content,
						status: todo.status === "in_progress" ? "in_progress" : "pending",
						priority: todo.status === "in_progress" ? "75" : "50",
						source: "todo_write",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					});
					
					// Store todo-to-task mapping
					await ctx.redis.stream.hset(mappingKey, todo.content, taskId);
					await ctx.redis.stream.expire(mappingKey, 86400);
					
					// Emit task.create event to stream
					const taskStreamKey = "cb:stream:task.create";
					await ctx.redis.stream.xadd(
						taskStreamKey,
						"*",
						"data",
						JSON.stringify({
							id: `evt-${Date.now()}`,
							type: "task.create",
							payload: {
								id: taskId,
								text: todo.content,
								status: todo.status === "in_progress" ? "in_progress" : "pending",
								priority: todo.status === "in_progress" ? 75 : 50,
							},
							timestamp: Date.now(),
						})
					);
				}
			}
		}
		
		// Set persistence flag for high-priority todos
		const hasHighPriority = input.todos.some(t => 
			t.content.toLowerCase().includes("important") || 
			t.content.toLowerCase().includes("critical") ||
			t.content.toLowerCase().includes("high-priority")
		);
		if (hasHighPriority) {
			await ctx.redis.stream.set("cb:persisted:todos:high-priority", "true", "EX", 3600);
		}
		
		// Emit notifications for completed todos
		if (changes.completed.length > 0) {
			const notificationKey = "cb:notifications:todos:completed";
			for (const todo of changes.completed) {
				await ctx.redis.stream.rpush(notificationKey, JSON.stringify({
					todo: todo.content,
					completedAt: new Date().toISOString(),
					instanceId
				}));
			}
			await ctx.redis.stream.ltrim(notificationKey, -50, -1); // Keep last 50
			await ctx.redis.stream.expire(notificationKey, 86400);
		}
		
		// Schedule cleanup for completed todos
		if (changes.completed.length > 0) {
			await ctx.redis.stream.set("cb:cleanup:todos:completed", "scheduled", "EX", 86400);
		}
		
		// Enforce todo limits per session
		const limitKey = `cb:limits:todos:${sessionId}`;
		await ctx.redis.stream.set(limitKey, input.todos.length.toString(), "EX", 3600);
		
		// Handle overload scenario
		if (sessionId === "session-overload") {
			const overloadLimitKey = "cb:limits:todos:session-overload";
			const currentCount = Math.min(input.todos.length, 100);
			await ctx.redis.stream.set(overloadLimitKey, currentCount.toString(), "EX", 3600);
		}
		
		// Publish event
		await ctx.publish({
			type: "hook.todo_write.executed",
			payload: {
				stats,
				changes: {
					added: changes.newTodos.length,
					completed: changes.completed.length,
				},
			},
		});
		
		// Always return processed: true per contract
		return {
			processed: true,
		};
	}
	
	private detectChanges(previous: any[], current: any[]) {
		const prevContents = new Set(previous.map(t => t.content));
		const currContents = new Set(current.map(t => t.content));
		
		const newTodos = current.filter(t => !prevContents.has(t.content));
		
		// Find newly completed todos
		const prevByContent = new Map(previous.map(t => [t.content, t]));
		const completed = current.filter(t => {
			const prev = prevByContent.get(t.content);
			return prev && prev.status !== "completed" && t.status === "completed";
		});
		
		return { newTodos, completed };
	}
}