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
	}),
});

export type SwarmDecomposeInput = z.infer<typeof swarmDecomposeInput>;
export type SwarmDecomposeOutput = z.infer<typeof swarmDecomposeOutput>;

/**
 * Context Generation
 */
export const swarmContextInput = z.object({
	subtaskId: z.string().min(1),
	specialist: z.enum(["frontend", "backend", "testing", "docs"]),
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
		})),
		architectureConstraints: z.array(z.string()),
		relatedWork: z.array(z.object({
			instanceId: z.string(),
			status: z.string(),
			summary: z.string(),
		})),
		successCriteria: z.array(z.string()),
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
	parentTask: z.string(),
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