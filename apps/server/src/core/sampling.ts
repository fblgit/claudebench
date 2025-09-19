/**
 * Claude-based Sampling Service
 * Communicates with the ClaudeBench Inference Server for LLM sampling
 */

import { z } from 'zod';

// Re-export the types that were in the original sampling.ts
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

export interface Decomposition {
	subtasks: Array<{
		id: string;
		description: string;
		specialist: "frontend" | "backend" | "testing" | "docs" | "general";
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

export interface Resolution {
	chosenSolution: string;
	instanceId: string;
	justification: string;
	recommendations: string[];
	modifications?: string[];
}

export interface SynthesisInput {
	completedSubtasks: Array<{
		id: string;
		specialist: string;
		output: string;
		artifacts?: string[];
	}>;
	parentTask: string;
}

export interface Integration {
	status: "ready_for_integration" | "requires_fixes" | "integrated";
	integrationSteps: string[];
	potentialIssues: string[];
	nextActions: string[];
	mergedCode?: string;
}

/**
 * Configuration for the inference server
 */
const INFERENCE_CONFIG = {
	baseUrl: process.env.INFERENCE_SERVER_URL || 'http://localhost:8000',
	apiVersion: 'v1',
	timeout: 600000, // 600 seconds (10 minutes) - allow extensive exploration with tools
	retryAttempts: 3,
	retryDelay: 1000
};

/**
 * Claude-based Sampling Service using HTTP inference server
 */
export class ClaudeSamplingService {
	private static instance: ClaudeSamplingService;
	private readonly baseUrl: string;
	
	private constructor() {
		this.baseUrl = `${INFERENCE_CONFIG.baseUrl}/api/${INFERENCE_CONFIG.apiVersion}`;
	}
	
	public static getInstance(): ClaudeSamplingService {
		if (!ClaudeSamplingService.instance) {
			ClaudeSamplingService.instance = new ClaudeSamplingService();
		}
		return ClaudeSamplingService.instance;
	}
	
	/**
	 * Make HTTP request to inference server with retry logic
	 */
	private async makeRequest<T>(
		endpoint: string,
		method: string,
		body?: any,
		attempt: number = 1
	): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`;
		
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), INFERENCE_CONFIG.timeout);
			
			const response = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal
			});
			
			clearTimeout(timeoutId);
			
			if (!response.ok) {
				const error = await response.text();
				throw new Error(`Inference server error (${response.status}): ${error}`);
			}
			
			const data = await response.json();
			return data as T;
			
		} catch (error) {
			// Retry logic for network failures
			if (attempt < INFERENCE_CONFIG.retryAttempts) {
				console.warn(`[ClaudeSampling] Request failed, retrying (attempt ${attempt + 1})...`);
				await new Promise(resolve => setTimeout(resolve, INFERENCE_CONFIG.retryDelay * attempt));
				return this.makeRequest<T>(endpoint, method, body, attempt + 1);
			}
			
			console.error(`[ClaudeSampling] Request failed after ${attempt} attempts:`, error);
			throw error;
		}
	}
	
	/**
	 * Check if inference server is healthy
	 */
	public async checkHealth(): Promise<boolean> {
		try {
			const response = await fetch(`${INFERENCE_CONFIG.baseUrl}/health`, {
				method: 'GET',
				signal: AbortSignal.timeout(5000)
			});
			return response.ok;
		} catch (error) {
			console.error('[ClaudeSampling] Health check failed:', error);
			return false;
		}
	}
	
	/**
	 * Request task decomposition via inference server
	 */
	public async requestDecomposition(
		sessionId: string,
		task: string,
		context: DecompositionContext
	): Promise<Decomposition> {
		console.log(`[ClaudeSampling] Requesting decomposition for task: ${task.substring(0, 50)}...`);
		
		const requestBody = {
			sessionId,
			task,
			context
		};
		
		const response = await this.makeRequest<Decomposition>(
			'/decompose',
			'POST',
			requestBody
		);
		
		// Validate the response structure
		const decompositionSchema = z.object({
			subtasks: z.array(z.object({
				id: z.string(),
				description: z.string(),
				specialist: z.enum(["frontend", "backend", "testing", "docs", "general"]),
				dependencies: z.array(z.string()),
				complexity: z.number().min(1).max(10),
				context: z.object({
					files: z.array(z.string()),
					patterns: z.array(z.string()),
					constraints: z.array(z.string())
				}),
				estimatedMinutes: z.number()
			})),
			executionStrategy: z.enum(["parallel", "sequential", "mixed"]),
			totalComplexity: z.number(),
			reasoning: z.string()
		});
		
		return decompositionSchema.parse(response);
	}
	
	/**
	 * Generate specialist context via inference server
	 */
	public async generateContext(
		sessionId: string,
		subtaskId: string,
		specialist: string,
		subtask: any
	): Promise<SpecialistContext> {
		console.log(`[ClaudeSampling] Generating context for subtask ${subtaskId}`);
		
		const requestBody = {
			sessionId,
			subtaskId,
			specialist,
			subtask
		};
		
		const response = await this.makeRequest<SpecialistContext>(
			'/context',
			'POST',
			requestBody
		);
		
		// Validate the response structure
		const contextSchema = z.object({
			taskId: z.string(),
			description: z.string(),
			scope: z.string(),
			mandatoryReadings: z.array(z.object({
				title: z.string(),
				path: z.string()
			})),
			architectureConstraints: z.array(z.string()),
			relatedWork: z.array(z.object({
				instanceId: z.string(),
				status: z.string(),
				summary: z.string()
			})),
			successCriteria: z.array(z.string())
		});
		
		return contextSchema.parse(response);
	}
	
	/**
	 * Resolve conflicts via inference server
	 */
	public async resolveConflict(
		sessionId: string,
		conflict: ConflictInput
	): Promise<Resolution> {
		console.log(`[ClaudeSampling] Resolving conflict between ${conflict.solutions.length} solutions`);
		
		const requestBody = {
			sessionId,
			solutions: conflict.solutions,
			context: conflict.context
		};
		
		const response = await this.makeRequest<Resolution>(
			'/resolve',
			'POST',
			requestBody
		);
		
		// Validate the response structure
		const resolutionSchema = z.object({
			chosenSolution: z.string(),
			instanceId: z.string(),
			justification: z.string(),
			recommendations: z.array(z.string()),
			modifications: z.array(z.string()).optional()
		});
		
		return resolutionSchema.parse(response);
	}
	
	/**
	 * Synthesize progress via inference server
	 */
	public async synthesizeProgress(
		sessionId: string,
		input: SynthesisInput
	): Promise<Integration> {
		console.log(`[ClaudeSampling] Synthesizing ${input.completedSubtasks.length} completed subtasks`);
		
		const requestBody = {
			sessionId,
			completedSubtasks: input.completedSubtasks,
			parentTask: input.parentTask
		};
		
		const response = await this.makeRequest<Integration>(
			'/synthesize',
			'POST',
			requestBody
		);
		
		// Validate the response structure
		const integrationSchema = z.object({
			status: z.enum(["ready_for_integration", "requires_fixes", "integrated"]),
			integrationSteps: z.array(z.string()),
			potentialIssues: z.array(z.string()),
			nextActions: z.array(z.string()),
			mergedCode: z.string().optional()
		});
		
		return integrationSchema.parse(response);
	}
	
	/**
	 * Get inference server statistics
	 */
	public async getStats(): Promise<any> {
		try {
			return await this.makeRequest('/stats', 'GET');
		} catch (error) {
			console.error('[ClaudeSampling] Failed to get stats:', error);
			return null;
		}
	}
}

// Export singleton getter
export const getSamplingService = () => ClaudeSamplingService.getInstance();