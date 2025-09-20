import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { swarmResolveInput, swarmResolveOutput } from "@/schemas/swarm.schema";
import type { SwarmResolveInput, SwarmResolveOutput } from "@/schemas/swarm.schema";
import { getSamplingService } from "@/core/sampling";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import nunjucks from "nunjucks";
import { join } from "path";

// Configure nunjucks
const templates = nunjucks.configure(join(process.cwd(), "templates/swarm"), {
	autoescape: true,
	noCache: process.env.NODE_ENV !== "production"
});

@EventHandler({
	event: "swarm.resolve",
	inputSchema: swarmResolveInput,
	outputSchema: swarmResolveOutput,
	persist: true,
	rateLimit: 20,
	description: "Resolve conflicts between specialist solutions using LLM intelligence",
	mcp: {
		title: "Resolve Swarm Conflict",
		metadata: {
			examples: [
				{
					description: "Resolve conflict between frontend solutions",
					input: {
						conflictId: "conflict-t-123-1234567890",
						solutions: [
							{
								instanceId: "specialist-1",
								approach: "Use React hooks",
								reasoning: "More modern and efficient",
								code: "const [theme, setTheme] = useState('light');"
							},
							{
								instanceId: "specialist-2",
								approach: "Use Redux",
								reasoning: "Better for complex state",
								code: "dispatch(setTheme('light'));"
							}
						],
						context: {
							projectType: "React application",
							requirements: ["Dark mode toggle", "Persistent preference"],
							constraints: ["Minimize bundle size"]
						}
					}
				}
			],
			tags: ["swarm", "conflict", "resolution"],
			useCases: [
				"Resolving disagreements between specialists",
				"Choosing optimal solution based on context",
				"Providing justification for decisions"
			],
			prerequisites: [
				"Conflict must be detected by DETECT_AND_QUEUE_CONFLICT Lua script",
				"At least 2 conflicting solutions must exist",
				"MCP sampling capability enabled"
			],
			warnings: [
				"Resolution uses LLM sampling which may take up to 600 seconds",
				"Resolution is final and cannot be undone",
				"May trigger swarm.synthesize if all conflicts resolved"
			]
		}
	}
})
export class SwarmResolveHandler {
	@Instrumented(60) // Cache resolutions briefly
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 }, // 20 resolutions per minute
		timeout: 300000, // 300 seconds (5 minutes) for LLM response
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000,
			fallback: () => ({ 
				conflictId: "",
				resolution: {
					chosenSolution: "first",
					instanceId: "",
					justification: "Service unavailable - defaulting to first solution",
					recommendations: [],
					modifications: []
				}
			})
		}
	})
	async handle(input: SwarmResolveInput, ctx: EventContext): Promise<SwarmResolveOutput> {
		const redis = getRedis();
		
		// Get conflict data from Redis
		const conflictKey = `cb:conflict:${input.conflictId}`;
		const conflictData = await redis.pub.hget(conflictKey, "data");
		
		if (!conflictData) {
			// Try to fetch from database
			if (ctx.prisma) {
				const conflict = await ctx.prisma.swarmConflict.findUnique({
					where: { id: input.conflictId }
				});
				
				if (!conflict) {
					throw new Error(`Conflict ${input.conflictId} not found`);
				}
				
				// Use database data
				const conflictInfo = {
					id: conflict.id,
					taskId: conflict.taskId,
					solutions: conflict.solutions as any[],
					status: conflict.status
				};
				
				// Generate resolution via sampling
				const samplingService = getSamplingService();
				const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
				
				if (!sessionId) {
					throw new Error("No session ID available for sampling");
				}
				
				// Render the conflict resolution prompt
				const prompt = templates.render("conflict-resolution.njk", {
					conflictId: input.conflictId,
					solutions: input.solutions,
					context: input.context,
					conflictInfo
				});
				
				const resolution = await samplingService.resolveConflict(sessionId, {
					solutions: input.solutions,
					context: input.context
				});
				
				// Update conflict status in database
				await ctx.prisma.swarmConflict.update({
					where: { id: input.conflictId },
					data: {
						status: "resolved",
						resolution: resolution as any,
						resolvedBy: ctx.instanceId,
						resolvedAt: new Date()
					}
				});
				
				// Store resolution as attachment
				try {
					await registry.executeHandler("task.create_attachment", {
						taskId: conflict.taskId,
						key: `resolution_${input.conflictId}`,
						type: "json",
						value: {
							conflictId: input.conflictId,
							resolution: resolution,
							solutions: input.solutions,
							context: input.context,
							resolvedAt: new Date().toISOString(),
							resolvedBy: ctx.instanceId
						}
					}, ctx.metadata?.clientId);
					
					console.log(`[SwarmResolve] Resolution stored as attachment for conflict ${input.conflictId}`);
				} catch (attachmentError) {
					// Log but don't fail - resolution is already stored
					console.warn(`[SwarmResolve] Failed to create resolution attachment:`, attachmentError);
				}
				
				// Publish resolution event
				await ctx.publish({
					type: "swarm.resolved",
					payload: {
						conflictId: input.conflictId,
						chosenInstance: resolution.instanceId,
						taskId: conflict.taskId
					},
					metadata: {
						resolvedBy: ctx.instanceId,
						timestamp: Date.now()
					}
				});
				
				// Check if all conflicts for this task are resolved
				const remainingConflicts = await ctx.prisma.swarmConflict.count({
					where: {
						taskId: conflict.taskId,
						status: "pending"
					}
				});
				
				if (remainingConflicts === 0) {
					// Trigger synthesis
					await ctx.publish({
						type: "swarm.ready_for_synthesis",
						payload: {
							taskId: conflict.taskId
						},
						metadata: {
							timestamp: Date.now()
						}
					});
				}
				
				return {
					conflictId: input.conflictId,
					resolution
				};
			}
			
			throw new Error(`Conflict ${input.conflictId} not found`);
		}
		
		// Parse conflict data
		const conflict = JSON.parse(conflictData);
		
		// Generate resolution via sampling
		const samplingService = getSamplingService();
		const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
		
		if (!sessionId) {
			throw new Error("No session ID available for sampling");
		}
		
		// Render the conflict resolution prompt
		const prompt = templates.render("conflict-resolution.njk", {
			conflictId: input.conflictId,
			solutions: input.solutions,
			context: input.context,
			conflict
		});
		
		const resolution = await samplingService.resolveConflict(sessionId, {
			solutions: input.solutions,
			context: input.context
		});
		
		// Update conflict status in Redis
		await redis.pub.hset(conflictKey, {
			status: "resolved",
			resolution: JSON.stringify(resolution),
			resolvedBy: ctx.instanceId,
			resolvedAt: Date.now()
		});
		
		// Persist to database if needed
		if (ctx.persist && ctx.prisma) {
			try {
				await ctx.prisma.swarmConflict.update({
					where: { id: input.conflictId },
					data: {
						status: "resolved",
						resolution: resolution as any,
						resolvedBy: ctx.instanceId,
						resolvedAt: new Date()
					}
				});
				console.log(`[SwarmResolve] Persisted conflict resolution for ${input.conflictId}`);
			} catch (error) {
				// Log but don't fail the entire operation
				console.error(`[SwarmResolve] Failed to persist to PostgreSQL:`, error);
				// Continue with Redis storage which already succeeded
			}
		}
		
		// Store resolution as attachment
		try {
			// Find the task ID for this conflict
			const taskId = conflict.taskId || input.conflictId.split('-')[1]; // Extract from conflict ID if needed
			
			if (taskId) {
				await registry.executeHandler("task.create_attachment", {
					taskId: taskId,
					key: `resolution_${input.conflictId}`,
					type: "json",
					value: {
						conflictId: input.conflictId,
						resolution: resolution,
						solutions: input.solutions,
						context: input.context,
						resolvedAt: new Date().toISOString(),
						resolvedBy: ctx.instanceId
					}
				}, ctx.metadata?.clientId);
				
				console.log(`[SwarmResolve] Resolution stored as attachment for conflict ${input.conflictId}`);
			}
		} catch (attachmentError) {
			// Log but don't fail - resolution is already stored
			console.warn(`[SwarmResolve] Failed to create resolution attachment:`, attachmentError);
		}
		
		// Publish resolution event
		await ctx.publish({
			type: "swarm.resolved",
			payload: {
				conflictId: input.conflictId,
				chosenInstance: resolution.instanceId,
				taskId: conflict.taskId
			},
			metadata: {
				resolvedBy: ctx.instanceId,
				timestamp: Date.now()
			}
		});
		
		// Check if all conflicts for this task are resolved
		if (ctx.prisma) {
			const remainingConflicts = await ctx.prisma.swarmConflict.count({
				where: {
					taskId: conflict.taskId,
					status: "pending"
				}
			});
			
			if (remainingConflicts === 0) {
				// Trigger synthesis
				await ctx.publish({
					type: "swarm.ready_for_synthesis",
					payload: {
						taskId: conflict.taskId
					},
					metadata: {
						timestamp: Date.now()
					}
				});
			}
		}
		
		return {
			conflictId: input.conflictId,
			resolution
		};
	}
}