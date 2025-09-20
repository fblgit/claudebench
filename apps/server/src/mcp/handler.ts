/**
 * MCP Request Handler - Using fetch-to-node approach from mcp-hono-stateless
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { registry } from "../core/registry";
import * as crypto from "crypto";
import { z } from "zod";
import { getRedis } from "../core/redis";
import { getSamplingService } from "../core/sampling";
import { getPrisma } from "../core/context";
import * as nunjucks from "nunjucks";
import * as path from "path";

// Store servers and transports by session ID to maintain state
const servers = new Map<string, McpServer>();
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Get or create MCP server for a session
 */
async function getOrCreateServer(sessionId: string): Promise<McpServer> {
	if (servers.has(sessionId)) {
		return servers.get(sessionId)!;
	}
	
	// Create new server
	const server = new McpServer({
		name: "claudebench-mcp",
		version: "0.1.0",
	}, {
		capabilities: {
			logging: {},
			tools: {},
			sampling: {}, // Enable sampling for swarm intelligence
			prompts: {}, // Enable prompt templates for swarm operations
			resources: {} // Enable swarm state resources
		}
	});
	
	// Ensure handlers are discovered
	if (registry.getAllHandlers().length === 0) {
		await registry.discover();
	}
	
	// Register tools from handlers
	const handlers = registry.getAllHandlers();
	console.log(`[MCP] Registering ${handlers.length} tools for session ${sessionId}`);
	
	for (const handler of handlers) {
		// Skip handlers that are explicitly hidden from MCP
		if (handler.mcp?.visible === false) {
			console.log(`   ⏭️  Skipping hidden handler: ${handler.event}`);
			continue;
		}
		
		const toolName = handler.event.replace(/\./g, "__");
		
		try {
			// Convert Zod schema to a raw shape for the tool() method
			// The tool() method expects ZodRawShape, not a ZodObject
			// Handle both ZodObject and ZodEffects (from .refine())
			let inputSchemaShape;
			const schema = handler.inputSchema as any;
			
			// Check if it's a ZodEffects (has refinement)
			if (schema._def?.typeName === "ZodEffects" && schema._def?.schema) {
				// Get shape from the underlying schema
				inputSchemaShape = schema._def.schema.shape;
			} else {
				// Regular ZodObject - shape is directly accessible
				inputSchemaShape = schema.shape;
			}
			
			// Build enhanced description with metadata since _meta isn't passed through SDK
			let enhancedDescription = handler.description || `Execute ${handler.event} event handler`;
			
			// Add critical metadata to description for LLM visibility
			if (handler.mcp?.metadata) {
				const { warnings, prerequisites, examples } = handler.mcp.metadata;
				
				if (warnings?.length) {
					enhancedDescription += `\n\n⚠️ WARNINGS:\n${warnings.map(w => `• ${w}`).join('\n')}`;
				}
				
				if (prerequisites?.length) {
					enhancedDescription += `\n\nPREREQUISITES:\n${prerequisites.map(p => `• ${p}`).join('\n')}`;
				}
				
				if (examples && examples.length > 0) {
					const firstExample = examples[0];
					enhancedDescription += `\n\nEXAMPLE: ${firstExample.description}`;
					enhancedDescription += `\nInput: ${JSON.stringify(firstExample.input, null, 2)}`;
				}
			}
			
			// Use the high-level tool() method which properly handles Zod schemas
			(server as any).tool(
				toolName,
				enhancedDescription,
				inputSchemaShape,
				async (params: any, metadata: any): Promise<any> => {
					console.log(`[MCP Tool] Executing ${toolName}`);
					console.log(`[MCP Tool] Params:`, params);
					console.log(`[MCP Tool] Metadata keys:`, metadata ? Object.keys(metadata) : 'none');
					
					// Update MCP service status when tool is executed
					const redis = getRedis();
					await redis.pub.setex("cb:service:mcp:status", 300, "ok"); // 5 minute TTL
					await redis.pub.incr("cb:metrics:mcp:calls");
					
					// The tool() method already validates params with the schema
					// So params here are already validated
					// Pass sessionId as clientId for instance identification
					const result = await registry.executeHandler(handler.event, params, sessionId);
					
					// Return in MCP format
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(result, null, 2)
							}
						]
					};
				}
			);
			
			console.log(`   ✅ Registered MCP tool: ${toolName}`);
		} catch (error) {
			console.error(`   ❌ Failed to register tool ${toolName}:`, error);
		}
	}
	
	// Configure Nunjucks templates for prompts
	const templatesPath = path.join(process.cwd(), 'src', 'templates', 'swarm');
	nunjucks.configure(templatesPath, { autoescape: false });
	
	// Register prompt templates for swarm operations
	server.prompt(
		"decompose-task",
		"Guide for breaking down complex tasks into specialized subtasks for parallel execution by swarm specialists",
		{
			task: z.string().describe("The task to decompose"),
			priority: z.string().optional().describe("Task priority (1-100) as string"),
			constraints: z.string().optional().describe("JSON array of constraints to consider")
		},
		async (args) => {
			const context = {
				task: args.task,
				priority: args.priority ? parseInt(args.priority) : 75,
				specialists: [
					{ id: "worker-1", type: "frontend", capabilities: ["react", "typescript", "css"], currentLoad: 2, maxCapacity: 5 },
					{ id: "worker-2", type: "backend", capabilities: ["node", "apis", "database"], currentLoad: 1, maxCapacity: 5 },
					{ id: "worker-3", type: "testing", capabilities: ["jest", "e2e", "integration"], currentLoad: 0, maxCapacity: 5 }
				],
				constraints: args.constraints ? JSON.parse(args.constraints) : ["Maintain existing design system", "Ensure accessibility compliance"]
			};
			
			const prompt = nunjucks.render("decomposition.njk", context);
			
			return {
				description: "Task decomposition prompt",
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt
					}
				}]
			};
		}
	);

	server.prompt(
		"resolve-conflict",
		"Template for resolving conflicts between different specialist solutions with detailed justification",
		{
			projectType: z.string().describe("Type of project (e.g. 'React application')"),
			requirements: z.string().describe("JSON array of project requirements"),
			solutions: z.string().describe("JSON array of proposed solutions with instanceId, approach, and reasoning"),
			constraints: z.string().optional().describe("JSON array of constraints to consider")
		},
		async (args) => {
			const context = {
				projectType: args.projectType,
				requirements: JSON.parse(args.requirements),
				solutions: JSON.parse(args.solutions),
				constraints: args.constraints ? JSON.parse(args.constraints) : ["Bundle size limit", "IE11 compatibility not required"]
			};
			
			const prompt = nunjucks.render("conflict-resolution.njk", context);
			
			return {
				description: "Conflict resolution prompt",
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt
					}
				}]
			};
		}
	);

	server.prompt(
		"synthesize-progress",
		"Instructions for synthesizing completed subtasks into an integrated solution with step-by-step guidance",
		{
			parentTask: z.string().describe("The original parent task"),
			completedSubtasks: z.string().describe("JSON array of completed subtasks with id, specialist, output, and artifacts")
		},
		async (args) => {
			const context = {
				parentTask: args.parentTask,
				completedSubtasks: JSON.parse(args.completedSubtasks)
			};
			
			const prompt = nunjucks.render("progress-synthesis.njk", context);
			
			return {
				description: "Progress synthesis prompt",
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt
					}
				}]
			};
		}
	);
	
	// Register swarm resources for state access
	const prisma = getPrisma();
	
	// Resource: swarm://decomposition/{taskId}
	server.resource(
		"Swarm Task Decomposition",
		new ResourceTemplate("swarm://decomposition/{taskId}", {
			list: undefined
		}),
		async (uri: URL, variables: Variables) => {
			try {
				const taskId = typeof variables.taskId === 'string' ? variables.taskId : variables.taskId?.[0];
				if (!taskId) {
					throw new Error("Task ID required for decomposition resource");
				}
				
				// Get decomposition from attachment
				let decompositionData = null;
				try {
					const attachment = await prisma.taskAttachment.findUnique({
						where: {
							taskId_key: {
								taskId: taskId,
								key: "decomposition"
							}
						}
					});
					
					if (attachment?.value) {
						decompositionData = attachment.value;
					}
				} catch (error) {
					console.error(`[MCP Resource] Failed to fetch decomposition attachment:`, error);
				}
				
				if (!decompositionData) {
					throw new Error(`Decomposition not found for task: ${taskId}`);
				}
				
				const content = decompositionData;
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading decomposition ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);

	// Resource: swarm://context/{subtaskId}
	server.resource(
		"Swarm Subtask Context",
		new ResourceTemplate("swarm://context/{subtaskId}", {
			list: undefined
		}),
		async (uri: URL, variables: Variables) => {
			try {
				const subtaskId = typeof variables.subtaskId === 'string' ? variables.subtaskId : variables.subtaskId?.[0];
				if (!subtaskId) {
					throw new Error("Subtask ID required for context resource");
				}
				
				const subtask = await prisma.swarmSubtask.findUnique({
					where: { id: subtaskId },
					include: {
						assignment: true,
						progress: true,
						parent: true
					}
				});
				
				if (!subtask) {
					throw new Error(`Subtask not found: ${subtaskId}`);
				}
				
				// Get context from attachment
				let contextData = null;
				try {
					const attachment = await prisma.taskAttachment.findUnique({
						where: {
							taskId_key: {
								taskId: subtask.parentId,
								key: `context_${subtaskId}`
							}
						}
					});
					
					if (attachment?.value) {
						contextData = (attachment.value as any).context;
					}
				} catch (error) {
					console.error(`[MCP Resource] Failed to fetch context attachment for subtask ${subtaskId}:`, error);
				}
				
				// Get dependent subtasks
				const dependentSubtasks = await prisma.swarmSubtask.findMany({
					where: {
						id: { in: subtask.dependencies }
					}
				});
				
				const content = {
					subtask: {
						id: subtask.id,
						description: subtask.description,
						specialist: subtask.specialist,
						complexity: subtask.complexity,
						estimatedMinutes: subtask.estimatedMinutes,
						status: subtask.status,
						context: contextData,
						assignedTo: subtask.assignedTo,
						createdAt: subtask.createdAt,
						updatedAt: subtask.updatedAt
					},
					parentTask: {
						id: subtask.parent.taskId,
						text: subtask.parent.taskText,
						strategy: subtask.parent.strategy
					},
					dependencies: dependentSubtasks.map(dep => ({
						id: dep.id,
						description: dep.description,
						status: dep.status,
						specialist: dep.specialist
					})),
					assignment: subtask.assignment,
					progress: subtask.progress
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading context ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);

	// Resource: swarm://progress/{taskId}
	server.resource(
		"Swarm Progress Overview",
		new ResourceTemplate("swarm://progress/{taskId}", {
			list: undefined
		}),
		async (uri: URL, variables: Variables) => {
			try {
				const taskId = typeof variables.taskId === 'string' ? variables.taskId : variables.taskId?.[0];
				if (!taskId) {
					throw new Error("Task ID required for progress resource");
				}
				
				const decomposition = await prisma.swarmDecomposition.findUnique({
					where: { taskId }
				});
				
				if (!decomposition) {
					throw new Error(`Task not found: ${taskId}`);
				}
				
				const progressRecords = await prisma.swarmProgress.findMany({
					where: {
						subtask: {
							parentId: taskId
						}
					},
					include: {
						subtask: true
					}
				});
				
				const integration = await prisma.swarmIntegration.findFirst({
					where: { taskId },
					orderBy: { createdAt: 'desc' }
				});
				
				const content = {
					taskId,
					taskText: decomposition.taskText,
					overallProgress: decomposition.progress,
					subtaskProgress: progressRecords.map(pr => ({
						subtaskId: pr.subtaskId,
						subtaskDescription: pr.subtask.description,
						specialist: pr.subtask.specialist,
						instanceId: pr.instanceId,
						output: pr.output,
						artifacts: pr.artifacts,
						status: pr.status,
						createdAt: pr.createdAt
					})),
					integration: integration ? {
						status: integration.status,
						steps: integration.steps,
						issues: integration.issues,
						mergedCode: integration.mergedCode,
						createdAt: integration.createdAt,
						completedAt: integration.completedAt
					} : null
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading progress ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);

	// Resource: swarm://conflicts
	server.resource(
		"Swarm Conflicts",
		"swarm://conflicts",
		async (uri: URL) => {
			try {
				const conflicts = await prisma.swarmConflict.findMany({
					where: { status: 'pending' },
					orderBy: { createdAt: 'desc' }
				});
				
				const content = {
					pendingConflicts: conflicts.map(conflict => ({
						id: conflict.id,
						taskId: conflict.taskId,
						instanceCount: conflict.instanceCount,
						solutions: conflict.solutions,
						status: conflict.status,
						createdAt: conflict.createdAt
					}))
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading conflicts ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);
	
	// Resource: swarm://tasks (static list of all tasks)
	server.resource(
		"Task List",
		"swarm://tasks",
		async (uri: URL) => {
			try {
				const tasks = await prisma.task.findMany({
					orderBy: { createdAt: 'desc' },
					take: 50
				});
				
				const content = {
					tasks: tasks.map(task => ({
						id: task.id,
						text: task.text,
						status: task.status,
						priority: task.priority,
						assignedTo: task.assignedTo,
						createdAt: task.createdAt,
						updatedAt: task.updatedAt
					})),
					total: tasks.length
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading tasks ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);
	
	// Resource: swarm://tasks/pending (tasks ready to be claimed)
	server.resource(
		"Pending Tasks",
		"swarm://tasks/pending",
		async (uri: URL) => {
			try {
				const pendingTasks = await prisma.task.findMany({
					where: { 
						status: 'pending',
						assignedTo: null
					},
					orderBy: [
						{ priority: 'desc' },
						{ createdAt: 'asc' }
					],
					take: 20
				});
				
				const content = {
					pendingTasks: pendingTasks.map(task => ({
						id: task.id,
						text: task.text,
						priority: task.priority,
						createdAt: task.createdAt,
						metadata: task.metadata
					})),
					total: pendingTasks.length,
					nextTask: pendingTasks[0] || null
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading pending tasks ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);
	
	// Resource: swarm://decompositions (list all decompositions)
	server.resource(
		"Decompositions List",
		"swarm://decompositions",
		async (uri: URL) => {
			try {
				const decompositions = await prisma.swarmDecomposition.findMany({
					select: {
						taskId: true,
						taskText: true,
						strategy: true,
						subtaskCount: true,
						progress: true,
						createdAt: true
					},
					orderBy: { createdAt: 'desc' },
					take: 20
				});
				
				const content = {
					decompositions: decompositions.map(d => ({
						taskId: d.taskId,
						taskText: d.taskText,
						strategy: d.strategy,
						subtaskCount: d.subtaskCount,
						progress: d.progress,
						createdAt: d.createdAt,
						resourceUri: `swarm://decomposition/${d.taskId}`
					})),
					total: decompositions.length
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error reading decompositions ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading resource: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);
	
	// Resource: claudebench://welcome (Bootstrap guide)
	server.resource(
		"Welcome to ClaudeBench",
		"claudebench://welcome",
		async (uri: URL) => {
			try {
				const redis = getRedis();
				
				// Gather system metrics
				const [instanceCount, taskStats, eventCount] = await Promise.all([
					redis.pub.scard("cb:instances:active"),
					prisma.task.groupBy({
						by: ['status'],
						_count: true
					}),
					redis.pub.get("cb:metrics:events:total")
				]);
				
				// Calculate task statistics
				const tasksByStatus = taskStats.reduce((acc, stat) => {
					acc[stat.status] = stat._count;
					return acc;
				}, {} as Record<string, number>);
				
				const totalTasks = Object.values(tasksByStatus).reduce((a, b) => a + b, 0);
				const completedToday = await prisma.task.count({
					where: {
						status: 'completed',
						updatedAt: {
							gte: new Date(new Date().setHours(0, 0, 0, 0))
						}
					}
				});
				
				// Get average response time
				const avgResponseTime = await redis.pub.get("cb:metrics:avg_response_time") || "0";
				
				// Load and render template
				const templatePath = path.join(process.cwd(), "src/templates/welcome-claudebench.md");
				const template = await Bun.file(templatePath).text();
				
				// Configure nunjucks for this template
				const env = nunjucks.configure({ autoescape: false });
				const rendered = env.renderString(template, {
					instanceId: sessionId,
					sessionId: sessionId,
					timestamp: new Date().toISOString(),
					instanceCount: instanceCount || 0,
					eventCount: eventCount || 0,
					totalTasks,
					pendingTasks: tasksByStatus['pending'] || 0,
					inProgressTasks: tasksByStatus['in_progress'] || 0,
					completedToday,
					successRate: totalTasks > 0 
						? Math.round(((tasksByStatus['completed'] || 0) / totalTasks) * 100)
						: 0,
					avgResponseTime: Math.round(Number(avgResponseTime)),
					todoCompletionRate: 0, // Would need to track this separately
					activeTodos: 0, // Would need to track this separately
					eventStreams: [
						{ name: 'task.*', count: await redis.pub.xlen('cb:stream:task') || 0 },
						{ name: 'system.*', count: await redis.pub.xlen('cb:stream:system') || 0 },
						{ name: 'hook.*', count: await redis.pub.xlen('cb:stream:hook') || 0 },
						{ name: 'swarm.*', count: await redis.pub.xlen('cb:stream:swarm') || 0 }
					]
				});
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/markdown",
						text: rendered
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error rendering welcome template:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error loading welcome guide: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);
	
	// Note: Task operations (create, claim, update, complete, pick) should use Tools, not Resources
	// Resources are read-only data access. Use the existing tools:
	// - task__create - Create a new task
	// - task__claim - Claim next available task  
	// - task__update - Update task
	// - task__complete - Complete a task
	// - task__assign + task__update - Pick a task with plan
	
	// Resource Template: task://view/{taskId} - View specific task details (read-only)
	server.resource(
		"View Task",
		new ResourceTemplate("task://view/{taskId}", {
			list: undefined
		}),
		async (uri: URL, variables: Variables) => {
			try {
				const taskId = typeof variables.taskId === 'string' ? variables.taskId : variables.taskId?.[0];
				
				if (!taskId || taskId === '{taskId}') {
					// If no specific task ID, show recent tasks
					const recentTasks = await prisma.task.findMany({
						orderBy: { createdAt: 'desc' },
						take: 10,
						select: {
							id: true,
							text: true,
							status: true,
							priority: true,
							createdAt: true
						}
					});
					
					return {
						contents: [{
							uri: uri.toString(),
							mimeType: "text/plain",
							text: `Available Tasks:\n\n${
								recentTasks.length > 0
									? recentTasks.map(t => `• ${t.id}: "${t.text}" [${t.status}] (priority: ${t.priority})`).join('\n')
									: 'No tasks found.'
							}\n\nTo view a specific task, access: task://view/<taskId>`
						}]
					};
				}
				
				// Get the specific task
				const task = await prisma.task.findUnique({
					where: { id: taskId }
				});
				
				if (!task) {
					return {
						contents: [{
							uri: uri.toString(),
							mimeType: "application/json",
							text: JSON.stringify({
								error: `Task not found: ${taskId}`,
								availableTasks: await prisma.task.findMany({
									select: { id: true },
									orderBy: { createdAt: 'desc' },
									take: 5
								}).then(tasks => tasks.map(t => t.id))
							}, null, 2)
						}]
					};
				}
				
				// Fetch attachments for the task
				let attachments: Record<string, any> = {};
				let result = task.result;
				
				try {
					const taskAttachments = await prisma.taskAttachment.findMany({
						where: { taskId: task.id },
						select: {
							key: true,
							type: true,
							value: true,
							createdAt: true
						}
					});
					
					for (const attachment of taskAttachments) {
						attachments[attachment.key] = {
							type: attachment.type,
							value: attachment.value,
							createdAt: attachment.createdAt
						};
						
						// Prefer 'result' attachment over legacy field
						if (attachment.key === 'result') {
							result = attachment.value;
						}
					}
				} catch (error) {
					// Log but don't fail if attachments can't be fetched
					console.warn(`[MCP Resource] Failed to fetch attachments for task ${taskId}:`, error);
				}
				
				// Return full task details with attachments
				const content = {
					id: task.id,
					text: task.text,
					status: task.status,
					priority: task.priority,
					assignedTo: task.assignedTo,
					metadata: task.metadata,
					result: result, // Uses attachment if available, else legacy field
					attachments: attachments, // Include all attachments
					attachmentCount: Object.keys(attachments).length,
					createdAt: task.createdAt,
					updatedAt: task.updatedAt,
					completedAt: task.completedAt,
					// Add computed fields
					age: `${Math.floor((Date.now() - task.createdAt.getTime()) / 1000 / 60)} minutes`,
					isAssigned: task.assignedTo !== null,
					isCompleted: task.status === 'completed',
					isPending: task.status === 'pending',
					isInProgress: task.status === 'in_progress'
				};
				
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(content, null, 2)
					}]
				};
			} catch (error) {
				console.error(`[MCP Resource] Error viewing task ${uri}:`, error);
				return {
					contents: [{
						uri: uri.toString(),
						mimeType: "text/plain",
						text: `Error reading task: ${error instanceof Error ? error.message : 'Unknown error'}`
					}]
				};
			}
		}
	);
	
	// Note: The HTTP-based ClaudeSamplingService doesn't need server registration
	// It uses sessionId passed in the context when handlers call it
	// const samplingService = getSamplingService();
	// samplingService.registerServer(sessionId, server);
	
	servers.set(sessionId, server);
	return server;
}

/**
 * POST /mcp - Handle JSON-RPC requests maintaining session state
 */
export async function handleMcpPost(c: Context) {
	try {
		const body = await c.req.json();
		let sessionId = c.req.header("mcp-session-id");
		let transport: StreamableHTTPServerTransport | undefined;
		
		// Check if this is an initialization request
		const isInit = body.method === "initialize";
		
		if (isInit) {
			// Generate new session ID for initialization
			sessionId = crypto.randomUUID();
			console.log(`[MCP] New session initialization: ${sessionId}`);
			
			// Set MCP service status as ok in Redis
			const redis = getRedis();
			await redis.pub.setex("cb:service:mcp:status", 300, "ok"); // 5 minute TTL
			await redis.pub.incr("cb:metrics:mcp:calls");
			
			// Create new transport for this session
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => sessionId!
			});
			
			// Create and connect server
			const server = await getOrCreateServer(sessionId);
			await server.connect(transport);
			
			// Store transport for future requests
			transports.set(sessionId, transport);
			
		} else if (sessionId && transports.has(sessionId)) {
			// Reuse existing transport for this session
			transport = transports.get(sessionId);
			console.log(`[MCP] Reusing session ${sessionId} for method: ${body.method}`);
		} else {
			// No valid session
			console.log(`[MCP] Invalid session: ${sessionId}`);
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message: "Bad Request: Invalid or missing session ID. Initialize first."
				},
				id: body.id || null
			}, 400);
		}
		
		// Convert Hono request to Node.js format
		const { req, res } = toReqRes(c.req.raw);
		
		// Handle the request through the transport
		await transport!.handleRequest(req, res, body);
		
		// Set session ID header for client
		c.header("Mcp-Session-Id", sessionId);
		
		// Convert Node.js response back to Fetch Response
		return toFetchResponse(res);
		
	} catch (error) {
		console.error("[MCP] Request handling error:", error);
		return c.json({
			jsonrpc: "2.0",
			error: {
				code: -32603,
				message: error instanceof Error ? error.message : "Internal server error",
			},
			id: null,
		}, 500);
	}
}

/**
 * GET /mcp - Server-sent events for notifications
 */
export async function handleMcpGet(c: Context) {
	const sessionId = c.req.header("mcp-session-id");
	
	if (!sessionId || !servers.has(sessionId)) {
		return c.text("Invalid or missing session ID", 400);
	}
	
	// Set up SSE stream
	return streamSSE(c, async (stream) => {
		console.log(`[MCP] SSE connection established for session: ${sessionId}`);
		
		// Keep connection alive with periodic pings
		const pingInterval = setInterval(() => {
			stream.writeSSE({
				event: "ping",
				data: JSON.stringify({ timestamp: Date.now() })
			});
		}, 30000);
		
		// Clean up on connection close
		stream.onAbort(() => {
			console.log(`[MCP] SSE connection closed for session: ${sessionId}`);
			clearInterval(pingInterval);
		});
	});
}

/**
 * DELETE /mcp - Terminate session
 */
export async function handleMcpDelete(c: Context) {
	const sessionId = c.req.header("mcp-session-id");
	
	if (!sessionId) {
		return c.text("Missing session ID", 400);
	}
	
	try {
		// Remove transport
		if (transports.has(sessionId)) {
			const transport = transports.get(sessionId);
			// Close the transport if it has a close method
			if (transport && typeof (transport as any).close === 'function') {
				(transport as any).close();
			}
			transports.delete(sessionId);
		}
		
		// Remove server
		if (servers.has(sessionId)) {
			servers.delete(sessionId);
		}
		
		console.log(`[MCP] Session terminated: ${sessionId}`);
		
		return c.json({
			jsonrpc: "2.0",
			result: {
				message: "Session terminated successfully",
				sessionId
			},
			id: null
		});
		
	} catch (error) {
		console.error(`[MCP] Error terminating session ${sessionId}:`, error);
		return c.json({
			jsonrpc: "2.0",
			error: {
				code: -32603,
				message: error instanceof Error ? error.message : "Failed to terminate session",
			},
			id: null,
		}, 500);
	}
}

/**
 * GET /mcp/health - Health check
 */
export function handleMcpHealth(c: Context) {
	const activeSessions = Array.from(servers.keys());
	
	return c.json({
		status: "healthy",
		activeSessions: activeSessions.length,
		sessions: activeSessions,
		transports: transports.size
	});
}
