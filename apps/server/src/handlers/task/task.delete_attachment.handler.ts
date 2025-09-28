import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { 
	taskDeleteAttachmentInput, 
	taskDeleteAttachmentOutput,
	type TaskDeleteAttachmentInput,
	type TaskDeleteAttachmentOutput 
} from "@/schemas/task.schema";

@EventHandler({
	event: "task.delete_attachment",
	inputSchema: taskDeleteAttachmentInput,
	outputSchema: taskDeleteAttachmentOutput,
	persist: true,
	rateLimit: 100,
	description: "Delete an attachment from a task",
	mcp: {
		title: "Delete Task Attachment",
		metadata: {
			examples: [
				{
					description: "Delete a specific attachment from a task",
					input: {
						taskId: "t-123456",
						key: "analysis"
					},
					output: {
						id: "ta-123-abc",
						taskId: "t-123456", 
						key: "analysis",
						deleted: true,
						deletedAt: "2024-01-01T12:00:00.000Z"
					}
				}
			],
			warnings: [
				"This action cannot be undone",
				"Attachment will be removed from both Redis and PostgreSQL"
			],
			prerequisites: [
				"Task must exist",
				"Attachment with specified key must exist"
			],
			useCases: [
				"Clean up outdated attachments",
				"Remove sensitive data",
				"Manage attachment storage"
			]
		}
	}
})
export class TaskDeleteAttachmentHandler {
	@Instrumented(0) // No caching for deletion operations
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 deletions per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 10, 
			timeout: 30000,
			fallback: () => ({ 
				id: "",
				taskId: "",
				key: "",
				deleted: false,
				deletedAt: new Date().toISOString()
			})
		}
	})
	async handle(input: TaskDeleteAttachmentInput, ctx: EventContext): Promise<TaskDeleteAttachmentOutput> {
		const now = new Date().toISOString();
		
		// Check if attachment exists in Redis
		const attachmentKey = `cb:task:${input.taskId}:attachment:${input.key}`;
		const attachmentData = await ctx.redis.pub.hgetall(attachmentKey);
		
		if (!attachmentData || Object.keys(attachmentData).length === 0) {
			throw new Error(`Attachment '${input.key}' not found for task ${input.taskId}`);
		}
		
		const attachmentId = attachmentData.id;
		
		// Delete from Redis
		await ctx.redis.pub.del(attachmentKey);
		
		// Remove from attachments index
		const attachmentsIndexKey = `cb:task:${input.taskId}:attachments`;
		await ctx.redis.pub.zrem(attachmentsIndexKey, input.key);
		
		// Delete from PostgreSQL if configured
		if (ctx.persist && ctx.prisma) {
			try {
				await ctx.prisma.taskAttachment.delete({
					where: {
						taskId_key: {
							taskId: input.taskId,
							key: input.key
						}
					}
				});
			} catch (error) {
				console.warn(`[TaskDeleteAttachment] Failed to delete from PostgreSQL:`, error);
				// Continue execution - Redis deletion succeeded
			}
		}
		
		// Emit attachment deleted event
		await ctx.publish({
			type: "task.attachment.deleted",
			payload: {
				taskId: input.taskId,
				key: input.key,
				attachmentId,
			},
			metadata: {
				deletedBy: ctx.instanceId,
				deletedAt: now,
			},
		});
		
		return {
			id: attachmentId,
			taskId: input.taskId,
			key: input.key,
			deleted: true,
			deletedAt: now,
		};
	}
}