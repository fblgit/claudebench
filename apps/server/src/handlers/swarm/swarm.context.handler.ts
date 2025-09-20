import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { swarmContextInput, swarmContextOutput } from "@/schemas/swarm.schema";
import type { SwarmContextInput, SwarmContextOutput } from "@/schemas/swarm.schema";
import { getSamplingService } from "@/core/sampling";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import * as nunjucks from "nunjucks";
import * as path from "path";
import { fileURLToPath } from "url";

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Nunjucks environment
const templatesDir = path.join(__dirname, "..", "..", "templates", "swarm");
const nunjucksEnv = nunjucks.configure(templatesDir, {
	autoescape: false, // Don't escape for LLM prompts
	trimBlocks: true,
	lstripBlocks: true
});

@EventHandler({
	event: "swarm.context",
	inputSchema: swarmContextInput,
	outputSchema: swarmContextOutput,
	persist: false, // Context generation is ephemeral
	rateLimit: 50,
	description: "Generate specialized context for subtask execution",
	mcp: {
		title: "Generate Specialist Context",
		metadata: {
			examples: [
				{
					description: "Generate context for frontend specialist",
					input: {
						subtaskId: "st-1",
						specialist: "frontend",
						parentTaskId: "t-123"
					}
				}
			],
			tags: ["swarm", "context", "specialist"],
			useCases: [
				"Providing focused context for specialist instances",
				"Ensuring consistent approach across subtasks",
				"Defining success criteria and constraints"
			],
			prerequisites: [
				"Subtask must exist in the system",
				"MCP sampling capability enabled"
			],
			warnings: [
				"Context generation uses LLM sampling which may take up to 600 seconds",
				"Generated context is not persisted by default"
			]
		}
	}
})
export class SwarmContextHandler {
	@Instrumented(300) // Cache context for 5 minutes
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 contexts per minute
		timeout: 300000, // 300 seconds (5 minutes) for LLM response
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				subtaskId: "",
				context: {
					taskId: "",
					description: "Service unavailable",
					scope: "",
					mandatoryReadings: [],
					architectureConstraints: [],
					relatedWork: [],
					successCriteria: []
				},
				prompt: "Context generation service temporarily unavailable"
			})
		}
	})
	async handle(input: SwarmContextInput, ctx: EventContext): Promise<SwarmContextOutput> {
		const redis = getRedis();
		
		// Get subtask data from Redis
		const subtaskKey = `cb:subtask:${input.subtaskId}`;
		const subtaskData = await redis.pub.hget(subtaskKey, "data");
		
		if (!subtaskData) {
			// Try to fetch from database
			if (ctx.prisma) {
				const subtask = await ctx.prisma.swarmSubtask.findUnique({
					where: { id: input.subtaskId },
					include: { parent: true }
				});
				
				if (!subtask) {
					throw new Error(`Subtask ${input.subtaskId} not found`);
				}
				
				// Use database data
				const subtaskInfo = {
					id: subtask.id,
					description: subtask.description,
					specialist: subtask.specialist,
					dependencies: subtask.dependencies,
					context: subtask.context as any
				};
				
				// Generate context via sampling
				const samplingService = getSamplingService();
				const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
				
				if (!sessionId) {
					throw new Error("No session ID available for sampling");
				}
				
				const specialistContext = await samplingService.generateContext(
					sessionId,
					input.subtaskId,
					input.specialist,
					subtaskInfo
				);
				
				// Get related work from other subtasks
				const relatedWork = await this.getRelatedWork(
					input.parentTaskId,
					input.subtaskId,
					ctx
				);
				
				// Merge with related work
				specialistContext.relatedWork = relatedWork;
				
				// Generate the prompt for the specialist
				const prompt = this.generateSpecialistPrompt(specialistContext);
				
				// Map the context to match the expected schema
				const mappedContext = {
					taskId: specialistContext.taskId,
					description: specialistContext.description,
					scope: specialistContext.scope,
					mandatoryReadings: (specialistContext.mandatoryReadings || []).map(reading => ({
						title: reading.title,
						path: reading.path,
						reason: (reading as any).reason || "Required for task completion"
					})),
					architectureConstraints: specialistContext.architectureConstraints || [],
					relatedWork: specialistContext.relatedWork || [],
					successCriteria: specialistContext.successCriteria || [],
					discoveredPatterns: (specialistContext as any).discoveredPatterns,
					integrationPoints: (specialistContext as any).integrationPoints,
					recommendedApproach: (specialistContext as any).recommendedApproach
				};
				
				return {
					subtaskId: input.subtaskId,
					context: mappedContext,
					prompt
				};
			}
			
			throw new Error(`Subtask ${input.subtaskId} not found`);
		}
		
		// Parse subtask data
		const subtask = JSON.parse(subtaskData);
		
		// Generate context via sampling
		const samplingService = getSamplingService();
		const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
		
		if (!sessionId) {
			throw new Error("No session ID available for sampling");
		}
		
		const specialistContext = await samplingService.generateContext(
			sessionId,
			input.subtaskId,
			input.specialist,
			subtask
		);
		
		// Get related work from other subtasks
		const relatedWork = await this.getRelatedWork(
			input.parentTaskId,
			input.subtaskId,
			ctx
		);
		
		// Merge with related work
		specialistContext.relatedWork = relatedWork;
		
		// Generate the prompt for the specialist
		const prompt = this.generateSpecialistPrompt(specialistContext);
		
		// Map the context to match the expected schema
		const mappedContext = {
			taskId: specialistContext.taskId,
			description: specialistContext.description,
			scope: specialistContext.scope,
			mandatoryReadings: (specialistContext.mandatoryReadings || []).map(reading => ({
				title: reading.title,
				path: reading.path,
				reason: (reading as any).reason || "Required for task completion"
			})),
			architectureConstraints: specialistContext.architectureConstraints || [],
			relatedWork: specialistContext.relatedWork || [],
			successCriteria: specialistContext.successCriteria || [],
			discoveredPatterns: (specialistContext as any).discoveredPatterns,
			integrationPoints: (specialistContext as any).integrationPoints,
			recommendedApproach: (specialistContext as any).recommendedApproach
		};
		
		// Store context as attachment
		// Store context as attachment - must succeed for consistency
		await registry.executeHandler("task.create_attachment", {
			taskId: input.parentTaskId,
			key: `context_${input.subtaskId}`,
			type: "json",
			value: {
				subtaskId: input.subtaskId,
				specialist: input.specialist,
				context: mappedContext,
				prompt: prompt,
				relatedWork: relatedWork,
				generatedAt: new Date().toISOString(),
				generatedBy: ctx.instanceId
			}
		}, ctx.metadata?.clientId);
		
		console.log(`[SwarmContext] Context stored as attachment for subtask ${input.subtaskId}`);
		
		// Publish context generated event
		await ctx.publish({
			type: "swarm.context.generated",
			payload: {
				subtaskId: input.subtaskId,
				specialist: input.specialist,
				contextSize: prompt.length
			},
			metadata: {
				generatedBy: ctx.instanceId,
				timestamp: Date.now()
			}
		});
		
		return {
			subtaskId: input.subtaskId,
			context: mappedContext,
			prompt
		};
	}
	
	/**
	 * Get related work from other subtasks
	 */
	private async getRelatedWork(
		parentTaskId: string,
		currentSubtaskId: string,
		ctx: EventContext
	): Promise<Array<{ instanceId: string; status: string; summary: string }>> {
		const relatedWork = [];
		
		if (ctx.prisma) {
			// Get other subtasks from the same parent
			const otherSubtasks = await ctx.prisma.swarmSubtask.findMany({
				where: {
					parentId: parentTaskId,
					id: { not: currentSubtaskId }
				},
				include: {
					progress: {
						orderBy: { createdAt: "desc" },
						take: 1
					}
				},
				take: 5 // Limit to 5 related subtasks
			});
			
			for (const subtask of otherSubtasks) {
				if (subtask.progress.length > 0) {
					const latest = subtask.progress[0];
					relatedWork.push({
						instanceId: latest.instanceId,
						status: latest.status,
						summary: `${subtask.description}: ${latest.output.substring(0, 100)}...`
					});
				} else if (subtask.assignedTo) {
					relatedWork.push({
						instanceId: subtask.assignedTo,
						status: subtask.status,
						summary: `${subtask.description}: ${subtask.status}`
					});
				}
			}
		}
		
		return relatedWork;
	}
	
	/**
	 * Generate the specialist prompt
	 */
	private generateSpecialistPrompt(context: any): string {
		return nunjucksEnv.render("specialist-prompt.njk", context);
	}
}