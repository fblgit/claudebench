/**
 * MCP Sampling Service
 * Provides intelligent decision-making via LLM sampling for swarm coordination
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRedis } from "./redis";
import { z } from "zod";
import * as nunjucks from "nunjucks";
import * as path from "path";
import { fileURLToPath } from "url";

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure Nunjucks environment
const templatesDir = path.join(__dirname, "..", "templates", "swarm");
const nunjucksEnv = nunjucks.configure(templatesDir, {
	autoescape: false, // Don't escape for LLM prompts
	trimBlocks: true,
	lstripBlocks: true
});

/**
 * Configuration for sampling requests
 */
export const samplingConfig = {
	defaultMaxTokens: 2000,
	defaultTemperature: 0.7,
	retryAttempts: 3,
	retryDelay: 1000,
	timeoutMs: 30000,
};

/**
 * Decomposition context for task breakdown
 */
export interface DecompositionContext {
	specialists: Array<{
		id: string;
		type: string;
		capabilities: string[];
		currentLoad: number;
		maxCapacity: number;
	}>;
	priority: number;
	constraints?: string[];
}

/**
 * Decomposition result structure
 */
export interface Decomposition {
	subtasks: Array<{
		id: string;
		description: string;
		specialist: "frontend" | "backend" | "testing" | "docs";
		dependencies: string[];
		complexity: number;
		context: {
			files: string[];
			patterns: string[];
			constraints: string[];
		};
		estimatedMinutes: number;
	}>;
	executionStrategy: "parallel" | "sequential" | "mixed";
	totalComplexity: number;
	reasoning: string;
}

/**
 * Specialist context for focused work
 */
export interface SpecialistContext {
	taskId: string;
	description: string;
	scope: string;
	mandatoryReadings: Array<{
		title: string;
		path: string;
	}>;
	architectureConstraints: string[];
	relatedWork: Array<{
		instanceId: string;
		status: string;
		summary: string;
	}>;
	successCriteria: string[];
}

/**
 * Conflict resolution input
 */
export interface ConflictInput {
	solutions: Array<{
		instanceId: string;
		approach: string;
		reasoning: string;
		code?: string;
	}>;
	context: {
		projectType: string;
		requirements: string[];
		constraints?: string[];
	};
}

/**
 * Resolution decision
 */
export interface Resolution {
	chosenSolution: string;
	instanceId: string;
	justification: string;
	recommendations: string[];
	modifications?: string[];
}

/**
 * Progress synthesis input
 */
export interface SynthesisInput {
	completedSubtasks: Array<{
		id: string;
		specialist: string;
		output: string;
		artifacts?: string[];
	}>;
	parentTask: string;
}

/**
 * Integration result
 */
export interface Integration {
	status: "ready_for_integration" | "requires_fixes" | "integrated";
	integrationSteps: string[];
	potentialIssues: string[];
	nextActions: string[];
	mergedCode?: string;
}

/**
 * Sampling Service for swarm intelligence
 */
export class SamplingService {
	private static instance: SamplingService;
	private mcpServers: Map<string, McpServer>;
	private redis = getRedis();
	
	private constructor() {
		this.mcpServers = new Map();
	}
	
	/**
	 * Get singleton instance
	 */
	public static getInstance(): SamplingService {
		if (!SamplingService.instance) {
			SamplingService.instance = new SamplingService();
		}
		return SamplingService.instance;
	}
	
	/**
	 * Register MCP server for a session
	 */
	public registerServer(sessionId: string, server: McpServer): void {
		this.mcpServers.set(sessionId, server);
	}
	
	/**
	 * Get MCP server for session
	 */
	private getServer(sessionId: string): McpServer {
		const server = this.mcpServers.get(sessionId);
		if (!server) {
			throw new Error(`No MCP server found for session ${sessionId}`);
		}
		return server;
	}
	
	/**
	 * Request task decomposition via sampling
	 */
	public async requestDecomposition(
		sessionId: string,
		task: string,
		context: DecompositionContext
	): Promise<Decomposition> {
		const server = this.getServer(sessionId);
		
		const prompt = this.buildDecompositionPrompt(task, context);
		
		try {
			// Track sampling metrics
			await this.redis.pub.incr("cb:metrics:sampling:requests");
			const startTime = Date.now();
			
			// Request sampling from Claude
			const response = await (server as any).server.createMessage({
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt,
					},
				}],
				maxTokens: samplingConfig.defaultMaxTokens,
				temperature: samplingConfig.defaultTemperature,
			});
			
			// Track latency
			const latency = Date.now() - startTime;
			await this.redis.pub.lpush("cb:metrics:sampling:latency", latency.toString());
			await this.redis.pub.ltrim("cb:metrics:sampling:latency", 0, 999);
			
			// Parse response
			if (response.content.type !== "text") {
				throw new Error("Invalid response format from sampling");
			}
			
			const content = response.content.text;
			
			// Extract JSON from response (handle markdown code blocks)
			const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
			const jsonStr = jsonMatch ? jsonMatch[1] : content;
			
			const decomposition = JSON.parse(jsonStr) as Decomposition;
			
			// Validate structure
			this.validateDecomposition(decomposition);
			
			// Cache successful decomposition
			await this.redis.pub.setex(
				`cb:cache:decomposition:${task.substring(0, 50)}`,
				300, // 5 minute cache
				JSON.stringify(decomposition)
			);
			
			return decomposition;
		} catch (error) {
			await this.redis.pub.incr("cb:metrics:sampling:errors");
			console.error("[Sampling] Decomposition failed:", error);
			throw error;
		}
	}
	
	/**
	 * Generate specialist context via sampling
	 */
	public async generateContext(
		sessionId: string,
		subtaskId: string,
		specialist: string,
		subtask: any
	): Promise<SpecialistContext> {
		const server = this.getServer(sessionId);
		
		const prompt = this.buildContextPrompt(subtaskId, specialist, subtask);
		
		try {
			const response = await (server as any).server.createMessage({
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt,
					},
				}],
				maxTokens: 1500,
				temperature: 0.5, // Lower temperature for context generation
			});
			
			if (response.content.type !== "text") {
				throw new Error("Invalid response format");
			}
			
			// Parse the structured context
			const jsonMatch = response.content.text.match(/```json\n?([\s\S]*?)\n?```/);
			const jsonStr = jsonMatch ? jsonMatch[1] : response.content.text;
			
			return JSON.parse(jsonStr) as SpecialistContext;
		} catch (error) {
			console.error("[Sampling] Context generation failed:", error);
			throw error;
		}
	}
	
	/**
	 * Resolve conflicts via sampling
	 */
	public async resolveConflict(
		sessionId: string,
		conflict: ConflictInput
	): Promise<Resolution> {
		const server = this.getServer(sessionId);
		
		const prompt = this.buildConflictPrompt(conflict);
		
		try {
			const response = await (server as any).server.createMessage({
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt,
					},
				}],
				maxTokens: 1000,
				temperature: 0.3, // Low temperature for decision-making
			});
			
			if (response.content.type !== "text") {
				throw new Error("Invalid response format");
			}
			
			const jsonMatch = response.content.text.match(/```json\n?([\s\S]*?)\n?```/);
			const jsonStr = jsonMatch ? jsonMatch[1] : response.content.text;
			
			return JSON.parse(jsonStr) as Resolution;
		} catch (error) {
			console.error("[Sampling] Conflict resolution failed:", error);
			throw error;
		}
	}
	
	/**
	 * Synthesize progress via sampling
	 */
	public async synthesizeProgress(
		sessionId: string,
		input: SynthesisInput
	): Promise<Integration> {
		const server = this.getServer(sessionId);
		
		const prompt = this.buildSynthesisPrompt(input);
		
		try {
			const response = await (server as any).server.createMessage({
				messages: [{
					role: "user",
					content: {
						type: "text",
						text: prompt,
					},
				}],
				maxTokens: 2000,
				temperature: 0.6,
			});
			
			if (response.content.type !== "text") {
				throw new Error("Invalid response format");
			}
			
			const jsonMatch = response.content.text.match(/```json\n?([\s\S]*?)\n?```/);
			const jsonStr = jsonMatch ? jsonMatch[1] : response.content.text;
			
			return JSON.parse(jsonStr) as Integration;
		} catch (error) {
			console.error("[Sampling] Progress synthesis failed:", error);
			throw error;
		}
	}
	
	/**
	 * Build decomposition prompt
	 */
	private buildDecompositionPrompt(task: string, context: DecompositionContext): string {
		return nunjucksEnv.render("decomposition.njk", {
			task,
			priority: context.priority,
			specialists: context.specialists,
			constraints: context.constraints
		});
	}
	
	/**
	 * Build context generation prompt
	 */
	private buildContextPrompt(subtaskId: string, specialist: string, subtask: any): string {
		return nunjucksEnv.render("specialist-context.njk", {
			subtaskId,
			specialist,
			description: subtask.description,
			dependencies: subtask.dependencies,
			constraints: subtask.context.constraints
		});
	}
	
	/**
	 * Build conflict resolution prompt
	 */
	private buildConflictPrompt(conflict: ConflictInput): string {
		return nunjucksEnv.render("conflict-resolution.njk", {
			projectType: conflict.context.projectType,
			requirements: conflict.context.requirements,
			constraints: conflict.context.constraints,
			solutions: conflict.solutions
		});
	}
	
	/**
	 * Build synthesis prompt
	 */
	private buildSynthesisPrompt(input: SynthesisInput): string {
		return nunjucksEnv.render("progress-synthesis.njk", {
			parentTask: input.parentTask,
			completedSubtasks: input.completedSubtasks
		});
	}
	
	/**
	 * Validate decomposition structure
	 */
	private validateDecomposition(decomposition: any): void {
		const schema = z.object({
			subtasks: z.array(z.object({
				id: z.string(),
				description: z.string(),
				specialist: z.enum(["frontend", "backend", "testing", "docs"]),
				dependencies: z.array(z.string()),
				complexity: z.number().min(1).max(10),
				context: z.object({
					files: z.array(z.string()),
					patterns: z.array(z.string()),
					constraints: z.array(z.string()),
				}),
				estimatedMinutes: z.number(),
			})),
			executionStrategy: z.enum(["parallel", "sequential", "mixed"]),
			totalComplexity: z.number(),
			reasoning: z.string(),
		});
		
		schema.parse(decomposition);
	}
}

// Export singleton instance getter
export const getSamplingService = () => SamplingService.getInstance();