import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { swarmSynthesizeInput, swarmSynthesizeOutput } from "@/schemas/swarm.schema";
import type { SwarmSynthesizeInput, SwarmSynthesizeOutput } from "@/schemas/swarm.schema";
import { getSamplingService } from "@/core/sampling";
import { redisScripts } from "@/core/redis-scripts";
import { getRedis } from "@/core/redis";
import nunjucks from "nunjucks";
import { join } from "path";

// Configure nunjucks
const templates = nunjucks.configure(join(process.cwd(), "templates/swarm"), {
	autoescape: true,
	noCache: process.env.NODE_ENV !== "production"
});

@EventHandler({
	event: "swarm.synthesize",
	inputSchema: swarmSynthesizeInput,
	outputSchema: swarmSynthesizeOutput,
	persist: true,
	rateLimit: 10,
	description: "Synthesize completed subtasks into integrated solution using LLM intelligence",
	mcp: {
		title: "Synthesize Swarm Progress",
		metadata: {
			examples: [
				{
					description: "Synthesize completed dark mode feature",
					input: {
						taskId: "t-123",
						completedSubtasks: [
							{
								id: "st-1",
								specialist: "frontend",
								output: "Implemented toggle component with React hooks",
								artifacts: ["components/DarkModeToggle.tsx"]
							},
							{
								id: "st-2",
								specialist: "backend",
								output: "Added preference persistence API",
								artifacts: ["api/preferences.ts"]
							},
							{
								id: "st-3",
								specialist: "testing",
								output: "Created E2E and unit tests",
								artifacts: ["tests/darkmode.test.ts"]
							}
						],
						parentTask: "Add dark mode toggle to settings page"
					}
				}
			],
			tags: ["swarm", "synthesis", "integration"],
			useCases: [
				"Merging work from multiple specialists",
				"Creating cohesive integrated solution",
				"Identifying integration issues",
				"Generating final implementation steps"
			],
			prerequisites: [
				"Triggered by SYNTHESIZE_PROGRESS Lua script",
				"All subtasks must be completed",
				"MCP sampling capability enabled"
			],
			warnings: [
				"Synthesis uses LLM sampling which may take 3-7 seconds",
				"Large codebases may require multiple synthesis passes",
				"Integration conflicts may require manual resolution"
			]
		}
	}
})
export class SwarmSynthesizeHandler {
	@Instrumented(0) // No caching for synthesis
	@Resilient({
		rateLimit: { limit: 10, windowMs: 60000 }, // 10 syntheses per minute
		timeout: 30000, // 30 seconds for LLM response
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000,
			fallback: () => ({ 
				taskId: "",
				integration: {
					status: "requires_fixes" as const,
					integrationSteps: ["Service unavailable"],
					potentialIssues: ["Synthesis service temporarily offline"],
					nextActions: ["Retry synthesis when service recovers"],
					mergedCode: undefined
				}
			})
		}
	})
	async handle(input: SwarmSynthesizeInput, ctx: EventContext): Promise<SwarmSynthesizeOutput> {
		const redis = getRedis();
		
		// Get decomposition data to understand the original task structure
		let decomposition = null;
		const decompositionKey = `cb:decomposition:${input.taskId}`;
		const decompositionData = await redis.pub.hget(decompositionKey, "data");
		
		if (decompositionData) {
			decomposition = JSON.parse(decompositionData);
		} else if (ctx.prisma) {
			// Try to fetch from database
			const dbDecomposition = await ctx.prisma.swarmDecomposition.findUnique({
				where: { id: input.taskId },
				include: {
					subtasks: {
						include: {
							progress: {
								orderBy: { createdAt: "desc" },
								take: 1
							}
						}
					}
				}
			});
			
			if (dbDecomposition) {
				decomposition = {
					taskId: dbDecomposition.taskId,
					taskText: dbDecomposition.taskText,
					strategy: dbDecomposition.strategy,
					subtasks: dbDecomposition.subtasks.map(st => ({
						id: st.id,
						description: st.description,
						specialist: st.specialist,
						dependencies: st.dependencies,
						status: st.status
					}))
				};
			}
		}
		
		// Generate synthesis via sampling
		const samplingService = getSamplingService();
		const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
		
		if (!sessionId) {
			throw new Error("No session ID available for sampling");
		}
		
		// Render the synthesis prompt
		const prompt = templates.render("progress-synthesis.njk", {
			taskId: input.taskId,
			parentTask: input.parentTask,
			completedSubtasks: input.completedSubtasks,
			decomposition,
			timestamp: new Date().toISOString()
		});
		
		const integration = await samplingService.synthesizeProgress(sessionId, {
			completedSubtasks: input.completedSubtasks,
			parentTask: input.parentTask
		});
		
		// Use Lua script to update progress atomically
		// For synthesis, we use a dummy subtask ID since we're synthesizing all
		const progressData = {
			status: integration.status,
			steps: integration.integrationSteps.length,
			issues: integration.potentialIssues.length
		};
		const result = await redisScripts.synthesizeProgress(
			input.taskId,
			`synthesis-${Date.now().toString()}`,
			progressData
		);
		
		// Persist integration to database
		if (ctx.persist && ctx.prisma) {
			await ctx.prisma.swarmIntegration.create({
				data: {
					taskId: input.taskId,
					status: integration.status === "integrated" ? "integrated" : 
					        integration.status === "requires_fixes" ? "requires_fixes" : 
					        "ready_for_integration",
					steps: integration.integrationSteps,
					issues: integration.potentialIssues,
					mergedCode: integration.mergedCode,
					createdAt: new Date(),
					completedAt: integration.status === "integrated" ? new Date() : null
				}
			});
			
			// Update decomposition progress
			const progress = integration.status === "integrated" ? 100 : 90;
			await ctx.prisma.swarmDecomposition.update({
				where: { id: input.taskId },
				data: {
					progress: progress,
					updatedAt: new Date()
				}
			});
			
			// If fully integrated, update all subtasks to completed
			if (integration.status === "integrated") {
				await ctx.prisma.swarmSubtask.updateMany({
					where: { parentId: input.taskId },
					data: { 
						status: "completed",
						completedAt: new Date()
					}
				});
			}
		}
		
		// Publish synthesis event
		const finalProgress = integration.status === "integrated" ? 100 : 90;
		await ctx.publish({
			type: "swarm.synthesized",
			payload: {
				taskId: input.taskId,
				status: integration.status,
				progress: finalProgress,
				integrationSteps: integration.integrationSteps.length,
				issues: integration.potentialIssues.length
			},
			metadata: {
				synthesizedBy: ctx.instanceId,
				timestamp: Date.now()
			}
		});
		
		// If integration is complete, trigger task completion
		if (integration.status === "integrated") {
			await ctx.publish({
				type: "swarm.task_completed",
				payload: {
					taskId: input.taskId,
					mergedCode: !!integration.mergedCode,
					totalSubtasks: input.completedSubtasks.length
				},
				metadata: {
					timestamp: Date.now()
				}
			});
		} else if (integration.potentialIssues.length > 0) {
			// If there are issues, might need to trigger conflict resolution
			for (const issue of integration.potentialIssues) {
				if (issue.toLowerCase().includes("conflict") || issue.toLowerCase().includes("incompatible")) {
					await ctx.publish({
						type: "swarm.integration_conflict",
						payload: {
							taskId: input.taskId,
							issue,
							requiresResolution: true
						},
						metadata: {
							timestamp: Date.now()
						}
					});
				}
			}
		}
		
		return {
			taskId: input.taskId,
			integration: {
				status: integration.status === "integrated" ? "integrated" :
				        integration.status === "requires_fixes" ? "requires_fixes" :
				        "ready_for_integration",
				integrationSteps: integration.integrationSteps,
				potentialIssues: integration.potentialIssues,
				nextActions: integration.nextActions,
				mergedCode: integration.mergedCode
			}
		};
	}
}