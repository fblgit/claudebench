import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { swarmDecomposeInput, swarmDecomposeOutput } from "@/schemas/swarm.schema";
import type { SwarmDecomposeInput, SwarmDecomposeOutput } from "@/schemas/swarm.schema";
import { redisScripts } from "@/core/redis-scripts";
import { getSamplingService } from "@/core/sampling";
import { registry } from "@/core/registry";

@EventHandler({
	event: "swarm.decompose",
	inputSchema: swarmDecomposeInput,
	outputSchema: swarmDecomposeOutput,
	persist: true,
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
						priority: 75
					}
				}
			],
			tags: ["swarm", "decomposition", "orchestration"],
			useCases: [
				"Breaking down complex features into parallel work",
				"Identifying dependencies between subtasks",
				"Optimizing work distribution across specialists"
			],
			prerequisites: [
				"Active specialists registered in the system",
				"MCP sampling capability enabled"
			],
			warnings: [
				"Decomposition uses LLM sampling which may take up to 600 seconds",
				"Ensure sufficient specialists are available for assignment",
				"Large tasks may produce many subtasks affecting system load"
			]
		}
	}
})
export class SwarmDecomposeHandler {
	@Instrumented(0) // No caching for decomposition
	@Resilient({
		rateLimit: { limit: 10, windowMs: 60000 }, // 10 decompositions per minute
		timeout: 300000, // 300 seconds (5 minutes) for LLM response
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
				}
			})
		}
	})
	async handle(input: SwarmDecomposeInput, ctx: EventContext): Promise<SwarmDecomposeOutput> {
		// Get available specialists
		const specialists = await redisScripts.getActiveSpecialists();
		
		if (specialists.length === 0) {
			throw new Error("No active specialists available for task decomposition");
		}
		
		// Get sampling service
		const samplingService = getSamplingService();
		
		// Check if we have a session ID from context
		// MCP passes sessionId as clientId, direct calls may use sessionId or instanceId
		const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
		if (!sessionId) {
			throw new Error("No session ID available for sampling");
		}
		
		// Request decomposition via sampling
		const decomposition = await samplingService.requestDecomposition(
			sessionId,
			input.task,
			{
				specialists,
				priority: input.priority,
				constraints: input.constraints
			}
		);
		
		// Store decomposition atomically in Redis
		const result = await redisScripts.decomposeAndStoreSubtasks(
			input.taskId,
			decomposition,
			Date.now()
		);
		
		if (!result.success) {
			throw new Error("Failed to store task decomposition");
		}
		
		// Persist decomposition to PostgreSQL using Prisma
		if (ctx.persist && ctx.prisma) {
			try {
				// First check if decomposition already exists
				const existing = await ctx.prisma.swarmDecomposition.findUnique({
					where: { id: input.taskId },
					include: { subtasks: true }
				});
				
				if (existing) {
					// Update existing record
					await ctx.prisma.swarmDecomposition.update({
						where: { id: input.taskId },
						data: {
							taskText: input.task,
							subtaskCount: result.subtaskCount,
							strategy: decomposition.executionStrategy,
							totalComplexity: decomposition.totalComplexity,
							reasoning: decomposition.reasoning,
							updatedAt: new Date(),
						}
					});
					console.log(`[SwarmDecompose] Updated existing decomposition for task ${input.taskId}`);
				} else {
					// Create new record with subtasks
					await ctx.prisma.swarmDecomposition.create({
						data: {
							id: input.taskId,
							taskId: input.taskId,
							taskText: input.task,
							subtaskCount: result.subtaskCount,
							strategy: decomposition.executionStrategy,
							totalComplexity: decomposition.totalComplexity,
							reasoning: decomposition.reasoning,
							subtasks: {
								create: decomposition.subtasks.map(subtask => ({
									id: subtask.id,
									description: subtask.description,
									specialist: subtask.specialist,
									complexity: subtask.complexity,
									estimatedMinutes: subtask.estimatedMinutes,
									dependencies: subtask.dependencies,
									context: subtask.context,
									status: "pending"
								}))
							}
						}
					});
					console.log(`[SwarmDecompose] Created new decomposition for task ${input.taskId}`);
				}
			} catch (error) {
				// Log but don't fail the entire operation
				console.error(`[SwarmDecompose] Failed to persist to PostgreSQL:`, error);
				// Continue with Redis storage which already succeeded
			}
		}
		
		// Store decomposition as attachment - must succeed for consistency
		await registry.executeHandler("task.create_attachment", {
			taskId: input.taskId,
			key: "decomposition",
			type: "json",
			value: {
				taskText: input.task,
				strategy: decomposition.executionStrategy,
				totalComplexity: decomposition.totalComplexity,
				reasoning: decomposition.reasoning,
				subtaskCount: result.subtaskCount,
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
				decomposedBy: ctx.instanceId
			}
		}, ctx.metadata?.clientId);
		
		console.log(`[SwarmDecompose] Decomposition stored as attachment for task ${input.taskId}`);
		
		// Trigger assignment for ready subtasks (those without dependencies)
		for (const subtask of decomposition.subtasks) {
			if (subtask.dependencies.length === 0) {
				// Publish event for assignment
				await ctx.publish({
					type: "swarm.assign",
					payload: {
						subtaskId: subtask.id,
						specialist: subtask.specialist,
						requiredCapabilities: subtask.context.patterns // Use patterns as capabilities
					},
					metadata: {
						parentTaskId: input.taskId,
						priority: input.priority
					}
				});
			}
		}
		
		// Publish decomposition completed event
		await ctx.publish({
			type: "swarm.decomposed",
			payload: {
				taskId: input.taskId,
				subtaskCount: result.subtaskCount,
				queuedCount: result.queuedCount,
				strategy: decomposition.executionStrategy
			},
			metadata: {
				decomposedBy: ctx.instanceId,
				timestamp: Date.now()
			}
		});
		
		return {
			taskId: input.taskId,
			subtaskCount: result.subtaskCount,
			decomposition
		};
	}
}