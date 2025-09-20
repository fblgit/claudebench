import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCompleteInput, taskCompleteOutput, TaskStatus } from "@/schemas/task.schema";
import type { TaskCompleteInput, TaskCompleteOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";
import { redisKey } from "@/core/redis";
import { registry } from "@/core/registry";

@EventHandler({
	event: "task.complete",
	inputSchema: taskCompleteInput,
	outputSchema: taskCompleteOutput,
	persist: true,
	rateLimit: 100, // Increased for development
	description: "Mark a task as completed or failed",
	mcp: {
		title: "Complete Task",
		metadata: {
			examples: [
				{
					description: "Complete a task with detailed results",
					input: {
						id: "t-12345",
						result: {
							documentsReviewed: 15,
							issuesFound: 3,
							timeSpent: "2h 30m"
						},
						workerId: "worker-123"
					}
				},
				{
					description: "Complete a simple task",
					input: {
						id: "t-67890"
					}
				}
			],
			tags: ["task-management", "completion", "workflow"],
			useCases: [
				"Marking work items as finished",
				"Recording task completion with results",
				"Updating task status in project workflows",
				"Closing completed tickets and issues"
			],
			prerequisites: [
				"Task must exist and be in 'pending' or 'in_progress' status",
				"User must be the assigned worker or have admin privileges"
			],
			warnings: [
				"Tasks must be assigned before they can be completed",
				"Only assigned workers can complete their own tasks",
				"This action cannot be undone - use task.update to change status instead",
				"Large result objects are stored in PostgreSQL and may impact performance"
			]
		}
	}
})
export class TaskCompleteHandler {
	@Instrumented(0) // No caching - this operation changes state
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 requests per minute (increased for development)
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => {
				throw new Error("Task completion service temporarily unavailable");
			}
		}
	})
	async handle(input: TaskCompleteInput, ctx: EventContext): Promise<TaskCompleteOutput> {
		// Support both 'id' and 'taskId' fields
		const taskId = input.id || input.taskId;
		if (!taskId) {
			throw new Error("Task ID is required");
		}
		
		// Get task data to calculate duration
		const taskKey = redisKey("task", taskId);
		const taskData = await ctx.redis.stream.hgetall(taskKey);
		
		if (!taskData || Object.keys(taskData).length === 0) {
			throw new Error(`Task not found: ${taskId}`);
		}
		
		// Calculate duration
		const createdAt = new Date(taskData.createdAt as string).getTime();
		const now = Date.now();
		const duration = now - createdAt;
		const completedAt = new Date().toISOString();
		
		// Use Lua script for atomic completion with cleanup
		const result = await redisScripts.completeTask(
			taskId,
			input.result,
			completedAt,
			duration
		);
		
		if (!result.success) {
			throw new Error(result.error || `Failed to complete task: ${taskId}`);
		}
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			try {
				// Parse result if it's a string
				let parsedResult = input.result;
				if (typeof input.result === 'string') {
					try {
						parsedResult = JSON.parse(input.result);
					} catch {
						// Keep as string if not valid JSON
					}
				}
				
				const resultSize = parsedResult ? JSON.stringify(parsedResult).length : 0;
				
				// Store result in database
				await ctx.prisma.task.update({
					where: { id: taskId },
					data: {
						status: result.status as "completed" | "failed",
						completedAt: new Date(completedAt),
						result: parsedResult as any || undefined,
						metadata: {
							...(taskData.metadata ? JSON.parse(taskData.metadata) : {}),
							duration,
							completedBy: input.workerId || taskData.assignedTo,
							resultSize,
						},
					},
				});
				
				// Store the result as an attachment
				if (parsedResult !== null && parsedResult !== undefined) {
					await registry.executeHandler("task.create_attachment", {
						taskId: taskId,
						key: "result",
						type: "json",
						value: parsedResult
					}, ctx.metadata?.clientId);
					
					console.log(`Task ${taskId} result stored as attachment. Size: ${resultSize} bytes`);
				}
				
				console.log(`Task ${taskId} completed and persisted. Result size: ${resultSize} bytes`);
			} catch (error) {
				// Log error but don't fail the task completion
				console.error(`Failed to persist task ${taskId} to database:`, error);
				
				// Still try to update status even if result storage fails
				try {
					await ctx.prisma.task.update({
						where: { id: taskId },
						data: {
							status: result.status as "completed" | "failed",
							completedAt: new Date(completedAt),
							error: `Failed to store result: ${error instanceof Error ? error.message : String(error)}`,
							metadata: {
								...(taskData.metadata ? JSON.parse(taskData.metadata) : {}),
								duration,
								completedBy: input.workerId || taskData.assignedTo,
								persistenceError: error instanceof Error ? error.message : String(error),
							},
						},
					});
				} catch (fallbackError) {
					console.error(`Failed to update task status for ${taskId}:`, fallbackError);
				}
			}
		}
		
		// Publish event
		await ctx.publish({
			type: "task.completed",
			payload: {
				id: taskId,
				status: result.status,
				duration,
			},
			metadata: {
				completedBy: input.workerId || taskData.assignedTo,
			},
		});
		
		// Return simplified output per contract
		return {
			id: taskId,
			status: result.status as "completed" | "failed",
			completedAt,
		};
	}
}