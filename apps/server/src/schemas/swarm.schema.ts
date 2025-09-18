/**
 * Swarm Intelligence Schemas
 * Validation schemas for swarm coordination handlers
 */

import { z } from "zod";

/**
 * Task Decomposition
 */
export const swarmDecomposeInput = z.object({
	taskId: z.string().min(1),
	task: z.string().min(1).max(1000),
	priority: z.number().int().min(0).max(100).default(50),
	constraints: z.array(z.string()).optional(),
});

export const swarmDecomposeOutput = z.object({
	taskId: z.string(),
	subtaskCount: z.number(),
	decomposition: z.object({
		subtasks: z.array(z.object({
			id: z.string(),
			description: z.string(),
			specialist: z.enum(["frontend", "backend", "testing", "docs", "general"]),
			dependencies: z.array(z.string()),
			complexity: z.number().min(1).max(100),
			context: z.object({
				files: z.array(z.string()),
				patterns: z.array(z.string()),
				constraints: z.array(z.string()),
			}),
			estimatedMinutes: z.number(),
			rationale: z.string().optional(), // Why this subtask is necessary
		})),
		executionStrategy: z.enum(["parallel", "sequential", "mixed"]),
		totalComplexity: z.number(),
		reasoning: z.string(),
		architecturalConsiderations: z.array(z.string()).optional(), // Key architectural decisions
	}),
});

export type SwarmDecomposeInput = z.infer<typeof swarmDecomposeInput>;
export type SwarmDecomposeOutput = z.infer<typeof swarmDecomposeOutput>;

/**
 * Context Generation
 */
export const swarmContextInput = z.object({
	subtaskId: z.string().min(1),
	specialist: z.enum(["frontend", "backend", "testing", "docs", "general"]),
	parentTaskId: z.string().min(1),
});

export const swarmContextOutput = z.object({
	subtaskId: z.string(),
	context: z.object({
		taskId: z.string(),
		description: z.string(),
		scope: z.string(),
		mandatoryReadings: z.array(z.object({
			title: z.string(),
			path: z.string(),
			reason: z.string(), // Why this reading is important
		})),
		architectureConstraints: z.array(z.string()),
		relatedWork: z.array(z.object({
			instanceId: z.string(),
			status: z.string(),
			summary: z.string(),
		})),
		successCriteria: z.array(z.string()),
		discoveredPatterns: z.object({
			conventions: z.array(z.string()),
			technologies: z.array(z.string()),
			approaches: z.array(z.string()),
		}).optional(),
		integrationPoints: z.array(z.object({
			component: z.string(),
			interface: z.string(),
			considerations: z.string(),
		})).optional(),
		recommendedApproach: z.string().optional(),
	}),
	prompt: z.string(), // The generated prompt for the specialist
});

export type SwarmContextInput = z.infer<typeof swarmContextInput>;
export type SwarmContextOutput = z.infer<typeof swarmContextOutput>;

/**
 * Conflict Resolution
 */
export const swarmResolveInput = z.object({
	conflictId: z.string().min(1),
	solutions: z.array(z.object({
		instanceId: z.string(),
		approach: z.string(),
		reasoning: z.string(),
		code: z.string().optional(),
	})).min(2), // Need at least 2 solutions for a conflict
	context: z.object({
		projectType: z.string(),
		requirements: z.array(z.string()),
		constraints: z.array(z.string()).optional(),
	}),
});

export const swarmResolveOutput = z.object({
	conflictId: z.string(),
	resolution: z.object({
		chosenSolution: z.string(),
		instanceId: z.string(),
		justification: z.string(),
		recommendations: z.array(z.string()),
		modifications: z.array(z.string()).optional(),
	}),
});

export type SwarmResolveInput = z.infer<typeof swarmResolveInput>;
export type SwarmResolveOutput = z.infer<typeof swarmResolveOutput>;

/**
 * Progress Synthesis
 */
export const swarmSynthesizeInput = z.object({
	taskId: z.string().min(1),
	completedSubtasks: z.array(z.object({
		id: z.string(),
		specialist: z.string(),
		output: z.string(),
		artifacts: z.array(z.string()).optional(),
	})).min(1),
	parentTask: z.string().min(1),
});

export const swarmSynthesizeOutput = z.object({
	taskId: z.string(),
	integration: z.object({
		status: z.enum(["ready_for_integration", "requires_fixes", "integrated"]),
		integrationSteps: z.array(z.string()),
		potentialIssues: z.array(z.string()),
		nextActions: z.array(z.string()),
		mergedCode: z.string().optional(),
	}),
});

export type SwarmSynthesizeInput = z.infer<typeof swarmSynthesizeInput>;
export type SwarmSynthesizeOutput = z.infer<typeof swarmSynthesizeOutput>;

/**
 * Specialist Assignment
 */
export const swarmAssignInput = z.object({
	subtaskId: z.string().min(1),
	specialist: z.enum(["frontend", "backend", "testing", "docs", "general"]),
	requiredCapabilities: z.array(z.string()).optional(),
});

export const swarmAssignOutput = z.object({
	subtaskId: z.string(),
	assignment: z.object({
		specialistId: z.string(),
		score: z.number(),
		assignedAt: z.string(),
		queuePosition: z.number().optional(),
	}),
});

export type SwarmAssignInput = z.infer<typeof swarmAssignInput>;
export type SwarmAssignOutput = z.infer<typeof swarmAssignOutput>;

/**
 * Project Creation (Queue-based)
 */
export const swarmCreateProjectInput = z.object({
	project: z.string().min(1).max(2000),
	priority: z.number().int().min(0).max(100).default(75),
	constraints: z.array(z.string()).optional(),
	metadata: z.record(z.any()).optional(),
});

export const swarmCreateProjectOutput = z.object({
	jobId: z.string(),
	projectId: z.string(),
	status: z.enum(["queued", "processing", "completed", "failed"]),
	queuePosition: z.number(),
	estimatedMinutes: z.number().optional(),
	message: z.string(),
});

export type SwarmCreateProjectInput = z.infer<typeof swarmCreateProjectInput>;
export type SwarmCreateProjectOutput = z.infer<typeof swarmCreateProjectOutput>;