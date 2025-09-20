import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskContextInput, taskContextOutput } from "@/schemas/task.schema";
import type { TaskContextInput, TaskContextOutput } from "@/schemas/task.schema";
import { getSamplingService } from "@/core/sampling";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import * as nunjucks from "nunjucks";
import * as path from "path";
import { fileURLToPath } from "url";

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Nunjucks environment (reuse swarm templates for now)
const templatesDir = path.join(__dirname, "..", "..", "templates", "swarm");
const nunjucksEnv = nunjucks.configure(templatesDir, {
	autoescape: false, // Don't escape for LLM prompts
	trimBlocks: true,
	lstripBlocks: true
});

@EventHandler({
	event: "task.context",
	inputSchema: taskContextInput,
	outputSchema: taskContextOutput,
	persist: false, // Context generation is ephemeral
	rateLimit: 50,
	description: "Generate execution context for a task",
	mcp: {
		title: "Generate Task Context",
		metadata: {
			examples: [
				{
					description: "Generate context for a task with custom constraints",
					input: {
						taskId: "t-123",
						specialist: "frontend",
						constraints: ["Use React hooks", "Follow atomic design pattern"],
						requirements: ["Dark mode support", "Responsive design"]
					}
				}
			],
			tags: ["task", "context", "specialist"],
			useCases: [
				"Providing focused context for task implementation",
				"Defining success criteria and constraints",
				"Identifying relevant files and patterns"
			],
			prerequisites: [
				"Task must exist in the system",
				"MCP sampling capability enabled"
			],
			warnings: [
				"Context generation uses LLM sampling which may take up to 600 seconds",
				"Generated context is stored as task attachment"
			]
		}
	}
})
export class TaskContextHandler {
	@Instrumented(300) // Cache context for 5 minutes
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 contexts per minute
		timeout: 300000, // 300 seconds (5 minutes) for LLM response
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				taskId: "",
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
	async handle(input: TaskContextInput, ctx: EventContext): Promise<TaskContextOutput> {
		const redis = getRedis();
		
		// Get task data from Redis
		const taskKey = `cb:task:${input.taskId}`;
		const taskData = await redis.pub.hgetall(taskKey);
		
		if (!taskData || Object.keys(taskData).length === 0) {
			// Try to fetch from database
			if (ctx.prisma) {
				const task = await ctx.prisma.task.findUnique({
					where: { id: input.taskId },
					include: {
						attachments: {
							where: { type: "json" },
							take: 5
						}
					}
				});
				
				if (!task) {
					throw new Error(`Task ${input.taskId} not found`);
				}
				
				// Use database data
				taskData.text = task.text;
				taskData.status = task.status;
				taskData.priority = String(task.priority);
				taskData.metadata = task.metadata ? JSON.stringify(task.metadata) : "{}";
				taskData.createdAt = task.createdAt.toISOString();
			} else {
				throw new Error(`Task ${input.taskId} not found`);
			}
		}
		
		// Prepare task info for context generation
		const taskInfo = {
			id: input.taskId,
			description: input.customDescription || taskData.text || "No description",
			specialist: input.specialist,
			status: taskData.status,
			priority: parseInt(taskData.priority || "50"),
			metadata: taskData.metadata ? JSON.parse(taskData.metadata) : {},
			constraints: input.constraints || [],
			requirements: input.requirements || [],
			existingFiles: input.existingFiles || [],
			additionalContext: input.additionalContext || ""
		};
		
		// Generate context via sampling service
		const samplingService = getSamplingService();
		const sessionId = ctx.metadata?.sessionId || ctx.metadata?.clientId || ctx.instanceId;
		
		if (!sessionId) {
			throw new Error("No session ID available for sampling");
		}
		
		// Call the context generation endpoint with task info
		const response = await samplingService.generateContext(
			sessionId,
			input.taskId,
			input.specialist,
			taskInfo
		);
		
		// Get related tasks to provide context
		const relatedWork = await this.getRelatedTasks(input.taskId, ctx);
		
		// Merge with related work
		response.relatedWork = relatedWork;
		
		// Include any custom constraints and requirements in the context
		if (input.constraints && input.constraints.length > 0) {
			response.architectureConstraints = [
				...(response.architectureConstraints || []),
				...input.constraints
			];
		}
		
		// Generate the prompt for the specialist
		const contextData = {
			...response,
			customConstraints: input.constraints,
			customRequirements: input.requirements,
			existingFiles: input.existingFiles,
			additionalContext: input.additionalContext
		};
		
		const prompt = this.generateSpecialistPrompt(contextData);
		
		// Map the context to match the expected schema
		const mappedContext = {
			taskId: input.taskId,
			description: response.description || taskInfo.description,
			scope: response.scope || `Implement task: ${taskInfo.description}`,
			mandatoryReadings: (response.mandatoryReadings || []).map(reading => ({
				title: reading.title,
				path: reading.path,
				reason: (reading as any).reason || "Required for task completion"
			})),
			architectureConstraints: response.architectureConstraints || [],
			relatedWork: response.relatedWork || [],
			successCriteria: response.successCriteria || [],
			discoveredPatterns: (response as any).discoveredPatterns,
			integrationPoints: (response as any).integrationPoints,
			recommendedApproach: (response as any).recommendedApproach
		};
		
		// Store context as task attachment
		try {
			await registry.executeHandler("task.create_attachment", {
				taskId: input.taskId,
				key: `context_${input.specialist}_${Date.now()}`,
				type: "json",
				value: {
					taskId: input.taskId,
					specialist: input.specialist,
					context: mappedContext,
					prompt: prompt,
					customInputs: {
						constraints: input.constraints,
						requirements: input.requirements,
						existingFiles: input.existingFiles,
						additionalContext: input.additionalContext
					},
					generatedAt: new Date().toISOString(),
					generatedBy: ctx.instanceId
				}
			}, ctx.metadata?.clientId);
			
			console.log(`[TaskContext] Context stored as attachment for task ${input.taskId}`);
		} catch (error) {
			console.error(`[TaskContext] Failed to store context as attachment:`, error);
			// Don't fail the whole operation if attachment storage fails
		}
		
		// Publish context generated event
		await ctx.publish({
			type: "task.context.generated",
			payload: {
				taskId: input.taskId,
				specialist: input.specialist,
				contextSize: prompt.length
			},
			metadata: {
				generatedBy: ctx.instanceId,
				timestamp: Date.now()
			}
		});
		
		return {
			taskId: input.taskId,
			context: mappedContext,
			prompt
		};
	}
	
	/**
	 * Get related tasks for context
	 */
	private async getRelatedTasks(
		taskId: string,
		ctx: EventContext
	): Promise<Array<{ instanceId: string; status: string; summary: string }>> {
		const relatedWork = [];
		
		if (ctx.prisma) {
			// Get other recent tasks
			const relatedTasks = await ctx.prisma.task.findMany({
				where: {
					id: { not: taskId },
					status: { in: ["in_progress", "completed"] }
				},
				orderBy: { updatedAt: "desc" },
				take: 5
			});
			
			for (const task of relatedTasks) {
				relatedWork.push({
					instanceId: task.assignedTo || "unassigned",
					status: task.status,
					summary: `${task.text.substring(0, 100)}${task.text.length > 100 ? "..." : ""}`
				});
			}
		}
		
		return relatedWork;
	}
	
	/**
	 * Generate the specialist prompt
	 */
	private generateSpecialistPrompt(context: any): string {
		// For now, create a structured prompt manually
		// In production, this would use the nunjucks template
		let prompt = `You are a ${context.specialist} specialist working on the following task:\n\n`;
		prompt += `TASK: ${context.description}\n\n`;
		prompt += `SCOPE: ${context.scope}\n\n`;
		
		if (context.customConstraints && context.customConstraints.length > 0) {
			prompt += `CONSTRAINTS:\n`;
			context.customConstraints.forEach((c: string) => prompt += `- ${c}\n`);
			prompt += "\n";
		}
		
		if (context.customRequirements && context.customRequirements.length > 0) {
			prompt += `REQUIREMENTS:\n`;
			context.customRequirements.forEach((r: string) => prompt += `- ${r}\n`);
			prompt += "\n";
		}
		
		if (context.existingFiles && context.existingFiles.length > 0) {
			prompt += `EXISTING FILES TO CONSIDER:\n`;
			context.existingFiles.forEach((f: string) => prompt += `- ${f}\n`);
			prompt += "\n";
		}
		
		if (context.additionalContext) {
			prompt += `ADDITIONAL CONTEXT:\n${context.additionalContext}\n\n`;
		}
		
		if (context.successCriteria && context.successCriteria.length > 0) {
			prompt += `SUCCESS CRITERIA:\n`;
			context.successCriteria.forEach((s: string) => prompt += `- ${s}\n`);
			prompt += "\n";
		}
		
		if (context.mandatoryReadings && context.mandatoryReadings.length > 0) {
			prompt += `MANDATORY FILES TO READ:\n`;
			context.mandatoryReadings.forEach((m: any) => {
				prompt += `- ${m.path}: ${m.reason}\n`;
			});
			prompt += "\n";
		}
		
		prompt += `Please implement this task following the constraints and requirements provided.`;
		
		return prompt;
	}
}