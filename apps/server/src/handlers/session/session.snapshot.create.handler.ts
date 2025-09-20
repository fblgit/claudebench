import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { sessionSnapshotCreateInput, sessionSnapshotCreateOutput } from "@/schemas/session.schema";
import type { SessionSnapshotCreateInput, SessionSnapshotCreateOutput } from "@/schemas/session.schema";
import { stateProcessor } from "@/core/state-processor";

@EventHandler({
	event: "session.snapshot.create",
	inputSchema: sessionSnapshotCreateInput,
	outputSchema: sessionSnapshotCreateOutput,
	persist: true,
	rateLimit: 10,
	description: "Create a snapshot of session state for recovery",
	mcp: {
		title: "Create Session Snapshot",
		metadata: {
			examples: [
				{
					description: "Create snapshot before compaction",
					input: {
						sessionId: "session-123",
						instanceId: "worker-1",
						reason: "pre_compact",
						includeEvents: true
					},
					output: {
						snapshotId: "snap-session-123-1234567890",
						sessionId: "session-123",
						timestamp: 1234567890,
						size: 2048,
						eventCount: 42
					}
				}
			],
			prerequisites: ["Active session with events"],
			warnings: ["Snapshots consume storage space", "Large sessions may take time"],
			useCases: [
				"Before context compaction",
				"Periodic checkpoints",
				"Error recovery points",
				"Session archival"
			]
		}
	}
})
export class SessionSnapshotCreateHandler {
	@Instrumented(0) // Don't cache snapshot creation
	@Resilient({
		rateLimit: { limit: 10, windowMs: 60000 },
		timeout: 15000,
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000
		}
	})
	async handle(input: SessionSnapshotCreateInput, ctx: EventContext): Promise<SessionSnapshotCreateOutput> {
		const { sessionId, instanceId, reason, includeEvents = true, metadata } = input;

		// Create snapshot via state processor
		const snapshotId = await stateProcessor.createSnapshot(sessionId, reason);

		// Get snapshot details
		const snapshotKey = `cb:snapshot:${sessionId}:${snapshotId}`;
		const snapshotData = await ctx.redis.stream.hgetall(snapshotKey);

		const eventCount = parseInt(snapshotData.eventCount || "0");
		const timestamp = parseInt(snapshotData.timestamp || Date.now().toString());
		const context = snapshotData.context ? JSON.parse(snapshotData.context) : {};
		const size = JSON.stringify(context).length;

		// Store metadata if provided
		if (metadata) {
			await ctx.redis.stream.hset(snapshotKey, {
				metadata: JSON.stringify(metadata)
			});
		}

		// Persist to database if configured
		if (ctx.persist && ctx.prisma) {
			try {
				// Check if already persisted by state processor
				const existing = await ctx.prisma.sessionSnapshot.findUnique({
					where: { snapshotId }
				});

				if (!existing) {
					await ctx.prisma.sessionSnapshot.create({
						data: {
							snapshotId,
							sessionId,
							instanceId,
							reason: reason as any,
							eventCount,
							size,
							context,
							summary: {
								eventCounts: context.eventCounts || {},
								toolsUsed: context.lastTools?.length || 0,
								todosActive: context.activeTodos?.length || 0,
								metadata: metadata || {} as any
							},
							eventIds: [],
							fromTime: new Date(timestamp - 3600000), // 1 hour before
							toTime: new Date(timestamp),
						}
					});
				}
			} catch (error) {
				console.error("Failed to persist snapshot:", error);
			}
		}

		// Publish event
		await ctx.publish({
			type: "session.snapshot.created",
			payload: {
				snapshotId,
				sessionId,
				instanceId,
				reason,
				eventCount,
				size,
				timestamp
			}
		});

		// Update metrics
		const metricsKey = `cb:metrics:snapshots`;
		await ctx.redis.stream.hincrby(metricsKey, "count", 1);
		await ctx.redis.stream.hincrby(metricsKey, `reason:${reason}`, 1);
		await ctx.redis.stream.hset(metricsKey, "lastSnapshot", timestamp.toString());

		return {
			snapshotId,
			sessionId,
			timestamp,
			size,
			eventCount
		};
	}
}