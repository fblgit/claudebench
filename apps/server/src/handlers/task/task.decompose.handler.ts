import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskDecomposeInput, taskDecomposeOutput } from "@/schemas/task.schema";
import type { TaskDecomposeInput, TaskDecomposeOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";
import { getSamplingService } from "@/core/sampling";
import { registry } from "@/core/registry";
import { getRedis } from "@/core/redis";

@EventHandler({
	event: "task.decompose",
	inputSchema: taskDecomposeInput,
	outputSchema: taskDecomposeOutput,
	persist: false,
	rateLimit: 10,
	description: "Decompose complex task into subtasks using LLM intelligence",
	mcp: {
		title: "Decompose Task",
		metadata: {
			examples: [
				{
					description: "Decompose a feature development task",
					input: {
						taskId: "t-123",
						task: "Add dark mode toggle to settings page",
						priority: 75,
						constraints: ["Use React hooks", "Follow atomic design pattern"]
					}
				}
			],
			tags: ["task", "decomposition", "orchestration"],
			useCases: [
				"Breaking down complex features into parallel work",
				"Identifying dependencies between subtasks",
				"Optimizing work distribution across specialists"
			],
			prerequisites: [
				"Task must exist in the system",
				"MCP sampling capability enabled"
			],
			warnings: [
				"Decomposition uses LLM sampling which may take up to 600 seconds",
				"Large tasks may produce many subtasks",
				"Decomposition is stored as task attachment"
			]
		}
	}
})
export class TaskDecomposeHandler {
	@Instrumented(0)
	@Resilient({
		rateLimit: { limit: 10, windowMs: 60000 },
		timeout: 300000,
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000,
			fallback: () => ({ 
				taskId: "",
				subtaskCount: 0,
				decomposition: {
					subtasks: [],
					executionStrategy: "sequential" as const,
					totalComplexity: 0,
					reasoning: "Service temporarily unavailable"
				},
				attachmentKey: ""
			})
		}
	})
	async handle(input: TaskDecomposeInput, ctx: EventContext): Promise<TaskDecomposeOutput> {
		const redis = getRedis();
		
		// Verify task exists
		const taskKey = `cb:task:${input.taskId}`;
		const taskExists = await redis.pub.exists(taskKey);
		
		if (!taskExists) {
			// Try to fetch from database
			if (ctx.prisma) {
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
		
		// Get available specialists for decomposition context
		const specialists = await redisScripts.getActiveSpecialists();
		
		if (specialists.length === 0) {
			console.warn("[TaskDecompose] No active specialists, using default specialist types");
			specialists.push(
				{ id: "default-frontend", type: "frontend", capabilities: [], currentLoad: 0, maxCapacity: 10 },
				{ id: "default-backend", type: "backend", capabilities: [], currentLoad: 0, maxCapacity: 10 },
				{ id: "default-testing", type: "testing", capabilities: [], currentLoad: 0, maxCapacity: 10 },
				{ id: "default-docs", type: "docs", capabilities: [], currentLoad: 0, maxCapacity: 10 }
			);
		}
		
		// Get sampling service
		const samplingService = getSamplingService();
		
		// Use session ID from input or context
		const sessionId = input.sessionId || 
			ctx.metadata?.sessionId || 
			ctx.metadata?.clientId || 
			ctx.instanceId;
			
		if (!sessionId) {
			throw new Error("No session ID available for sampling");
		}
		
		// Get worker's working directory from instance metadata
		let workingDirectory: string | undefined;
		// First check if a specific worker was requested in the input metadata
		const requestedWorkerId = input.metadata?.workerId;
		const workerId = requestedWorkerId || ctx.instanceId;
		
		if (workerId) {
			const instanceKey = `cb:instance:${workerId}`;
			const instanceMetadata = await redis.pub.hget(instanceKey, 'metadata');
			if (instanceMetadata) {
				try {
					const metadata = JSON.parse(instanceMetadata);
					workingDirectory = metadata.workingDirectory;
					console.log(`[TaskDecompose] Using working directory from instance ${workerId}: ${workingDirectory}`);
				} catch (e) {
					console.warn(`[TaskDecompose] Failed to parse instance metadata for ${workerId}:`, e);
				}
			} else if (requestedWorkerId) {
				console.warn(`[TaskDecompose] Requested worker ${requestedWorkerId} not found or has no metadata`);
			}
		}
		
		// Request decomposition via sampling
		const decomposition = await samplingService.requestDecomposition(
			sessionId,
			input.task,
			{
				specialists,
				priority: input.priority,
				constraints: input.constraints,
				workingDirectory
			}
		);
		
		// Store decomposition in Redis for quick access
		const timestamp = Date.now();
		const decompositionKey = `cb:decomposition:${input.taskId}`;
		await redis.pub.hset(decompositionKey, {
			taskId: input.taskId,
			taskText: input.task,
			strategy: decomposition.executionStrategy,
			totalComplexity: String(decomposition.totalComplexity),
			subtaskCount: String(decomposition.subtasks.length),
			timestamp: String(timestamp),
			sessionId: sessionId
		});
		
		// Set expiration for Redis cache (7 days)
		await redis.pub.expire(decompositionKey, 604800);
		
		// Generate attachment key
		const attachmentKey = `decomposition_${timestamp}`;
		
		// Store decomposition as task attachment
		try {
			await registry.executeHandler("task.create_attachment", {
				taskId: input.taskId,
				key: attachmentKey,
				type: "json",
				value: {
					taskId: input.taskId,
					taskText: input.task,
					strategy: decomposition.executionStrategy,
					totalComplexity: decomposition.totalComplexity,
					reasoning: decomposition.reasoning,
					subtaskCount: decomposition.subtasks.length,
					subtasks: decomposition.subtasks.map(subtask => ({
						id: subtask.id,
						description: subtask.description,
						specialist: subtask.specialist,
						complexity: subtask.complexity,
						estimatedMinutes: subtask.estimatedMinutes,
						dependencies: subtask.dependencies,
						context: subtask.context,
						status: "pending"
					})),
					decomposedAt: new Date().toISOString(),
					decomposedBy: ctx.instanceId,
					sessionId: sessionId,
					metadata: input.metadata
				}
			}, ctx.metadata?.clientId);
			
			console.log(`[TaskDecompose] Decomposition stored as attachment '${attachmentKey}' for task ${input.taskId}`);
		} catch (error) {
			console.error(`[TaskDecompose] Failed to store decomposition as attachment:`, error);
			throw new Error("Failed to store task decomposition");
		}
		
		// Store subtasks in Redis for tracking
		for (const subtask of decomposition.subtasks) {
			const subtaskKey = `cb:subtask:${subtask.id}`;
			await redis.pub.hset(subtaskKey, {
				id: subtask.id,
				parentTaskId: input.taskId,
				description: subtask.description,
				specialist: subtask.specialist,
				complexity: String(subtask.complexity),
				estimatedMinutes: String(subtask.estimatedMinutes),
				dependencies: JSON.stringify(subtask.dependencies),
				status: "pending",
				createdAt: String(timestamp)
			});
			
			// Add to specialist queue if no dependencies
			if (subtask.dependencies.length === 0) {
				const queueKey = `cb:queue:specialist:${subtask.specialist}`;
				await redis.pub.zadd(queueKey, timestamp + subtask.complexity, subtask.id);
			}
		}
		
		// Publish decomposition completed event
		await ctx.publish({
			type: "task.decomposed",
			payload: {
				taskId: input.taskId,
				subtaskCount: decomposition.subtasks.length,
				strategy: decomposition.executionStrategy,
				totalComplexity: decomposition.totalComplexity,
				attachmentKey: attachmentKey
			},
			metadata: {
				decomposedBy: ctx.instanceId,
				sessionId: sessionId,
				timestamp: timestamp
			}
		});
		
		// Trigger assignment for ready subtasks (those without dependencies)
		const readySubtasks = decomposition.subtasks.filter(s => s.dependencies.length === 0);
		for (const subtask of readySubtasks) {
			await ctx.publish({
				type: "task.subtask.ready",
				payload: {
					subtaskId: subtask.id,
					parentTaskId: input.taskId,
					specialist: subtask.specialist,
					description: subtask.description,
					requiredCapabilities: subtask.context.patterns
				},
				metadata: {
					priority: input.priority,
					sessionId: sessionId
				}
			});
		}
		
		console.log(`[TaskDecompose] Decomposed task ${input.taskId} into ${decomposition.subtasks.length} subtasks (${readySubtasks.length} ready)`);
		
		return {
			taskId: input.taskId,
			subtaskCount: decomposition.subtasks.length,
			decomposition,
			attachmentKey
		};
	}
}