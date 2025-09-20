import { getRedis, redisKey } from "@/core/redis";
import { getPrisma } from "@/core/context";
import { redisScripts } from "@/core/redis-scripts";
import type { HookStateEvent } from "@/core/hook-manager";

export interface SessionContext {
	lastTasks: Array<{ id: string; text: string; status: string }>;
	lastTools: string[];
	lastPrompt?: string;
	activeTodos: Array<{ content: string; status: string }>;
	eventCounts: Record<string, number>;
	instanceId?: string;
}

export class StateProcessor {
	private redis = getRedis();
	private prisma = getPrisma();
	private isRunning = false;
	private snapshotThreshold = 100; // Create snapshot every 100 events

	async initialize(): Promise<void> {
		if (this.isRunning) {
			console.log("[StateProcessor] Already running");
			return;
		}

		console.log("[StateProcessor] Initializing state processor...");
		this.isRunning = true;

		// Subscribe to ALL hook execution events (the actual events from handlers)
		await this.redis.sub.psubscribe("hook.*.executed");

		// Handle incoming events
		this.redis.sub.on("pmessage", async (pattern, channel, message) => {
			if (pattern === "hook.*.executed") {
				try {
					const event = JSON.parse(message);
					// Transform to HookStateEvent format
					const hookStateEvent: HookStateEvent = {
						eventId: `hse-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
						hookType: channel.replace("hook.", "").replace(".executed", ""),
						sessionId: event.payload?.sessionId || "unknown",
						instanceId: event.payload?.instanceId || "unknown",
						params: event.payload,
						result: event.payload?.validationResult || { allow: true },
						timestamp: event.payload?.timestamp || Date.now(),
						labels: this.extractLabelsFromEvent(channel, event.payload)
					};
					await this.processHookEvent(hookStateEvent);
				} catch (error) {
					console.error("[StateProcessor] Failed to process hook event:", error);
				}
			}
		});

		// Also subscribe to task events for complete state tracking
		await this.redis.sub.psubscribe("task.*");
		
		console.log("[StateProcessor] State processor initialized");
	}

	private extractLabelsFromEvent(channel: string, payload: any): string[] {
		const labels: string[] = [channel];
		
		if (payload?.tool) {
			labels.push(`tool:${payload.tool}`);
		}
		if (payload?.prompt) {
			labels.push("prompt");
		}
		if (payload?.todos) {
			labels.push("todos");
		}
		
		return labels;
	}

	async shutdown(): Promise<void> {
		console.log("[StateProcessor] Shutting down...");
		this.isRunning = false;
		await this.redis.sub.unsubscribe();
		await this.redis.sub.punsubscribe();
	}

	private async processHookEvent(event: HookStateEvent): Promise<void> {
		const { sessionId, hookType, params, result, labels, eventId, timestamp, instanceId } = event;

		// Use atomic Lua script to process the event
		const scriptResult = await redisScripts.processHookEvent({
			eventId,
			eventType: `hook.${hookType}`,
			sessionId,
			instanceId,
			timestamp,
			params,
			result,
			labels: labels || [],
		});

		// Check if snapshot is needed based on script result
		if (scriptResult.needsSnapshot) {
			await this.createSnapshot(sessionId, "threshold");
		}

		// Update database if persistence is enabled
		await this.persistToDatabase(sessionId, event, scriptResult.eventCount);
	}

	private async persistToDatabase(
		sessionId: string,
		event: HookStateEvent,
		eventCount: number
	): Promise<void> {
		// Persist event to PostgreSQL (use upsert to handle duplicates)
		if (this.prisma && process.env.PERSIST_HOOK_STATE !== "false") {
			try {
				await this.prisma.sessionEvent.upsert({
					where: { eventId: event.eventId },
					create: {
						eventId: event.eventId,
						sessionId,
						instanceId: event.instanceId,
						eventType: `hook.${event.hookType}`,
						eventData: {
							params: event.params,
							result: event.result,
						} as any,
						labels: event.labels || [],
						timestamp: new Date(event.timestamp),
					},
					update: {
						// Only update timestamp if event already exists
						timestamp: new Date(event.timestamp),
					},
				});
				console.log(`[StateProcessor] Persisted event ${event.eventId} to PostgreSQL`);
			} catch (error) {
				console.error("[StateProcessor] Failed to persist event to PostgreSQL:", error);
			}
		}

		// Update session state in database
		if (this.prisma && process.env.PERSIST_SESSION_STATE !== "false") {
			try {
				// Get context for database update
				const context = await redisScripts.buildSessionContext(sessionId, 10);
				
				await this.prisma.sessionState.upsert({
					where: { sessionId },
					create: {
						id: sessionId,
						sessionId,
						instanceId: event.instanceId,
						lastEventId: event.eventId,
						lastActivity: new Date(event.timestamp),
						eventCount,
						isActive: true,
						recentTools: context.lastTools || [],
						currentTodos: context.activeTodos || [],
						needsSnapshot: false,
					},
					update: {
						lastEventId: event.eventId,
						lastActivity: new Date(event.timestamp),
						eventCount,
						isActive: true,
						recentTools: context.lastTools || [],
						currentTodos: context.activeTodos || [],
						needsSnapshot: eventCount % this.snapshotThreshold === 0,
						isStale: false,
					},
				});
			} catch (error) {
				console.error("[StateProcessor] Failed to update session state in database:", error);
			}
		}
	}

	async createSnapshot(sessionId: string, reason: string): Promise<string> {
		const snapshotId = `snap-${sessionId}-${Date.now()}`;

		console.log(`[StateProcessor] Creating snapshot ${snapshotId} for session ${sessionId}`);

		// Use atomic Lua script to create snapshot
		const result = await redisScripts.createSessionSnapshot(
			sessionId,
			snapshotId,
			reason
		);

		if (!result.success) {
			console.error(`[StateProcessor] Failed to create snapshot for session ${sessionId}`);
			return snapshotId;
		}

		// Get context for database persistence
		const context = await redisScripts.buildSessionContext(sessionId, result.eventCount);

		// Store in database (default true, disable with PERSIST_SNAPSHOTS=false)
		if (this.prisma && process.env.PERSIST_SNAPSHOTS !== "false") {
			try {
				await this.prisma.sessionSnapshot.create({
					data: {
						snapshotId,
						sessionId,
						instanceId: context.instanceId || "unknown",
						reason: reason as any,
						eventCount: result.eventCount,
						size: JSON.stringify(context).length,
						context: context as any,
						summary: {
							eventCounts: context.eventCounts,
							toolsUsed: context.lastTools.length,
							todosActive: context.activeTodos.length,
						},
						eventIds: [], // Would need to fetch from stream if needed
						fromTime: new Date(),
						toTime: new Date(),
					},
				});
			} catch (error) {
				console.error("[StateProcessor] Failed to persist snapshot:", error);
			}
		}

		return snapshotId;
	}

	// Public method to get session context
	async getSessionContext(sessionId: string): Promise<SessionContext | null> {
		// Try to get latest snapshot first
		const snapshotPattern = redisKey("snapshot", sessionId, "*");
		const snapshots = await this.redis.pub.keys(snapshotPattern);
		
		if (snapshots.length > 0) {
			// Get the latest snapshot
			const latestSnapshot = snapshots.sort().pop();
			if (latestSnapshot) {
				const snapshotData = await this.redis.pub.hget(latestSnapshot, "context");
				if (snapshotData) {
					return JSON.parse(snapshotData);
				}
			}
		}

		// If no snapshot, build from events using Lua script
		try {
			const context = await redisScripts.buildSessionContext(sessionId, 100);
			return context;
		} catch (error) {
			console.error(`[StateProcessor] Failed to build session context: ${error}`);
			return null;
		}
	}
}

// Singleton instance
export const stateProcessor = new StateProcessor();