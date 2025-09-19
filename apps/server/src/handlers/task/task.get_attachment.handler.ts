import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { 
	taskGetAttachmentInput, 
	taskGetAttachmentOutput,
	type TaskGetAttachmentInput,
	type TaskGetAttachmentOutput 
} from "@/schemas/task-attachment.schema";

@EventHandler({
	event: "task.get_attachment",
	inputSchema: taskGetAttachmentInput,
	outputSchema: taskGetAttachmentOutput,
	persist: false,
	rateLimit: 100,
	description: "Get a specific task attachment by key",
	mcp: {
		title: "Get Task Attachment",
		metadata: {
			examples: [
				{
					description: "Get analysis attachment",
					input: {
						taskId: "t-123456",
						key: "analysis"
					}
				},
				{
					description: "Get implementation notes",
					input: {
						taskId: "t-123456",
						key: "implementation_notes"
					}
				}
			],
			tags: ["task-management", "attachments", "query"],
			useCases: [
				"Retrieving specific attachment data",
				"Getting analysis results",
				"Fetching documentation attached to tasks",
				"Reading logs or debug information"
			],
			prerequisites: [
				"Task must exist",
				"Attachment with specified key must exist"
			]
		}
	}
})
export class TaskGetAttachmentHandler {
	@Instrumented(1)
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 3000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000
		}
	})
	async handle(input: TaskGetAttachmentInput, ctx: EventContext): Promise<TaskGetAttachmentOutput> {
		// Try Redis first
		const attachmentKey = `cb:task:${input.taskId}:attachment:${input.key}`;
		const redisData = await ctx.redis.pub.hgetall(attachmentKey);
		
		if (redisData && Object.keys(redisData).length > 0) {
			// Found in Redis
			const attachment = {
				id: redisData.id,
				taskId: redisData.taskId,
				key: redisData.key,
				type: redisData.type as any,
				value: redisData.value ? JSON.parse(redisData.value) : undefined,
				content: redisData.content || undefined,
				url: redisData.url || undefined,
				size: redisData.size ? parseInt(redisData.size) : undefined,
				mimeType: redisData.mimeType || undefined,
				createdBy: redisData.createdBy || undefined,
				createdAt: redisData.createdAt,
				updatedAt: redisData.updatedAt
			};
			
			// Update metrics
			await ctx.redis.pub.hincrby("cb:metrics:attachments", "cache_hits", 1);
			
			return attachment;
		}
		
		// Fallback to PostgreSQL
		if (ctx.prisma) {
			const dbAttachment = await ctx.prisma.taskAttachment.findUnique({
				where: {
					taskId_key: {
						taskId: input.taskId,
						key: input.key
					}
				}
			});
			
			if (!dbAttachment) {
				throw new Error(`Attachment with key '${input.key}' not found for task ${input.taskId}`);
			}
			
			// Cache in Redis for next time
			const dataToCache = {
				id: dbAttachment.id,
				taskId: dbAttachment.taskId,
				key: dbAttachment.key,
				type: dbAttachment.type,
				value: dbAttachment.value ? JSON.stringify(dbAttachment.value) : null,
				content: dbAttachment.content || null,
				url: dbAttachment.url || null,
				size: dbAttachment.size?.toString() || null,
				mimeType: dbAttachment.mimeType || null,
				createdBy: dbAttachment.createdBy || null,
				createdAt: dbAttachment.createdAt.toISOString(),
				updatedAt: dbAttachment.updatedAt.toISOString()
			};
			
			await ctx.redis.pub.hset(attachmentKey, dataToCache);
			await ctx.redis.pub.expire(attachmentKey, 3600); // 1 hour TTL
			
			// Also update the index
			const attachmentsIndexKey = `cb:task:${input.taskId}:attachments`;
			await ctx.redis.pub.zadd(attachmentsIndexKey, Date.parse(dbAttachment.createdAt.toISOString()), input.key);
			
			// Update metrics
			await ctx.redis.pub.hincrby("cb:metrics:attachments", "cache_misses", 1);
			
			return {
				id: dbAttachment.id,
				taskId: dbAttachment.taskId,
				key: dbAttachment.key,
				type: dbAttachment.type as any,
				value: dbAttachment.value as any || undefined,
				content: dbAttachment.content || undefined,
				url: dbAttachment.url || undefined,
				size: dbAttachment.size || undefined,
				mimeType: dbAttachment.mimeType || undefined,
				createdBy: dbAttachment.createdBy || undefined,
				createdAt: dbAttachment.createdAt.toISOString(),
				updatedAt: dbAttachment.updatedAt.toISOString()
			};
		}
		
		throw new Error(`Attachment with key '${input.key}' not found for task ${input.taskId}`);
	}
}