import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { sessionRehydrateInput, sessionRehydrateOutput } from "@/schemas/session.schema";
import type { SessionRehydrateInput, SessionRehydrateOutput } from "@/schemas/session.schema";
import { redisKey } from "@/core/redis";
import { stateProcessor } from "@/core/state-processor";

@EventHandler({
	event: "session.rehydrate",
	inputSchema: sessionRehydrateInput,
	outputSchema: sessionRehydrateOutput,
	persist: false,
	rateLimit: 20,
	description: "Rehydrate session state for resuming work",
	mcp: {
		title: "Rehydrate Session",
		metadata: {
			examples: [
				{
					input: {
						sessionId: "session-123",
						instanceId: "worker-1"
					},
					output: {
						sessionId: "session-123",
						rehydrated: true,
						context: {
							lastTasks: [],
							lastTools: ["task.create"],
							lastPrompt: "Help me build a dashboard",
							activeTodos: []
						}
					}
				}
			],
			prerequisites: ["Session must exist with prior events"],
			warnings: ["Large sessions may take time to rehydrate"],
			useCases: [
				"Resume after context compaction",
				"Restore state after worker restart",
				"Continue interrupted work"
			]
		}
	}
})
export class SessionRehydrateHandler {
	@Instrumented(0) // Don't cache rehydration
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 },
		timeout: 10000,
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000
		}
	})
	async handle(input: SessionRehydrateInput, ctx: EventContext): Promise<SessionRehydrateOutput> {
		const { sessionId, snapshotId, fromTimestamp, instanceId } = input;

		// Update instance association
		const stateKey = redisKey("session", "state", sessionId);
		await ctx.redis.stream.hset(stateKey, {
			instanceId,
			rehydratedAt: Date.now().toString(),
			isActive: "true"
		});

		// Get snapshot if specified
		let snapshot = null;
		if (snapshotId) {
			const snapshotKey = redisKey("snapshot", sessionId, snapshotId);
			const snapshotData = await ctx.redis.stream.hgetall(snapshotKey);
			if (snapshotData.snapshotId) {
				snapshot = {
					id: snapshotData.snapshotId,
					timestamp: parseInt(snapshotData.timestamp || "0"),
					eventCount: parseInt(snapshotData.eventCount || "0")
				};
			}
		} else {
			// Find latest snapshot
			const snapshotPattern = redisKey("snapshot", sessionId, "*");
			const snapshots = await ctx.redis.stream.keys(snapshotPattern);
			if (snapshots.length > 0) {
				const latestKey = snapshots.sort().pop();
				if (latestKey) {
					const snapshotData = await ctx.redis.stream.hgetall(latestKey);
					if (snapshotData.snapshotId) {
						snapshot = {
							id: snapshotData.snapshotId,
							timestamp: parseInt(snapshotData.timestamp || "0"),
							eventCount: parseInt(snapshotData.eventCount || "0")
						};
					}
				}
			}
		}

		// Get session context
		const context = await stateProcessor.getSessionContext(sessionId);
		
		if (!context) {
			// No existing context, create minimal one
			return {
				sessionId,
				rehydrated: true,
				snapshot,
				context: {
					lastTasks: [],
					lastTools: [],
					lastPrompt: undefined,
					activeTodos: []
				}
			};
		}

		// Apply any events after snapshot/timestamp
		if (fromTimestamp) {
			const streamKey = redisKey("stream", "session", sessionId);
			const newEvents = await ctx.redis.stream.xrange(
				streamKey,
				fromTimestamp.toString(),
				"+",
				"COUNT",
				"100"
			);

			// Process new events into context
			for (const [, event] of newEvents) {
				if (event.params) {
					try {
						const params = JSON.parse(event.params);
						const eventType = event.eventType;

						if (eventType === "hook.user_prompt" && params.prompt) {
							context.lastPrompt = params.prompt;
						}
						
						if ((eventType === "hook.pre_tool" || eventType === "hook.post_tool") && params.tool) {
							if (!context.lastTools.includes(params.tool)) {
								context.lastTools.push(params.tool);
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
		}

		// Publish rehydration event
		await ctx.publish({
			type: "session.rehydrated",
			payload: {
				sessionId,
				instanceId,
				snapshotId: snapshot?.id,
				eventCount: Object.values(context.eventCounts).reduce((a, b) => a + b, 0)
			}
		});

		// Track metrics
		const metricsKey = redisKey("metrics", "session", "rehydrations");
		await ctx.redis.stream.hincrby(metricsKey, "count", 1);
		await ctx.redis.stream.hset(metricsKey, "lastRehydration", Date.now().toString());

		return {
			sessionId,
			rehydrated: true,
			snapshot,
			context: {
				lastTasks: context.lastTasks,
				lastTools: context.lastTools,
				lastPrompt: context.lastPrompt,
				activeTodos: context.activeTodos
			}
		};
	}
}