import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { 
	taskGetAttachmentsBatchInput, 
	taskGetAttachmentsBatchOutput 
} from "@/schemas/task.schema";
import type { 
	TaskGetAttachmentsBatchInput, 
	TaskGetAttachmentsBatchOutput 
} from "@/schemas/task.schema";

@EventHandler({
	event: "task.get_attachments_batch",
	inputSchema: taskGetAttachmentsBatchInput,
	outputSchema: taskGetAttachmentsBatchOutput,
	persist: false,
	rateLimit: 100,
	description: "Get multiple attachments in a single batch operation",
})
export class TaskGetAttachmentsBatchHandler {
	@Instrumented(300) // Cache for 5 minutes
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 10, 
			timeout: 30000,
			fallback: () => ({ 
				attachments: []
			})
		}
	})
	async handle(input: TaskGetAttachmentsBatchInput, ctx: EventContext): Promise<TaskGetAttachmentsBatchOutput> {
		if (!ctx.prisma) {
			throw new Error("Database connection required for attachment batch operations");
		}

		// Build a composite key for efficient querying
		const requestKeys = input.requests.map(r => ({
			taskId: r.taskId,
			key: r.key,
		}));

		// Fetch all attachments in a single query using OR conditions
		const attachmentRecords = await ctx.prisma.taskAttachment.findMany({
			where: {
				OR: requestKeys.map(req => ({
					taskId: req.taskId,
					key: req.key,
				})),
			},
		});

		// Create a map for quick lookups
		const attachmentMap = new Map<string, typeof attachmentRecords[0]>();
		for (const record of attachmentRecords) {
			const mapKey = `${record.taskId}:${record.key}`;
			attachmentMap.set(mapKey, record);
		}

		// Build response array maintaining request order
		const attachments = input.requests.map(request => {
			const mapKey = `${request.taskId}:${request.key}`;
			const record = attachmentMap.get(mapKey);

			if (!record) {
				// For missing attachments, throw an error (consistent with single get_attachment)
				throw new Error(`Attachment not found: ${request.taskId}/${request.key}`);
			}

			// Return in the same format as single get_attachment
			return {
				id: record.id,
				taskId: record.taskId,
				key: record.key,
				type: record.type as "json" | "markdown" | "text" | "url" | "binary",
				value: record.value || undefined,
				content: record.content || undefined,
				url: record.url || undefined,
				mimeType: record.mimeType || undefined,
				size: record.size || undefined,
				createdBy: record.createdBy || undefined,
				createdAt: record.createdAt.toISOString(),
				updatedAt: record.updatedAt.toISOString(),
			};
		});

		return {
			attachments,
		};
	}
}