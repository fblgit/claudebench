import { getRedis, redisKey } from "@/core/redis";
import { getPrisma } from "@/core/context";
import type { HookStateEvent } from "@/core/hook-manager";

export interface SessionContext {
	lastTasks: Array<{ id: string; text: string; status: string }>;
	lastTools: string[];
	lastPrompt?: string;
	activeTodos: Array<{ content: string; status: string }>;
	eventCounts: Record<string, number>;
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

		// Store in Redis stream
		const streamKey = redisKey("stream", "session", sessionId);
		const streamData = {
			eventId,
			eventType: `hook.${hookType}`,
			sessionId,
			instanceId,
			timestamp: timestamp.toString(),
			params: JSON.stringify(params),
			result: JSON.stringify(result),
			labels: JSON.stringify(labels),
		};

		await this.redis.pub.xadd(
			streamKey,
			"*",
			...Object.entries(streamData).flat()
		);

		// Set expiry on stream (7 days)
		await this.redis.pub.expire(streamKey, 604800);

		// Persist to PostgreSQL (default true, disable with PERSIST_HOOK_STATE=false)
		if (this.prisma && process.env.PERSIST_HOOK_STATE !== "false") {
			try {
				await this.prisma.sessionEvent.create({
					data: {
						eventId,
						sessionId,
						instanceId,
						eventType: `hook.${hookType}`,
						eventData: {
							params,
							result,
						},
						labels: labels || [],
						timestamp: new Date(timestamp),
					},
				});
				console.log(`[StateProcessor] Persisted event ${eventId} to PostgreSQL`);
			} catch (error) {
				console.error("[StateProcessor] Failed to persist to PostgreSQL:", error);
			}
		}

		// Update session state
		await this.updateSessionState(sessionId, event);

		// Update condensed context based on hook type
		await this.updateCondensedContext(sessionId, hookType, params, result);

		// Check if snapshot is needed
		const eventCount = await this.getSessionEventCount(sessionId);
		if (eventCount % this.snapshotThreshold === 0) {
			await this.createSnapshot(sessionId, "threshold");
		}

		// Update metrics
		await this.updateMetrics(sessionId, hookType);
	}

	private async updateSessionState(sessionId: string, event: HookStateEvent): Promise<void> {
		const stateKey = redisKey("session", "state", sessionId);
		const now = Date.now();

		// Update basic state
		await this.redis.pub.hset(stateKey, {
			lastEventId: event.eventId,
			lastActivity: now.toString(),
			instanceId: event.instanceId,
		});

		// Increment event count
		const eventCount = await this.redis.pub.hincrby(stateKey, "eventCount", 1);

		// Set expiry (7 days)
		await this.redis.pub.expire(stateKey, 604800);

		// Get condensed state from Redis for PostgreSQL update
		const toolsKey = redisKey("session", "tools", sessionId);
		const contextKey = redisKey("session", "context", sessionId);
		
		// Get recent tools (Redis list)
		const recentTools = await this.redis.pub.lrange(toolsKey, 0, 9);
		
		// Get todos and last prompt from context hash
		const contextData = await this.redis.pub.hgetall(contextKey);
		const currentTodos = contextData.activeTodos ? JSON.parse(contextData.activeTodos) : [];

		// Update database (default true, disable with PERSIST_SESSION_STATE=false)
		if (this.prisma && process.env.PERSIST_SESSION_STATE !== "false") {
			try {
				await this.prisma.sessionState.upsert({
					where: { sessionId },
					create: {
						id: sessionId,
						sessionId,
						instanceId: event.instanceId,
						lastEventId: event.eventId,
						lastActivity: new Date(now),
						eventCount: 1,
						isActive: true,
						recentTools: recentTools,
						currentTodos: currentTodos,
						needsSnapshot: false,
					},
					update: {
						lastEventId: event.eventId,
						lastActivity: new Date(now),
						eventCount: { increment: 1 },
						isActive: true,
						recentTools: recentTools,
						currentTodos: currentTodos,
						needsSnapshot: eventCount % this.snapshotThreshold === 0,
						isStale: false,
					},
				});
			} catch (error) {
				console.error("[StateProcessor] Failed to update database:", error);
			}
		}
	}

	private async updateCondensedContext(
		sessionId: string,
		hookType: string,
		params: any,
		result: any
	): Promise<void> {
		const contextKey = redisKey("session", "context", sessionId);

		switch (hookType) {
			case "pre_tool":
			case "post_tool":
				// Track tool usage
				if (params.tool) {
					await this.redis.pub.lpush(
						redisKey("session", "tools", sessionId),
						params.tool
					);
					await this.redis.pub.ltrim(
						redisKey("session", "tools", sessionId),
						0,
						9 // Keep last 10 tools
					);
				}
				break;

			case "user_prompt":
				// Store last prompt
				if (params.prompt) {
					await this.redis.pub.hset(contextKey, {
						lastPrompt: params.prompt,
						lastPromptTime: Date.now().toString(),
					});
				}
				break;

			case "todo_write":
				// Update todo state
				if (params.todos) {
					await this.redis.pub.hset(contextKey, {
						activeTodos: JSON.stringify(params.todos),
						lastTodoUpdate: Date.now().toString(),
					});
				}
				break;
		}

		// Set expiry
		await this.redis.pub.expire(contextKey, 604800);
	}

	private async getSessionEventCount(sessionId: string): Promise<number> {
		const stateKey = redisKey("session", "state", sessionId);
		const count = await this.redis.pub.hget(stateKey, "eventCount");
		return parseInt(count || "0");
	}

	async createSnapshot(sessionId: string, reason: string): Promise<string> {
		const snapshotId = `snap-${sessionId}-${Date.now()}`;
		const streamKey = redisKey("stream", "session", sessionId);

		console.log(`[StateProcessor] Creating snapshot ${snapshotId} for session ${sessionId}`);

		// Get all events from stream
		const events = await this.redis.pub.xrange(streamKey, "-", "+");

		// Build condensed context
		const context = await this.buildCondensedContext(sessionId, events);

		// Store snapshot
		const snapshotKey = redisKey("snapshot", sessionId, snapshotId);
		await this.redis.pub.hset(snapshotKey, {
			snapshotId,
			sessionId,
			reason,
			eventCount: events.length.toString(),
			timestamp: Date.now().toString(),
			context: JSON.stringify(context),
		});
		await this.redis.pub.expire(snapshotKey, 2592000); // 30 days

		// Store in database (default true, disable with PERSIST_SNAPSHOTS=false)
		if (this.prisma && process.env.PERSIST_SNAPSHOTS !== "false") {
			try {
				await this.prisma.sessionSnapshot.create({
					data: {
						snapshotId,
						sessionId,
						instanceId: context.instanceId || "unknown",
						reason: reason as any,
						eventCount: events.length,
						size: JSON.stringify(context).length,
						context,
						summary: {
							eventCounts: context.eventCounts,
							toolsUsed: context.lastTools.length,
							todosActive: context.activeTodos.length,
						},
						eventIds: events.map(e => e[1].eventId || ""),
						fromTime: new Date(parseInt(events[0]?.[1].timestamp || "0")),
						toTime: new Date(parseInt(events[events.length - 1]?.[1].timestamp || "0")),
					},
				});
			} catch (error) {
				console.error("[StateProcessor] Failed to persist snapshot:", error);
			}
		}

		return snapshotId;
	}

	private async buildCondensedContext(
		sessionId: string,
		events: Array<[string, Record<string, string>]>
	): Promise<SessionContext> {
		const context: SessionContext = {
			lastTasks: [],
			lastTools: [],
			lastPrompt: undefined,
			activeTodos: [],
			eventCounts: {},
		};

		// Process events to extract context
		for (const [, event] of events) {
			const eventType = event.eventType;
			
			// Count event types
			context.eventCounts[eventType] = (context.eventCounts[eventType] || 0) + 1;

			// Extract specific context based on event type
			if (event.params) {
				try {
					const params = JSON.parse(event.params);
					
					if (eventType === "hook.user_prompt" && params.prompt) {
						context.lastPrompt = params.prompt;
					}
					
					if ((eventType === "hook.pre_tool" || eventType === "hook.post_tool") && params.tool) {
						if (!context.lastTools.includes(params.tool)) {
							context.lastTools.push(params.tool);
							if (context.lastTools.length > 10) {
								context.lastTools.shift();
							}
						}
					}
					
					if (eventType === "hook.todo_write" && params.todos) {
						context.activeTodos = params.todos;
					}
				} catch (e) {
					// Ignore parse errors
				}
			}
		}

		// Get recent tasks from Redis
		const tasksKey = redisKey("session", "tasks", sessionId);
		const taskIds = await this.redis.pub.lrange(tasksKey, 0, 4);
		for (const taskId of taskIds) {
			const taskData = await this.redis.pub.hgetall(redisKey("task", taskId));
			if (taskData.id) {
				context.lastTasks.push({
					id: taskData.id,
					text: taskData.text || "",
					status: taskData.status || "unknown",
				});
			}
		}

		return context;
	}

	private async updateMetrics(sessionId: string, hookType: string): Promise<void> {
		const metricsKey = redisKey("metrics", "session", sessionId);
		await this.redis.pub.hincrby(metricsKey, `hook.${hookType}`, 1);
		await this.redis.pub.hincrby(metricsKey, "total", 1);
		await this.redis.pub.expire(metricsKey, 86400); // 24 hours
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

		// If no snapshot, build from events
		const streamKey = redisKey("stream", "session", sessionId);
		const events = await this.redis.pub.xrange(streamKey, "-", "+", "COUNT", "100");
		
		if (events.length === 0) {
			return null;
		}

		return await this.buildCondensedContext(sessionId, events);
	}
}

// Singleton instance
export const stateProcessor = new StateProcessor();