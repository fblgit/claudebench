import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskListInput, taskListOutput } from "@/schemas/task.schema";
import type { TaskListInput, TaskListOutput } from "@/schemas/task.schema";

@EventHandler({
	event: "task.list",
	inputSchema: taskListInput,
	outputSchema: taskListOutput,
	persist: false,
	rateLimit: 100,
	description: "List and filter tasks from PostgreSQL with pagination and sorting",
})
export class TaskListHandler {
	@Instrumented(0)
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 10000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				tasks: [],
				totalCount: 0,
				hasMore: false,
			})
		}
	})
	async handle(input: TaskListInput, ctx: EventContext): Promise<TaskListOutput> {
		// Build Prisma where clause
		const where: any = {};

		if (input.status) {
			where.status = input.status;
		}

		if (input.assignedTo) {
			where.assignedTo = input.assignedTo;
		}

		if (input.priority !== undefined) {
			where.priority = input.priority;
		}

		// Build Prisma orderBy clause
		const orderBy: any = {};
		orderBy[input.orderBy] = input.order;

		// Get total count and tasks in parallel for better performance
		const [totalCount, tasks] = await Promise.all([
			ctx.prisma.task.count({ where }),
			ctx.prisma.task.findMany({
				where,
				orderBy,
				skip: input.offset,
				take: input.limit,
				select: {
					id: true,
					text: true,
					status: true,
					priority: true,
					assignedTo: true,
					metadata: true,
					result: true,
					error: true,
					createdAt: true,
					updatedAt: true,
					completedAt: true,
				},
			}),
		]);

		// Calculate if there are more results
		const hasMore = input.offset + input.limit < totalCount;

		// Format dates to ISO strings and handle type conversions
		// Also fetch attachment counts for each task
		const formattedTasks = await Promise.all(
			tasks.map(async (task) => {
				// Fetch attachment information
				const attachmentsIndexKey = `cb:task:${task.id}:attachments`;
				let attachmentCount = 0;
				let attachmentKeys: string[] = [];
				let resultAttachment = null;
				
				try {
					// Get attachment count from Redis
					attachmentCount = await ctx.redis.pub.zcard(attachmentsIndexKey);
					
					// Also get attachment keys for discovery and fetch result attachment
					if (attachmentCount > 0 && ctx.prisma) {
						const attachments = await ctx.prisma.taskAttachment.findMany({
							where: { taskId: task.id },
							select: { 
								key: true,
								type: true,
								value: true,
								content: true,
								createdAt: true
							},
							take: 20 // Limit keys to prevent response bloat
						});
						
						attachmentKeys = attachments.map(a => a.key);
						
						// Find and include the "result" attachment content if it exists
						const resultAtt = attachments.find(a => a.key === 'result');
						if (resultAtt) {
							resultAttachment = {
								type: resultAtt.type,
								value: resultAtt.value || undefined,
								content: resultAtt.content || undefined,
								// We'll add createdAt conditionally later based on includeTimestamps
							};
						}
					}
				} catch (error) {
					// Silently handle errors - attachment info is non-critical for listing
					attachmentCount = 0;
					attachmentKeys = [];
					resultAttachment = null;
				}
				
				const taskData: any = {
					...task,
					metadata: task.metadata as Record<string, unknown> | null,
					result: task.result as unknown,
					attachmentCount,
					attachmentKeys, // Include keys for discovery
				};

				// Only include timestamps if requested
				if (input.includeTimestamps) {
					taskData.createdAt = task.createdAt.toISOString();
					taskData.updatedAt = task.updatedAt.toISOString();
					taskData.completedAt = task.completedAt ? task.completedAt.toISOString() : null;
				}

				// Add result attachment (with or without timestamp based on above)
				if (resultAttachment) {
					taskData.resultAttachment = resultAttachment;
				} else {
					taskData.resultAttachment = null;
				}

				return taskData;
			})
		);

		return {
			tasks: formattedTasks,
			totalCount,
			hasMore,
		};
	}
}