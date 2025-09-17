import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { swarmAssignInput, swarmAssignOutput } from "@/schemas/swarm.schema";
import type { SwarmAssignInput, SwarmAssignOutput } from "@/schemas/swarm.schema";
import { redisScripts } from "@/core/redis-scripts";
import { getRedis } from "@/core/redis";

@EventHandler({
	event: "swarm.assign",
	inputSchema: swarmAssignInput,
	outputSchema: swarmAssignOutput,
	persist: true,
	rateLimit: 50,
	description: "Assign subtask to best available specialist with capability matching",
	mcp: {
		title: "Assign Specialist",
		metadata: {
			examples: [
				{
					description: "Assign frontend subtask to specialist",
					input: {
						subtaskId: "st-1",
						specialist: "frontend",
						requiredCapabilities: ["react", "typescript", "css"]
					}
				}
			],
			tags: ["swarm", "assignment", "specialist"],
			useCases: [
				"Matching subtasks to capable specialists",
				"Load balancing across multiple specialists",
				"Queue management for busy specialists",
				"Capability-based scoring and selection"
			],
			prerequisites: [
				"Triggered by swarm.decompose for ready subtasks",
				"Triggered when dependencies resolved",
				"Specialists must be registered and active"
			],
			warnings: [
				"Assignment is atomic via Lua script",
				"May queue if no specialists available",
				"Score calculation considers load and capabilities"
			]
		}
	}
})
export class SwarmAssignHandler {
	@Instrumented(10) // Brief caching for assignment results
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 assignments per minute
		timeout: 5000, // 5 seconds timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				subtaskId: "",
				assignment: {
					specialistId: "queue",
					score: 0,
					assignedAt: new Date().toISOString(),
					queuePosition: 1
				}
			})
		}
	})
	async handle(input: SwarmAssignInput, ctx: EventContext): Promise<SwarmAssignOutput> {
		const redis = getRedis();
		
		// Get subtask data
		const subtaskKey = `cb:subtask:${input.subtaskId}`;
		const subtaskData = await redis.pub.hget(subtaskKey, "data");
		
		let subtask = null;
		if (subtaskData) {
			subtask = JSON.parse(subtaskData);
		} else if (ctx.prisma) {
			// Try to fetch from database
			const dbSubtask = await ctx.prisma.swarmSubtask.findUnique({
				where: { id: input.subtaskId }
			});
			
			if (dbSubtask) {
				subtask = {
					id: dbSubtask.id,
					description: dbSubtask.description,
					specialist: dbSubtask.specialist,
					complexity: dbSubtask.complexity,
					dependencies: dbSubtask.dependencies,
					context: dbSubtask.context as any
				};
			}
		}
		
		if (!subtask) {
			throw new Error(`Subtask ${input.subtaskId} not found`);
		}
		
		// Check if already assigned
		if (subtask.assignedTo) {
			// Return existing assignment
			const existingAssignment = await this.getExistingAssignment(
				input.subtaskId,
				subtask.assignedTo,
				ctx
			);
			
			if (existingAssignment) {
				return {
					subtaskId: input.subtaskId,
					assignment: existingAssignment
				};
			}
		}
		
		// Use Lua script to assign to best available specialist
		const result = await redisScripts.assignToSpecialist(
			input.subtaskId,
			input.specialist,
			input.requiredCapabilities || []
		);
		
		if (!result.success) {
			// No specialist available, add to queue
			await redis.pub.zadd(
				`cb:queue:${input.specialist}`,
				Date.now(),
				input.subtaskId
			);
			
			// Get queue position
			const position = await redis.pub.zrank(
				`cb:queue:${input.specialist}`,
				input.subtaskId
			);
			
			return {
				subtaskId: input.subtaskId,
				assignment: {
					specialistId: "queue",
					score: 0,
					assignedAt: new Date().toISOString(),
					queuePosition: (position || 0) + 1
				}
			};
		}
		
		// Persist assignment to database
		if (ctx.persist && ctx.prisma && result.specialistId) {
			// Create assignment record
			await ctx.prisma.swarmAssignment.create({
				data: {
					subtaskId: input.subtaskId,
					specialistId: result.specialistId,
					score: result.score,
					assignedAt: new Date()
				}
			});
			
			// Update subtask status
			await ctx.prisma.swarmSubtask.update({
				where: { id: input.subtaskId },
				data: {
					status: "assigned",
					assignedTo: result.specialistId,
					updatedAt: new Date()
				}
			});
		}
		
		// Update Redis with assignment
		if (result.specialistId) {
			await redis.pub.hset(subtaskKey, {
				assignedTo: result.specialistId,
				status: "assigned",
				assignedAt: Date.now()
			});
		}
		
		// Publish assignment event
		await ctx.publish({
			type: "swarm.assigned",
			payload: {
				subtaskId: input.subtaskId,
				specialistId: result.specialistId || "unknown",
				specialist: input.specialist,
				score: result.score
			},
			metadata: {
				assignedBy: ctx.instanceId,
				timestamp: Date.now()
			}
		});
		
		// Trigger context generation for the assigned specialist
		if (result.specialistId) {
			await ctx.publish({
				type: "swarm.generate_context",
				payload: {
					subtaskId: input.subtaskId,
					specialist: input.specialist,
					specialistId: result.specialistId
				},
				metadata: {
					timestamp: Date.now()
				}
			});
		}
		
		// Check if this unblocks other subtasks
		if (subtask.dependencies && subtask.dependencies.length > 0) {
			await this.checkDependencyUnblocking(
				input.subtaskId,
				subtask.parentId,
				ctx
			);
		}
		
		return {
			subtaskId: input.subtaskId,
			assignment: {
				specialistId: result.specialistId || "unknown",
				score: result.score,
				assignedAt: new Date().toISOString(),
				queuePosition: undefined
			}
		};
	}
	
	/**
	 * Get existing assignment details
	 */
	private async getExistingAssignment(
		subtaskId: string,
		specialistId: string,
		ctx: EventContext
	): Promise<any> {
		if (ctx.prisma) {
			const assignment = await ctx.prisma.swarmAssignment.findUnique({
				where: { subtaskId }
			});
			
			if (assignment) {
				return {
					specialistId: assignment.specialistId,
					score: assignment.score,
					assignedAt: assignment.assignedAt.toISOString()
				};
			}
		}
		
		// Fallback to Redis data
		const redis = getRedis();
		const assignmentData = await redis.pub.hget(
			`cb:assignment:${subtaskId}`,
			"data"
		);
		
		if (assignmentData) {
			return JSON.parse(assignmentData);
		}
		
		return null;
	}
	
	/**
	 * Check if completing this subtask unblocks others
	 */
	private async checkDependencyUnblocking(
		completedSubtaskId: string,
		parentId: string,
		ctx: EventContext
	): Promise<void> {
		if (!ctx.prisma) return;
		
		// Find subtasks that depend on this one
		const dependentSubtasks = await ctx.prisma.swarmSubtask.findMany({
			where: {
				parentId,
				dependencies: { has: completedSubtaskId },
				status: "pending"
			}
		});
		
		for (const dependent of dependentSubtasks) {
			// Check if all dependencies are now resolved
			const unresolvedDeps = await ctx.prisma.swarmSubtask.count({
				where: {
					id: { in: dependent.dependencies },
					status: { not: "completed" }
				}
			});
			
			if (unresolvedDeps === 0) {
				// All dependencies resolved, trigger assignment
				await ctx.publish({
					type: "swarm.assign",
					payload: {
						subtaskId: dependent.id,
						specialist: dependent.specialist,
						requiredCapabilities: (dependent.context as any)?.patterns || []
					},
					metadata: {
						parentTaskId: parentId,
						unblocked: true,
						timestamp: Date.now()
					}
				});
			}
		}
	}
}