import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { 
	taskCreateAttachmentInput, 
	taskCreateAttachmentOutput,
	type TaskCreateAttachmentInput,
	type TaskCreateAttachmentOutput 
} from "@/schemas/task.schema";

@EventHandler({
	event: "task.create_attachment",
	inputSchema: taskCreateAttachmentInput,
	outputSchema: taskCreateAttachmentOutput,
	persist: true,
	rateLimit: 50,
	description: "Add data linked to a task, like a key-value store for tasks",
	mcp: {
		title: "Create Task Attachment",
		metadata: {
			examples: [
				{
					description: "Attach JSON analysis data to a task",
					input: {
						taskId: "t-123456",
						key: "analysis",
						type: "json",
						value: {
							complexity: "high",
							estimatedHours: 8,
							dependencies: ["auth", "database"]
						}
					}
				},
				{
					description: "Attach markdown documentation to a task",
					input: {
						taskId: "t-123456",
						key: "implementation_notes",
						type: "markdown",
						content: "## Implementation Details\n\n- Use Redis for caching\n- Implement rate limiting"
					}
				},
				{
					description: "Attach external URL reference",
					input: {
						taskId: "t-123456",
						key: "reference_doc",
						type: "url",
						url: "https://docs.example.com/api/v2"
					}
				}
			],
			tags: ["task-management", "attachments", "metadata"],
			useCases: [
				"Attaching analysis results to tasks",
				"Storing implementation notes and documentation",
				"Linking external resources and references",
				"Adding structured data for processing",
				"Storing logs and debug information"
			],
			prerequisites: [
				"Task must exist",
				"Unique key per task (will overwrite if exists)"
			],
			warnings: [
				"Large attachments may impact performance",
				"Binary attachments store only references, not actual data"
			]
		}
	}
})
export class TaskCreateAttachmentHandler {
	@Instrumented(1)
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				id: "ta-fallback",
				taskId: "",
				key: "",
				type: "text",
				createdAt: new Date().toISOString()
			})
		}
	})
	async handle(input: TaskCreateAttachmentInput, ctx: EventContext): Promise<TaskCreateAttachmentOutput> {
		// Validate input based on type
		if (!input.value && !input.content && !input.url) {
			throw new Error("At least one of value, content, or url must be provided");
		}
		
		if (input.type === "json" && !input.value) {
			throw new Error("JSON attachments require a value field");
		}
		
		if ((input.type === "markdown" || input.type === "text") && !input.content) {
			throw new Error(`${input.type} attachments require a content field`);
		}
		
		if (input.type === "url" && !input.url) {
			throw new Error("URL attachments require a url field");
		}
		
		// Generate attachment ID
		const attachmentId = `ta-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date().toISOString();
		
		// First, verify task exists in Redis
		const taskKey = `cb:task:${input.taskId}`;
		const taskExists = await ctx.redis.pub.exists(taskKey);
		
		if (!taskExists) {
			// If not in Redis, check PostgreSQL
			if (ctx.persist && ctx.prisma) {
				const task = await ctx.prisma.task.findUnique({
					where: { id: input.taskId }
				});
				if (!task) {
					throw new Error(`Task ${input.taskId} not found`);
				}
			} else {
				throw new Error(`Task ${input.taskId} not found`);
			}
		}
		
		// Prepare attachment data
		const attachmentData = {
			id: attachmentId,
			taskId: input.taskId,
			key: input.key,
			type: input.type,
			value: input.value ? JSON.stringify(input.value) : null,
			content: input.content || null,
			url: input.url || null,
			size: input.size ? input.size.toString() : null,
			mimeType: input.mimeType || null,
			createdBy: ctx.instanceId || null,
			createdAt: now,
			updatedAt: now,
		};
		
		// Store in Redis
		const attachmentKey = `cb:task:${input.taskId}:attachment:${input.key}`;
		await ctx.redis.pub.hset(attachmentKey, attachmentData);
		
		// Also add to attachments index
		const attachmentsIndexKey = `cb:task:${input.taskId}:attachments`;
		await ctx.redis.pub.zadd(attachmentsIndexKey, Date.now(), input.key);
		
		// Persist to PostgreSQL if configured
		if (ctx.persist && ctx.prisma) {
			try {
				// Check if attachment with this key already exists
				const existing = await ctx.prisma.taskAttachment.findUnique({
					where: {
						taskId_key: {
							taskId: input.taskId,
							key: input.key
						}
					}
				});
				
				if (existing) {
					// Update existing attachment
					await ctx.prisma.taskAttachment.update({
						where: {
							id: existing.id
						},
						data: {
							type: input.type,
							value: input.value || undefined,
							content: input.content || undefined,
							url: input.url || undefined,
							size: input.size || undefined,
							mimeType: input.mimeType || undefined,
							updatedAt: new Date()
						}
					});
				} else {
					// Create new attachment
					await ctx.prisma.taskAttachment.create({
						data: {
							id: attachmentId,
							taskId: input.taskId,
							key: input.key,
							type: input.type,
							value: input.value || undefined,
							content: input.content || undefined,
							url: input.url || undefined,
							size: input.size || undefined,
							mimeType: input.mimeType || undefined,
							createdBy: ctx.instanceId || undefined,
						}
					});
				}
			} catch (error) {
				console.error("Failed to persist attachment to PostgreSQL", { error, input });
				throw new Error(`Failed to persist attachment: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		}
		
		// Publish event
		await ctx.redis.pub.publish("task.attachment_created", JSON.stringify({
			taskId: input.taskId,
			key: input.key,
			type: input.type,
			attachmentId,
			instanceId: ctx.instanceId,
			timestamp: Date.now()
		}));
		
		// Update metrics
		await ctx.redis.pub.hincrby("cb:metrics:attachments", "created", 1);
		await ctx.redis.pub.hincrby(`cb:metrics:attachments:type`, input.type, 1);
		
		return {
			id: attachmentId,
			taskId: input.taskId,
			key: input.key,
			type: input.type,
			createdAt: now
		};
	}
}