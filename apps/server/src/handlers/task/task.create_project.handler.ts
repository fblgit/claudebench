import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCreateProjectInput, taskCreateProjectOutput } from "@/schemas/task.schema";
import type { TaskCreateProjectInput, TaskCreateProjectOutput } from "@/schemas/task.schema";
import { registry } from "@/core/registry";
import { getRedis } from "@/core/redis";

@EventHandler({
	event: "task.create_project",
	inputSchema: taskCreateProjectInput,
	outputSchema: taskCreateProjectOutput,
	persist: false,
	rateLimit: 5,
	description: "Create a new project as a task with automatic decomposition into subtasks",
	mcp: {
		title: "Create Project",
		metadata: {
			examples: [
				{
					description: "Create a dashboard project",
					input: {
						project: "Create a real-time analytics dashboard with charts and filters",
						priority: 85,
						constraints: [
							"Use React and TypeScript",
							"Include WebSocket support",
							"Add export functionality"
						]
					}
				}
			],
			tags: ["task", "project", "decomposition"],
			useCases: [
				"Creating complex multi-component projects",
				"Orchestrating work across multiple specialists",
				"Structured project initialization with automatic task creation"
			],
			prerequisites: [
				"MCP sampling capability enabled",
				"Task system operational"
			],
			warnings: [
				"Project creation triggers automatic decomposition",
				"May take up to 5 minutes for complex projects",
				"Creates multiple tasks automatically"
			]
		}
	}
})
export class TaskCreateProjectHandler {
	@Instrumented(0)
	@Resilient({
		rateLimit: { limit: 5, windowMs: 60000 },
		timeout: 300000, // 5 minutes for full project creation
		circuitBreaker: { 
			threshold: 3, 
			timeout: 30000,
			fallback: () => ({ 
				projectId: "",
				taskId: "",
				status: "failed" as const,
				message: "Project creation service unavailable",
				attachmentKey: ""
			})
		}
	})
	async handle(input: TaskCreateProjectInput, ctx: EventContext): Promise<TaskCreateProjectOutput> {
		const redis = getRedis();
		
		// Generate unique project ID
		const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const timestamp = Date.now();
		
		// Use session ID from input or context
		const sessionId = input.sessionId || 
			ctx.metadata?.sessionId || 
			ctx.metadata?.clientId || 
			ctx.instanceId;
			
		// Create the main project task
		let taskId: string;
		try {
			const taskResult = await registry.executeHandler("task.create", {
				text: `[Project] ${input.project}`,
				priority: input.priority,
				metadata: {
					...input.metadata,
					type: "project",
					projectId: projectId,
					sessionId: sessionId,
					constraints: input.constraints,
					requirements: input.requirements,
					isParentTask: true
				}
			}, ctx.metadata?.clientId);
			
			taskId = taskResult.id;
			console.log(`[TaskCreateProject] Created parent task ${taskId} for project ${projectId}`);
		} catch (error) {
			console.error(`[TaskCreateProject] Failed to create task:`, error);
			throw new Error("Failed to create project task");
		}
		
		// Store project metadata in Redis for quick access
		const projectKey = `cb:project:${projectId}`;
		await redis.pub.hset(projectKey, {
			projectId: projectId,
			parentTaskId: taskId,
			description: input.project,
			priority: String(input.priority),
			constraints: JSON.stringify(input.constraints || []),
			requirements: JSON.stringify(input.requirements || []),
			metadata: JSON.stringify(input.metadata || {}),
			status: "created",
			sessionId: sessionId,
			createdAt: new Date().toISOString(),
			createdBy: ctx.instanceId
		});
		
		// Set TTL for Redis cache (7 days)
		await redis.pub.expire(projectKey, 604800);
		
		// Create project attachment with full details
		const attachmentKey = `project_${timestamp}`;
		try {
			await registry.executeHandler("task.create_attachment", {
				taskId: taskId,
				key: attachmentKey,
				type: "json",
				value: {
					projectId: projectId,
					parentTaskId: taskId,
					description: input.project,
					priority: input.priority,
					constraints: input.constraints || [],
					requirements: input.requirements || [],
					metadata: input.metadata || {},
					status: "created",
					sessionId: sessionId,
					createdAt: new Date().toISOString(),
					createdBy: ctx.instanceId,
					estimatedMinutes: this.estimateComplexity(input.project, input.constraints)
				}
			}, ctx.metadata?.clientId);
			
			console.log(`[TaskCreateProject] Created project attachment '${attachmentKey}' for task ${taskId}`);
		} catch (error) {
			console.error(`[TaskCreateProject] Failed to create project attachment:`, error);
		}
		
		// Estimate complexity
		const estimatedMinutes = this.estimateComplexity(input.project, input.constraints);
		
		// Publish project created event
		await ctx.publish({
			type: "task.project.created",
			payload: {
				projectId: projectId,
				parentTaskId: taskId,
				description: input.project,
				priority: input.priority,
				estimatedMinutes: estimatedMinutes
			},
			metadata: {
				createdBy: ctx.instanceId,
				sessionId: sessionId,
				timestamp: timestamp
			}
		});
		
		// Trigger automatic decomposition
		try {
			const decomposeResult = await registry.executeHandler("task.decompose", {
				taskId: taskId,
				task: input.project,
				priority: input.priority,
				constraints: input.constraints,
				sessionId: sessionId,
				metadata: {
					projectId: projectId,
					source: "task.create_project"
				}
			}, ctx.metadata?.clientId);
			
			console.log(`[TaskCreateProject] Decomposition complete for project ${projectId}: ${decomposeResult.subtaskCount} subtasks`);
			
			// Update project status
			await redis.pub.hset(projectKey, {
				status: "decomposed",
				subtaskCount: String(decomposeResult.subtaskCount)
			});
			
			// Create tasks from decomposition subtasks
			const createdTaskIds: string[] = [];
			const subtaskMapping: Record<string, string> = {}; // Map subtask IDs to task IDs
			
			for (const subtask of decomposeResult.decomposition.subtasks) {
				try {
					// Create a task for each subtask
					const subtaskResult = await registry.executeHandler("task.create", {
						text: subtask.description,
						priority: Math.max(10, input.priority - 10), // Slightly lower priority than parent
						metadata: {
							type: "subtask",
							projectId: projectId,
							parentTaskId: taskId,
							subtaskId: subtask.id,
							specialist: subtask.specialist,
							complexity: subtask.complexity,
							estimatedMinutes: subtask.estimatedMinutes,
							dependencies: subtask.dependencies,
							context: subtask.context,
							rationale: (subtask as any).rationale,
							sessionId: sessionId
						}
					}, ctx.metadata?.clientId);
					
					createdTaskIds.push(subtaskResult.id);
					subtaskMapping[subtask.id] = subtaskResult.id;
					
					// Store subtask context as attachment
					await registry.executeHandler("task.create_attachment", {
						taskId: subtaskResult.id,
						key: `subtask_context_${timestamp}`,
						type: "json",
						value: {
							projectId: projectId,
							parentTaskId: taskId,
							subtaskId: subtask.id,
							specialist: subtask.specialist,
							dependencies: subtask.dependencies,
							context: subtask.context,
							rationale: (subtask as any).rationale,
							complexity: subtask.complexity,
							estimatedMinutes: subtask.estimatedMinutes
						}
					}, ctx.metadata?.clientId);
					
					console.log(`[TaskCreateProject] Created task ${subtaskResult.id} for subtask: ${subtask.description}`);
				} catch (error) {
					console.error(`[TaskCreateProject] Failed to create task for subtask ${subtask.id}:`, error);
				}
			}
			
			// Store task mapping in project attachment
			await registry.executeHandler("task.create_attachment", {
				taskId: taskId,
				key: `project_tasks_${timestamp}`,
				type: "json",
				value: {
					projectId: projectId,
					parentTaskId: taskId,
					createdTasks: createdTaskIds,
					subtaskMapping: subtaskMapping,
					totalTasks: createdTaskIds.length,
					decompositionKey: decomposeResult.attachmentKey,
					strategy: decomposeResult.decomposition.executionStrategy,
					totalComplexity: decomposeResult.decomposition.totalComplexity,
					reasoning: decomposeResult.decomposition.reasoning,
					createdAt: new Date().toISOString()
				}
			}, ctx.metadata?.clientId);
			
			// Update Redis with task information
			await redis.pub.hset(projectKey, {
				status: "ready",
				taskCount: String(createdTaskIds.length),
				taskIds: JSON.stringify(createdTaskIds)
			});
			
			// Publish project ready event
			await ctx.publish({
				type: "task.project.ready",
				payload: {
					projectId: projectId,
					parentTaskId: taskId,
					createdTasks: createdTaskIds,
					totalTasks: createdTaskIds.length,
					strategy: decomposeResult.decomposition.executionStrategy
				},
				metadata: {
					sessionId: sessionId,
					timestamp: Date.now()
				}
			});
			
			return {
				projectId: projectId,
				taskId: taskId,
				status: "ready",
				estimatedMinutes: estimatedMinutes,
				message: `Project created with ${createdTaskIds.length} tasks. Ready for execution.`,
				attachmentKey: attachmentKey
			};
			
		} catch (error) {
			console.error(`[TaskCreateProject] Decomposition failed for project ${projectId}:`, error);
			
			// Update status to indicate manual intervention needed
			await redis.pub.hset(projectKey, "status", "needs_decomposition");
			
			// Project created but decomposition failed
			return {
				projectId: projectId,
				taskId: taskId,
				status: "created",
				estimatedMinutes: estimatedMinutes,
				message: "Project created but decomposition failed. Manual intervention required.",
				attachmentKey: attachmentKey
			};
		}
	}
	
	/**
	 * Estimate project complexity in minutes
	 */
	private estimateComplexity(description: string, constraints?: string[]): number {
		const baseTime = 10;
		const descriptionComplexity = Math.ceil(description.length / 100) * 5;
		const constraintComplexity = (constraints?.length || 0) * 3;
		
		return baseTime + descriptionComplexity + constraintComplexity;
	}
}