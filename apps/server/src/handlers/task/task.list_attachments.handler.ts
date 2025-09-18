import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { 
	taskListAttachmentsInput, 
	taskListAttachmentsOutput,
	type TaskListAttachmentsInput,
	type TaskListAttachmentsOutput 
} from "@/schemas/task-attachment.schema";

@EventHandler({
	event: "task.list_attachments",
	inputSchema: taskListAttachmentsInput,
	outputSchema: taskListAttachmentsOutput,
	persist: false,
	rateLimit: 100,
	description: "List and filter task attachments with pagination",
	mcp: {
		title: "List Task Attachments",
		metadata: {
			examples: [
				{
					description: "List all attachments for a task",
					input: {
						taskId: "t-123456"
					}
				},
				{
					description: "Filter attachments by type",
					input: {
						taskId: "t-123456",
						type: "json",
						limit: 10
					}
				}
			],
			tags: ["task-management", "attachments", "query"],
			useCases: [
				"Viewing all attachments for a task",
				"Filtering attachments by type",
				"Paginating through large attachment lists",
				"Checking what data is attached to a task"
			]
		}
	}
})
export class TaskListAttachmentsHandler {
	@Instrumented(1)
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				attachments: [],
				totalCount: 0,
				hasMore: false
			})
		}
	})
	async handle(input: TaskListAttachmentsInput, ctx: EventContext): Promise<TaskListAttachmentsOutput> {
		let attachments: any[] = [];
		let totalCount = 0;
		
		// Try Redis first
		const attachmentsIndexKey = `cb:task:${input.taskId}:attachments`;
		const allKeys = await ctx.redis.pub.zrange(attachmentsIndexKey, 0, -1);
		
		if (allKeys && allKeys.length > 0) {
			// Fetch attachments from Redis
			const attachmentPromises = allKeys.map(async (key: string) => {
				const attachmentKey = `cb:task:${input.taskId}:attachment:${key}`;
				const data = await ctx.redis.pub.hgetall(attachmentKey);
				if (data && Object.keys(data).length > 0) {
					return {
						...data,
						value: data.value ? JSON.parse(data.value) : undefined,
						size: data.size ? parseInt(data.size) : undefined
					};
				}
				return null;
			});
			
			const redisAttachments = (await Promise.all(attachmentPromises)).filter((a: any) => a !== null);
			
			// Filter by type if specified
			if (input.type) {
				attachments = redisAttachments.filter((a: any) => a.type === input.type);
			} else {
				attachments = redisAttachments;
			}
			
			totalCount = attachments.length;
			
			// Apply pagination
			attachments = attachments.slice(input.offset, input.offset + input.limit);
		} else if (ctx.prisma) {
			// Fallback to PostgreSQL
			const where: any = { taskId: input.taskId };
			if (input.type) {
				where.type = input.type;
			}
			
			const [dbCount, dbAttachments] = await Promise.all([
				ctx.prisma.taskAttachment.count({ where }),
				ctx.prisma.taskAttachment.findMany({
					where,
					skip: input.offset,
					take: input.limit,
					orderBy: { createdAt: 'desc' }
				})
			]);
			
			totalCount = dbCount;
			attachments = dbAttachments.map(a => ({
				id: a.id,
				taskId: a.taskId,
				key: a.key,
				type: a.type,
				value: a.value,
				content: a.content,
				url: a.url,
				size: a.size,
				mimeType: a.mimeType,
				createdBy: a.createdBy,
				createdAt: a.createdAt.toISOString(),
				updatedAt: a.updatedAt.toISOString()
			}));
			
			// Cache in Redis for next time
			if (attachments.length > 0) {
				const pipeline = ctx.redis.pub.pipeline();
				for (const attachment of attachments) {
					const attachmentKey = `cb:task:${input.taskId}:attachment:${attachment.key}`;
					const dataToStore = {
						...attachment,
						value: attachment.value ? JSON.stringify(attachment.value) : null
					};
					pipeline.hset(attachmentKey, dataToStore);
					pipeline.zadd(attachmentsIndexKey, Date.parse(attachment.createdAt), attachment.key);
				}
				pipeline.expire(attachmentsIndexKey, 3600); // 1 hour TTL
				await pipeline.exec();
			}
		}
		
		const hasMore = input.offset + input.limit < totalCount;
		
		// Update metrics
		await ctx.redis.pub.hincrby("cb:metrics:attachments", "list_queries", 1);
		
		return {
			attachments,
			totalCount,
			hasMore
		};
	}
}