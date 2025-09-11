import { EventHandler } from "@/core/decorator";
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
	async handle(input: HookTodoWriteInput, ctx: EventContext): Promise<HookTodoWriteOutput> {
		// Store current todo state
		const stateKey = redisKey("todos", "current", ctx.instanceId || "default");
		await ctx.redis.stream.set(stateKey, JSON.stringify(input.todos));
		await ctx.redis.stream.expire(stateKey, 86400); // Keep for 24 hours
		
		// Get previous state for comparison
		const historyKey = redisKey("todos", "history", ctx.instanceId || "default");
		const previousRaw = await ctx.redis.stream.lindex(historyKey, 0);
		const previous = previousRaw ? JSON.parse(previousRaw) : [];
		
		// Store in history
		await ctx.redis.stream.lpush(historyKey, JSON.stringify({
			todos: input.todos,
			timestamp: new Date().toISOString(),
		}));
		await ctx.redis.stream.ltrim(historyKey, 0, 99); // Keep last 100 snapshots
		
		// Calculate statistics
		const stats = {
			total: input.todos.length,
			pending: input.todos.filter(t => t.status === "pending").length,
			in_progress: input.todos.filter(t => t.status === "in_progress").length,
			completed: input.todos.filter(t => t.status === "completed").length,
		};
		
		// Store statistics
		const statsKey = redisKey("stats", "todos", ctx.instanceId || "default");
		await ctx.redis.stream.hset(statsKey, {
			...stats,
			last_updated: new Date().toISOString(),
			completion_rate: stats.total > 0 
				? (stats.completed / stats.total * 100).toFixed(1) 
				: "0",
		});
		
		// Detect changes
		const changes = this.detectChanges(previous, input.todos);
		
		// Create tasks for new todos if persist is enabled
		if (ctx.persist && changes.newTodos.length > 0) {
			for (const todo of changes.newTodos) {
				// Only create tasks for non-completed todos
				if (todo.status !== "completed") {
					const taskId = `t-${Date.now()}`;
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
				}
			}
		}
		
		// Track metrics
		const metricsKey = redisKey("metrics", "hooks", "todo_write");
		await ctx.redis.stream.hincrby(metricsKey, "total", 1);
		await ctx.redis.stream.hincrby(metricsKey, `todos_${stats.total}`, 1);
		
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