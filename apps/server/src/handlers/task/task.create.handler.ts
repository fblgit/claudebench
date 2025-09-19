import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import type { TaskCreateInput, TaskCreateOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "task.create",
	inputSchema: taskCreateInput,
	outputSchema: taskCreateOutput,
	persist: true,
	rateLimit: 10,
	description: "Create a new task and add it to the queue",
	mcp: {
		title: "Create Task",
		metadata: {
			examples: [
				{
					description: "Create a simple development task",
					input: {
						text: "Review the new API documentation",
						priority: 75
					}
				},
				{
					description: "Create a high-priority bug fix task",
					input: {
						text: "Fix authentication bug in login flow",
						priority: 95,
						metadata: {
							assignee: "developer@company.com",
							sprint: "sprint-2025-01",
							severity: "high"
						}
					}
				}
			],
			tags: ["task-management", "workflow", "productivity"],
			useCases: [
				"Creating work items for team management",
				"Adding todos to project workflows",
				"Tracking bug reports and feature requests",
				"Planning sprint tasks and deliverables"
			],
			prerequisites: [
				"Valid authentication session",
				"Permission to create tasks in the workspace"
			],
			warnings: [
				"Tasks are created in 'pending' status and must be explicitly assigned",
				"Priority values range from 0-100 (higher = more important)",
				"Large metadata objects may impact performance"
			]
		}
	}
})
export class TaskCreateHandler {
	@Instrumented(0) // No caching - this operation creates new resources
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 tasks per minute (increased for testing)
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				id: "t-fallback",
				text: "Service temporarily unavailable",
				status: "pending",
				priority: 50,
				createdAt: new Date().toISOString()
			})
		}
	})
	async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
		const taskId = `t-${Date.now()}`; // Format per data model: t-{timestamp}
		const now = new Date().toISOString();
		
		// Use Lua script for atomic task creation and queue addition
		const result = await redisScripts.createTask(
			taskId,
			input.text,
			input.priority || 50,
			"pending",
			now,
			input.metadata || null
		);
		
		if (!result.success) {
			throw new Error(result.error || "Failed to create task");
		}
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.create({
				data: {
					id: taskId,
					text: input.text,
					status: "pending",
					priority: input.priority || 50,
					metadata: input.metadata as any || undefined,
				},
			});
		}
		
		// NOTE: Removed auto-assignment to respect separation of concerns
		// Tasks should be explicitly assigned via task.assign handler
		// This allows tests and systems to control assignment timing
		
		// Publish event for subscribers
		await ctx.publish({
			type: "task.created",
			payload: {
				id: taskId,
				text: input.text,
				status: "pending",
				priority: input.priority || 50,
				createdAt: now,
			},
			metadata: {
				createdBy: ctx.instanceId,
			},
		});
		
		// Metrics are now updated by the Lua script
		
		return {
			id: taskId,
			text: input.text,
			status: "pending",
			priority: input.priority || 50,
			createdAt: now,
		};
	}
}