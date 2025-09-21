import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskGetProjectInput, taskGetProjectOutput } from "@/schemas/task.schema";
import type { TaskGetProjectInput, TaskGetProjectOutput } from "@/schemas/task.schema";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";

@EventHandler({
	event: "task.get_project",
	inputSchema: taskGetProjectInput,
	outputSchema: taskGetProjectOutput,
	persist: false,
	rateLimit: 30,
	description: "Fetch project-structured tasks with hierarchy and attachments"
})
export class TaskGetProjectHandler {
	@Instrumented(3600) // Cache for 1 hour
	@Resilient({
		rateLimit: { limit: 30, windowMs: 60000 },
		timeout: 10000,
		circuitBreaker: { threshold: 5, timeout: 30000 }
	})
	async handle(input: TaskGetProjectInput, ctx: EventContext): Promise<TaskGetProjectOutput> {
		const redis = getRedis();
		let projectId = input.projectId;
		let parentTaskId = input.taskId;
		
		// If only taskId provided, get projectId from task metadata
		if (!projectId && parentTaskId) {
			const taskData = await ctx.prisma.task.findUnique({
				where: { id: parentTaskId }
			});
			if (!taskData?.metadata) {
				throw new Error(`Task ${parentTaskId} not found or has no metadata`);
			}
			const metadata = taskData.metadata as any;
			projectId = metadata.projectId;
			if (!projectId) {
				throw new Error(`Task ${parentTaskId} is not a project task`);
			}
		}
		
		// If only projectId provided, get parentTaskId from Redis
		if (projectId && !parentTaskId) {
			const projectKey = `cb:project:${projectId}`;
			const redisTaskId = await redis.pub.hget(projectKey, "parentTaskId");
			if (redisTaskId) {
				parentTaskId = redisTaskId;
			}
			if (!parentTaskId) {
				// Fallback to PostgreSQL
				const projectTask = await ctx.prisma.task.findFirst({
					where: {
						metadata: {
							path: ["projectId"],
							equals: projectId
						}
					}
				});
				if (!projectTask) {
					throw new Error(`Project ${projectId} not found`);
				}
				parentTaskId = projectTask.id;
			}
		}
		
		// Fetch parent task with attachments
		const parentTask = await ctx.prisma.task.findUnique({
			where: { id: parentTaskId },
			include: {
				attachments: {
					orderBy: { createdAt: "desc" }
				}
			}
		});
		
		if (!parentTask) {
			throw new Error(`Parent task ${parentTaskId} not found`);
		}
		
		// Fetch all subtasks for this project (excluding the parent task)
		const subtasks = await ctx.prisma.task.findMany({
			where: {
				AND: [
					{
						metadata: {
							path: ["projectId"],
							equals: projectId
						}
					},
					{
						// Exclude parent tasks - they have isParentTask: true
						NOT: {
							metadata: {
								path: ["isParentTask"],
								equals: true
							}
						}
					}
				]
			},
			include: {
				attachments: {
					where: {
						key: {
							startsWith: "subtask_context"
						}
					},
					orderBy: { createdAt: "desc" }
				}
			},
			orderBy: { createdAt: "asc" }
		});
		
		// No need to filter anymore since we excluded parent tasks in the query
		const actualSubtasks = subtasks;
		
		// Get project metadata from Redis cache or attachments
		const projectKey = `cb:project:${projectId}`;
		let projectMetadata: any = {};
		
		const redisData = await redis.pub.hgetall(projectKey);
		if (redisData && Object.keys(redisData).length > 0) {
			projectMetadata = {
				description: redisData.description || "",
				status: redisData.status || "unknown",
				constraints: redisData.constraints ? JSON.parse(redisData.constraints) : [],
				requirements: redisData.requirements ? JSON.parse(redisData.requirements) : [],
				estimatedMinutes: redisData.estimatedMinutes ? parseInt(redisData.estimatedMinutes) : undefined,
				createdAt: redisData.createdAt || new Date().toISOString(),
				createdBy: redisData.createdBy || ctx.instanceId
			};
		} else {
			// Fallback to attachments
			const projectAttachment = parentTask.attachments.find(a => 
				a.key.startsWith("project_") && a.type === "json"
			);
			if (projectAttachment?.value) {
				const attachmentData = projectAttachment.value as any;
				projectMetadata = {
					description: attachmentData.description || "",
					status: attachmentData.status || "unknown",
					constraints: attachmentData.constraints || [],
					requirements: attachmentData.requirements || [],
					estimatedMinutes: attachmentData.estimatedMinutes,
					createdAt: attachmentData.createdAt || parentTask.createdAt.toISOString(),
					createdBy: attachmentData.createdBy || ctx.instanceId
				};
			}
		}
		
		// Get decomposition data for strategy and complexity
		const decompositionAttachment = parentTask.attachments.find(a =>
			a.key.startsWith("decomposition_") && a.type === "json"
		);
		if (decompositionAttachment?.value) {
			const decomposition = decompositionAttachment.value as any;
			projectMetadata.strategy = decomposition.strategy;
			projectMetadata.totalComplexity = decomposition.totalComplexity;
		}
		
		// Calculate stats
		const stats = {
			totalTasks: actualSubtasks.length + 1, // Include parent
			pendingTasks: actualSubtasks.filter(t => t.status === "pending").length,
			inProgressTasks: actualSubtasks.filter(t => t.status === "in_progress").length,
			completedTasks: actualSubtasks.filter(t => t.status === "completed").length,
			failedTasks: actualSubtasks.filter(t => t.status === "failed").length
		};
		
		// Add parent task status to stats
		if (parentTask.status === "pending") stats.pendingTasks++;
		else if (parentTask.status === "in_progress") stats.inProgressTasks++;
		else if (parentTask.status === "completed") stats.completedTasks++;
		else if (parentTask.status === "failed") stats.failedTasks++;
		
		// Format response
		return {
			projectId: projectId!,
			parentTask: {
				id: parentTask.id,
				text: parentTask.text,
				status: parentTask.status as any,
				priority: parentTask.priority,
				createdAt: parentTask.createdAt.toISOString(),
				updatedAt: parentTask.updatedAt.toISOString(),
				metadata: parentTask.metadata as any,
				attachments: parentTask.attachments.map(a => ({
					key: a.key,
					type: a.type as any,
					value: a.value,
					createdAt: a.createdAt.toISOString()
				}))
			},
			subtasks: actualSubtasks.map(task => {
				const metadata = task.metadata as any || {};
				return {
					id: task.id,
					text: task.text,
					status: task.status as any,
					priority: task.priority,
					specialist: metadata.specialist,
					complexity: metadata.complexity,
					estimatedMinutes: metadata.estimatedMinutes,
					dependencies: metadata.dependencies || [],
					createdAt: task.createdAt.toISOString(),
					updatedAt: task.updatedAt.toISOString(),
					attachments: task.attachments.map(a => ({
						key: a.key,
						type: a.type as any,
						value: a.value,
						createdAt: a.createdAt.toISOString()
					}))
				};
			}),
			projectMetadata,
			stats
		};
	}
}