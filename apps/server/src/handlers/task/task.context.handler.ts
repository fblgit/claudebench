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

// Configure Nunjucks environment for task templates
const templatesDir = path.join(__dirname, "..", "..", "templates", "task");
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
		
		// Store attachments separately since they come from DB
		let taskAttachments: any[] = [];
		
		if (!taskData || Object.keys(taskData).length === 0) {
			// Try to fetch from database
			if (ctx.prisma) {
				const task = await ctx.prisma.task.findUnique({
					where: { id: input.taskId },
					include: {
						attachments: {
							orderBy: { createdAt: 'desc' },
							take: 10  // Increased from 5 to get more context
						}
					}
				});
				
				if (!task) {
					throw new Error(`Task ${input.taskId} not found`);
				}
				
				// Store attachments for later use
				taskAttachments = task.attachments || [];
				
				// Use database data
				taskData.text = task.text;
				taskData.status = task.status;
				taskData.priority = String(task.priority);
				taskData.metadata = task.metadata ? JSON.stringify(task.metadata) : "{}";
				taskData.createdAt = task.createdAt.toISOString();
			} else {
				throw new Error(`Task ${input.taskId} not found`);
			}
		} else {
			// Task found in Redis, but we still need to fetch attachments from DB
			if (ctx.prisma) {
				const attachments = await ctx.prisma.taskAttachment.findMany({
					where: { taskId: input.taskId },
					orderBy: { createdAt: 'desc' },
					take: 10
				});
				taskAttachments = attachments || [];
			}
		}
		
		// Process attachments to extract meaningful content
		const processedAttachments = taskAttachments.map(att => ({
			key: att.key,
			type: att.type,
			createdAt: att.createdAt,
			// Parse JSON values for json type attachments
			value: att.type === 'json' && att.value ? 
				(typeof att.value === 'string' ? JSON.parse(att.value) : att.value) : 
				att.value,
			// Include content for text/markdown attachments
			content: att.content || null,
			// Include URL for url type attachments
			url: att.url || null
		}));
		
		// Prepare task info for context generation
		const taskInfo = {
			id: input.taskId,
			description: input.customDescription || taskData.text || "No description",
			specialist: input.specialist,
			status: taskData.status,
			priority: parseInt(taskData.priority || "50"),
			metadata: taskData.metadata ? JSON.parse(taskData.metadata) : {},
			attachments: processedAttachments,  // Include processed attachments
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
		
		// Get worker's working directory from instance metadata
		let workingDirectory: string | undefined;
		if (ctx.instanceId) {
			const instanceKey = `cb:instance:${ctx.instanceId}`;
			const instanceMetadata = await redis.pub.hget(instanceKey, 'metadata');
			if (instanceMetadata) {
				try {
					const metadata = JSON.parse(instanceMetadata);
					workingDirectory = metadata.workingDirectory;
					console.log(`[TaskContext] Using working directory from instance ${ctx.instanceId}: ${workingDirectory}`);
				} catch (e) {
					console.warn(`[TaskContext] Failed to parse instance metadata:`, e);
				}
			}
		}
		
		// Add working directory to task info if available
		if (workingDirectory) {
			(taskInfo as any).workingDirectory = workingDirectory;
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
			attachments: processedAttachments,  // Add attachments to context
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
	 * Generate the specialist prompt using Nunjucks template
	 */
	private generateSpecialistPrompt(context: any): string {
		return nunjucksEnv.render("task-context-prompt.njk", context);
	}
}