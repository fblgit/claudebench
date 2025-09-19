import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { swarmCreateProjectInput, swarmCreateProjectOutput } from "@/schemas/swarm.schema";
import type { SwarmCreateProjectInput, SwarmCreateProjectOutput } from "@/schemas/swarm.schema";
import { swarmQueue } from "@/core/jobs";
import { getRedis } from "@/core/redis";

@EventHandler({
	event: "swarm.create_project",
	inputSchema: swarmCreateProjectInput,
	outputSchema: swarmCreateProjectOutput,
	persist: true,
	rateLimit: 5,
	description: "Create a new project using swarm intelligence (queue-based)",
	mcp: {
		title: "Create Swarm Project",
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
					},
					output: {
						jobId: "job-123",
						projectId: "proj-456",
						status: "queued",
						queuePosition: 1,
						estimatedMinutes: 45,
						message: "Project queued for processing"
					}
				}
			],
			tags: ["swarm", "project", "queue", "async"],
			useCases: [
				"Creating complex multi-component projects",
				"Orchestrating work across multiple specialists",
				"Asynchronous project setup with progress tracking"
			],
			prerequisites: [
				"Swarm worker must be running",
				"Inference server must be available",
				"Specialists should be registered"
			],
			warnings: [
				"Project creation is asynchronous and may take several minutes",
				"Progress can be tracked via event relay",
				"Large projects may timeout if too complex"
			]
		}
	}
})
export class SwarmCreateProjectHandler {
	@Instrumented(0) // No caching for project creation
	@Resilient({
		rateLimit: { limit: 5, windowMs: 60000 }, // 5 projects per minute
		timeout: 5000, // Quick response as we're just queuing
		circuitBreaker: { 
			threshold: 3, 
			timeout: 30000,
			fallback: () => ({ 
				jobId: "",
				projectId: "",
				status: "failed" as const,
				queuePosition: 0,
				message: "Project creation service unavailable"
			})
		}
	})
	async handle(input: SwarmCreateProjectInput, ctx: EventContext): Promise<SwarmCreateProjectOutput> {
		const redis = getRedis();
		
		// Generate unique project ID
		const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		
		// Store project metadata in Redis for tracking
		const projectKey = `cb:project:${projectId}`;
		await redis.pub.hset(projectKey, {
			project: input.project,
			priority: input.priority.toString(),
			constraints: JSON.stringify(input.constraints || []),
			metadata: JSON.stringify(input.metadata || {}),
			status: "queued",
			createdAt: new Date().toISOString(),
			createdBy: ctx.instanceId,
			sessionId: ctx.metadata?.sessionId || ctx.metadata?.clientId || ""
		});
		
		// Set TTL for project data (7 days)
		await redis.pub.expire(projectKey, 604800);
		
		// Add job to the swarm queue
		const job = await swarmQueue.add(
			"create-project",
			{
				type: "create-project",
				projectId,
				project: input.project,
				priority: input.priority,
				constraints: input.constraints,
				metadata: input.metadata,
				sessionId: ctx.metadata?.sessionId || ctx.metadata?.clientId,
				instanceId: ctx.instanceId
			},
			{
				priority: input.priority,
				removeOnComplete: true,
				removeOnFail: false,
				attempts: 3,
				backoff: {
					type: "exponential",
					delay: 5000
				}
			}
		);
		
		// Get queue position
		const waitingCount = await swarmQueue.getWaitingCount();
		const queuePosition = waitingCount + 1;
		
		// Estimate time based on complexity
		const estimatedMinutes = Math.ceil(
			5 + // Base time
			(input.project.length / 50) + // Complexity based on description length
			(input.constraints?.length || 0) * 2 // Additional time per constraint
		);
		
		// Persist to database if enabled
		if (ctx.persist && ctx.prisma) {
			try {
				await ctx.prisma.swarmProject.create({
					data: {
						id: projectId,
						description: input.project,
						priority: input.priority,
						constraints: input.constraints || [],
						metadata: input.metadata || {},
						status: "queued",
						jobId: job.id || "",
						createdBy: ctx.instanceId
					}
				});
				console.log(`[SwarmCreateProject] Persisted project ${projectId} to PostgreSQL`);
			} catch (error) {
				// Log but don't fail the entire operation
				console.error(`[SwarmCreateProject] Failed to persist to PostgreSQL:`, error);
				// Continue with Redis storage and queue which already succeeded
			}
		}
		
		// Publish project queued event
		await ctx.publish({
			type: "swarm.project.queued",
			payload: {
				projectId,
				jobId: job.id,
				project: input.project,
				priority: input.priority,
				queuePosition,
				estimatedMinutes
			},
			metadata: {
				createdBy: ctx.instanceId,
				sessionId: ctx.metadata?.sessionId || ctx.metadata?.clientId
			}
		});
		
		return {
			jobId: job.id || `job-${projectId}`,
			projectId,
			status: "queued",
			queuePosition,
			estimatedMinutes,
			message: `Project queued for processing. Position ${queuePosition} in queue. Estimated time: ${estimatedMinutes} minutes.`
		};
	}
}