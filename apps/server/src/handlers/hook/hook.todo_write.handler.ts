import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookTodoWriteInput, hookTodoWriteOutput } from "@/schemas/hook.schema";
import type { HookTodoWriteInput, HookTodoWriteOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

interface TodoItem {
	content: string;
	status: "pending" | "in_progress" | "completed";
	activeForm: string;
}

@EventHandler({
	event: "hook.todo_write",
	inputSchema: hookTodoWriteInput,
	outputSchema: hookTodoWriteOutput,
	persist: true,
	rateLimit: 50,
	description: "Process TodoWrite events and create corresponding tasks",
})
export class TodoWriteHookHandler {
	async handle(input: HookTodoWriteInput, ctx: EventContext): Promise<HookTodoWriteOutput> {
		const metricsKey = redisKey("metrics", "hooks", "todo_write");
		const todoStateKey = redisKey("todos", input.sessionId);
		
		// Track metrics
		await ctx.redis.stream.hincrby(metricsKey, "total_calls", 1);
		await ctx.redis.stream.hincrby(metricsKey, input.operation || "update", 1);
		
		// Get previous state for comparison
		const previousStateRaw = await ctx.redis.stream.get(todoStateKey);
		const previousState: TodoItem[] = previousStateRaw ? JSON.parse(previousStateRaw) : [];
		
		// Detect what changed
		const changes = this.detectChanges(previousState, input.todos);
		
		// Store current todo state
		await ctx.redis.stream.set(todoStateKey, JSON.stringify(input.todos));
		await ctx.redis.stream.expire(todoStateKey, 86400); // Keep for 24 hours
		
		// Process changes and create tasks
		const tasksCreated: string[] = [];
		const notifications: string[] = [];
		
		for (const change of changes.added) {
			// Create a task for each new todo item
			const taskId = await this.createTask(change, ctx, input);
			if (taskId) {
				tasksCreated.push(taskId);
				notifications.push(`Created task: ${change.content}`);
			}
		}
		
		// Update tasks for status changes
		for (const change of changes.statusChanged) {
			await this.updateTaskStatus(change, ctx, input);
			
			// Track status transitions
			const transitionKey = redisKey("transitions", input.sessionId, Date.now().toString());
			await ctx.redis.stream.hset(transitionKey, {
				from: change.oldStatus,
				to: change.newStatus,
				content: change.item.content,
				timestamp: new Date().toISOString(),
			});
			await ctx.redis.stream.expire(transitionKey, 3600);
			
			if (change.newStatus === "completed") {
				notifications.push(`Completed: ${change.item.content}`);
			} else if (change.newStatus === "in_progress") {
				notifications.push(`Started: ${change.item.content}`);
			}
		}
		
		// Track removed todos
		for (const removed of changes.removed) {
			const removedKey = redisKey("removed_todos", input.sessionId, Date.now().toString());
			await ctx.redis.stream.hset(removedKey, {
				content: removed.content,
				status: removed.status,
				timestamp: new Date().toISOString(),
			});
			await ctx.redis.stream.expire(removedKey, 3600);
		}
		
		// Validate todo list consistency
		const validationIssues = this.validateTodos(input.todos);
		let modifiedTodos: TodoItem[] | undefined;
		
		if (validationIssues.length > 0) {
			// Fix validation issues
			modifiedTodos = this.fixValidationIssues(input.todos, validationIssues);
			notifications.push(...validationIssues.map(issue => `Fixed: ${issue}`));
		}
		
		// Check for productivity patterns
		const patterns = await this.analyzeProductivityPatterns(input.todos, ctx, input.sessionId);
		if (patterns.length > 0) {
			notifications.push(...patterns);
		}
		
		// Store todo history
		const historyKey = redisKey("todo_history", input.sessionId);
		await ctx.redis.stream.lpush(historyKey, JSON.stringify({
			todos: input.todos,
			timestamp: new Date().toISOString(),
			instanceId: input.instanceId,
			tasksCreated,
		}));
		await ctx.redis.stream.ltrim(historyKey, 0, 99); // Keep last 100 snapshots
		
		// Calculate statistics
		const stats = {
			total: input.todos.length,
			pending: input.todos.filter(t => t.status === "pending").length,
			in_progress: input.todos.filter(t => t.status === "in_progress").length,
			completed: input.todos.filter(t => t.status === "completed").length,
		};
		
		// Store session statistics
		const statsKey = redisKey("stats", "todos", input.sessionId);
		await ctx.redis.stream.hset(statsKey, {
			...stats,
			last_updated: new Date().toISOString(),
			completion_rate: (stats.completed / Math.max(stats.total, 1) * 100).toFixed(1),
		});
		
		// Persist to PostgreSQL if significant changes
		if (ctx.persist && (tasksCreated.length > 0 || changes.statusChanged.length > 0)) {
			// Store significant changes as tasks for audit
			for (const taskId of tasksCreated) {
				await ctx.prisma.task.create({
					data: {
						id: taskId,
						title: `TodoWrite: ${input.todos.find(t => t.status === "in_progress")?.content || "Task"}`,
						description: `Auto-created from TodoWrite event`,
						status: "PENDING",
						priority: 5,
						metadata: {
							source: "todo_write",
							sessionId: input.sessionId,
							instanceId: input.instanceId,
							changes: {
								added: changes.added.length,
								removed: changes.removed.length,
								statusChanged: changes.statusChanged.length,
							},
						},
					},
				});
			}
		}
		
		// Publish event
		await ctx.publish({
			type: "hook.todo_write_processed",
			payload: {
				sessionId: input.sessionId,
				instanceId: input.instanceId,
				stats,
				changes: {
					added: changes.added.length,
					removed: changes.removed.length,
					statusChanged: changes.statusChanged.length,
				},
			},
			metadata: {
				tasksCreated,
			},
		});
		
		return {
			accepted: true,
			modifiedTodos,
			tasksCreated: tasksCreated.length > 0 ? tasksCreated : undefined,
			notifications: notifications.length > 0 ? notifications : undefined,
		};
	}
	
	private detectChanges(previous: TodoItem[], current: TodoItem[]) {
		const added: TodoItem[] = [];
		const removed: TodoItem[] = [];
		const statusChanged: Array<{ item: TodoItem; oldStatus: string; newStatus: string }> = [];
		
		// Create maps for efficient lookup
		const prevMap = new Map(previous.map(item => [item.content, item]));
		const currMap = new Map(current.map(item => [item.content, item]));
		
		// Find added and status changed
		for (const [content, item] of currMap) {
			const prevItem = prevMap.get(content);
			if (!prevItem) {
				added.push(item);
			} else if (prevItem.status !== item.status) {
				statusChanged.push({
					item,
					oldStatus: prevItem.status,
					newStatus: item.status,
				});
			}
		}
		
		// Find removed
		for (const [content, item] of prevMap) {
			if (!currMap.has(content)) {
				removed.push(item);
			}
		}
		
		return { added, removed, statusChanged };
	}
	
	private async createTask(todo: TodoItem, ctx: EventContext, input: HookTodoWriteInput): Promise<string | null> {
		// Don't create tasks for completed todos
		if (todo.status === "completed") {
			return null;
		}
		
		// Create task via task.create event
		const taskId = `task-todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		
		// Store task mapping
		const mappingKey = redisKey("todo_task_mapping", input.sessionId);
		await ctx.redis.stream.hset(mappingKey, todo.content, taskId);
		
		// Create actual task
		const taskKey = redisKey("task", taskId);
		await ctx.redis.stream.hset(taskKey, {
			id: taskId,
			title: todo.content,
			description: `Auto-created from TodoWrite: ${todo.activeForm}`,
			status: todo.status === "in_progress" ? "IN_PROGRESS" : "PENDING",
			priority: todo.status === "in_progress" ? 10 : 5,
			source: "todo_write",
			sessionId: input.sessionId,
			instanceId: input.instanceId,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		
		// Add to appropriate queue
		const queueKey = redisKey("queue", "tasks", 
			todo.status === "in_progress" ? "active" : "pending");
		await ctx.redis.stream.zadd(queueKey, Date.now(), taskId);
		
		return taskId;
	}
	
	private async updateTaskStatus(change: { item: TodoItem; oldStatus: string; newStatus: string }, 
		ctx: EventContext, input: HookTodoWriteInput) {
		// Find associated task
		const mappingKey = redisKey("todo_task_mapping", input.sessionId);
		const taskId = await ctx.redis.stream.hget(mappingKey, change.item.content);
		
		if (!taskId) return;
		
		// Update task status
		const taskKey = redisKey("task", taskId);
		const newTaskStatus = this.mapTodoStatusToTaskStatus(change.newStatus);
		
		await ctx.redis.stream.hset(taskKey, {
			status: newTaskStatus,
			updatedAt: new Date().toISOString(),
			...(newTaskStatus === "COMPLETED" ? { completedAt: new Date().toISOString() } : {}),
		});
		
		// Move between queues if needed
		if (change.oldStatus !== change.newStatus) {
			const oldQueue = redisKey("queue", "tasks", this.getQueueName(change.oldStatus));
			const newQueue = redisKey("queue", "tasks", this.getQueueName(change.newStatus));
			
			await ctx.redis.stream.zrem(oldQueue, taskId);
			if (change.newStatus !== "completed") {
				await ctx.redis.stream.zadd(newQueue, Date.now(), taskId);
			}
		}
	}
	
	private validateTodos(todos: TodoItem[]): string[] {
		const issues: string[] = [];
		
		// Check for multiple in_progress items (should ideally be just one)
		const inProgressCount = todos.filter(t => t.status === "in_progress").length;
		if (inProgressCount > 3) {
			issues.push(`Too many tasks in progress (${inProgressCount}). Consider focusing on fewer tasks.`);
		}
		
		// Check for missing activeForm
		for (const todo of todos) {
			if (!todo.activeForm || todo.activeForm === todo.content) {
				issues.push(`Todo missing proper activeForm: ${todo.content}`);
			}
		}
		
		return issues;
	}
	
	private fixValidationIssues(todos: TodoItem[], issues: string[]): TodoItem[] {
		const fixed = [...todos];
		
		// Auto-fix missing activeForm
		for (const todo of fixed) {
			if (!todo.activeForm || todo.activeForm === todo.content) {
				// Generate activeForm from content
				todo.activeForm = this.generateActiveForm(todo.content, todo.status);
			}
		}
		
		return fixed;
	}
	
	private generateActiveForm(content: string, status: string): string {
		// Convert imperative to progressive form
		const verbs = {
			"create": "Creating",
			"implement": "Implementing",
			"fix": "Fixing",
			"update": "Updating",
			"add": "Adding",
			"remove": "Removing",
			"test": "Testing",
			"review": "Reviewing",
		};
		
		const lowerContent = content.toLowerCase();
		for (const [imperative, progressive] of Object.entries(verbs)) {
			if (lowerContent.startsWith(imperative)) {
				return content.replace(new RegExp(`^${imperative}`, "i"), progressive);
			}
		}
		
		// Default: add -ing to first word if it's a verb
		return `Working on: ${content}`;
	}
	
	private async analyzeProductivityPatterns(todos: TodoItem[], ctx: EventContext, sessionId: string): Promise<string[]> {
		const patterns: string[] = [];
		
		// Calculate completion velocity
		const historyKey = redisKey("todo_history", sessionId);
		const history = await ctx.redis.stream.lrange(historyKey, 0, 9);
		
		if (history.length >= 3) {
			let completionRate = 0;
			for (const entry of history) {
				const parsed = JSON.parse(entry);
				const completed = parsed.todos.filter((t: TodoItem) => t.status === "completed").length;
				completionRate += completed;
			}
			completionRate = completionRate / history.length;
			
			if (completionRate > 3) {
				patterns.push("🚀 High productivity detected! Maintaining good momentum.");
			} else if (completionRate < 0.5) {
				patterns.push("💡 Consider breaking down tasks into smaller, more manageable pieces.");
			}
		}
		
		// Check for stale tasks
		const pending = todos.filter(t => t.status === "pending");
		if (pending.length > 10) {
			patterns.push("📋 Large backlog detected. Consider prioritizing or removing outdated tasks.");
		}
		
		return patterns;
	}
	
	private mapTodoStatusToTaskStatus(todoStatus: string): string {
		switch (todoStatus) {
			case "in_progress": return "IN_PROGRESS";
			case "completed": return "COMPLETED";
			default: return "PENDING";
		}
	}
	
	private getQueueName(status: string): string {
		switch (status) {
			case "in_progress": return "active";
			case "completed": return "completed";
			default: return "pending";
		}
	}
}