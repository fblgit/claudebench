import { EventHandler, Instrumented } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { redisScripts } from "@/core/redis-scripts";
import { 
	taskDeleteInput, 
	taskDeleteOutput, 
	type TaskDeleteInput, 
	type TaskDeleteOutput 
} from "@/schemas/task.schema";

@EventHandler({
	event: "task.delete",
	inputSchema: taskDeleteInput,
	outputSchema: taskDeleteOutput,
	persist: true,
	mcp: {
		title: "Delete Task",
		metadata: {
			examples: [{
				description: "Delete a task by ID",
				input: {
					id: "t-123456",
				},
				output: {
					id: "t-123456",
					deleted: true,
					deletedAt: "2025-01-20T10:30:00.000Z",
				},
			}],
			prerequisites: [
				"Task must exist",
				"User must have permission to delete",
			],
			warnings: [
				"This action cannot be undone",
				"All task attachments will be deleted",
				"Task will be removed from all queues",
			],
			useCases: [
				"Remove completed tasks to clean up",
				"Delete mistakenly created tasks",
				"Clear failed tasks after resolution",
			],
		},
	},
})
export class TaskDeleteHandler {
	@Instrumented(0)
	async handle(
		input: TaskDeleteInput,
		ctx: EventContext
	): Promise<TaskDeleteOutput> {
		const taskId = input.id;
		const now = new Date().toISOString();
		
		// Delete from Redis atomically
		const result = await redisScripts.deleteTask(taskId);
		
		if (!result.deleted) {
			throw new Error(result.error || "Failed to delete task");
		}
		
		// Delete from PostgreSQL if persistence is enabled
		if (ctx.persist) {
			try {
				// Delete attachments first (foreign key constraint)
				await ctx.prisma.taskAttachment.deleteMany({
					where: { taskId },
				});
				
				// Delete the task
				await ctx.prisma.task.delete({
					where: { id: taskId },
				});
			} catch (error) {
				// Log error but don't fail - Redis is source of truth
				console.error("Failed to delete task from PostgreSQL:", error);
			}
		}
		
		// Publish deletion event
		await ctx.publish({
			type: "task.deleted",
			payload: {
				id: taskId,
				deletedAt: now,
				deletedBy: ctx.instanceId,
			},
			metadata: {
				instanceId: ctx.instanceId,
				requestId: ctx.requestId,
			},
		});
		
		return {
			id: taskId,
			deleted: true,
			deletedAt: now,
		};
	}
}