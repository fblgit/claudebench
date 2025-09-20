import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { sessionStateGetInput, sessionStateGetOutput } from "@/schemas/session.schema";
import type { SessionStateGetInput, SessionStateGetOutput } from "@/schemas/session.schema";
import { redisKey } from "@/core/redis";
import { stateProcessor } from "@/core/state-processor";

@EventHandler({
	event: "session.state.get",
	inputSchema: sessionStateGetInput,
	outputSchema: sessionStateGetOutput,
	persist: false,
	rateLimit: 50,
	description: "Retrieve session state and events",
	mcp: {
		title: "Get Session State",
		metadata: {
			examples: [
				{
					description: "Get condensed session state",
					input: {
						sessionId: "session-123",
						condensed: true,
						limit: 50
					},
					output: {
						sessionId: "session-123",
						events: [],
						condensed: {
							tasks: [],
							tools: ["task.create", "swarm.decompose"],
							prompts: [],
							todos: []
						}
					}
				}
			],
			prerequisites: ["Session must exist with events"],
			warnings: ["Large event counts may impact performance"],
		}
	}
})
export class SessionStateGetHandler {
	@Instrumented(60) // Cache for 1 minute
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000
		}
	})
	async handle(input: SessionStateGetInput, ctx: EventContext): Promise<SessionStateGetOutput> {
		const { sessionId, fromTimestamp, toTimestamp, eventTypes, limit = 100, condensed = false } = input;

		// If condensed, get from state processor
		if (condensed) {
			const context = await stateProcessor.getSessionContext(sessionId);
			if (!context) {
				return {
					sessionId,
					events: [],
					condensed: {
						tasks: [],
						tools: [],
						prompts: [],
						todos: []
					}
				};
			}

			return {
				sessionId,
				events: [],
				condensed: {
					tasks: context.lastTasks,
					tools: context.lastTools.map(tool => ({
						name: tool,
						count: context.eventCounts[`hook.pre_tool`] || 0,
						lastUsed: Date.now()
					})),
					prompts: context.lastPrompt ? [{
						prompt: context.lastPrompt,
						timestamp: Date.now()
					}] : [],
					todos: context.activeTodos
				},
				summary: {
					totalEvents: Object.values(context.eventCounts).reduce((a, b) => a + b, 0),
					firstEvent: undefined,
					lastEvent: Date.now(),
					eventCounts: context.eventCounts
				}
			};
		}

		// Get raw events from stream
		const streamKey = redisKey("stream", "session", sessionId);
		let rawEvents: Array<[string, string[]]>;

		if (fromTimestamp && toTimestamp) {
			rawEvents = await ctx.redis.stream.xrange(
				streamKey,
				fromTimestamp.toString(),
				toTimestamp.toString(),
				"COUNT",
				limit.toString()
			);
		} else {
			rawEvents = await ctx.redis.stream.xrange(
				streamKey,
				"-",
				"+",
				"COUNT",
				limit.toString()
			);
		}

		// Convert raw events to proper format
		const events: Array<[string, Record<string, string>]> = rawEvents.map(([id, fields]) => [
			id,
			fields.reduce((acc: Record<string, string>, val: string, idx: number, arr: string[]) => {
				if (idx % 2 === 0 && arr[idx + 1] !== undefined) {
					acc[val] = arr[idx + 1];
				}
				return acc;
			}, {})
		])

		// Filter by event types if specified
		let filteredEvents = events;
		if (eventTypes && eventTypes.length > 0) {
			filteredEvents = events.filter(([, event]) => 
				eventTypes.includes(event.eventType)
			);
		}

		// Transform events for output
		const outputEvents = filteredEvents.map(([id, event]) => ({
			eventId: event.eventId || id,
			eventType: event.eventType,
			timestamp: parseInt(event.timestamp || "0"),
			data: {
				params: event.params ? JSON.parse(event.params) : {},
				result: event.result ? JSON.parse(event.result) : {},
			},
			labels: event.labels ? JSON.parse(event.labels) : []
		}));

		// Calculate summary
		const eventCounts: Record<string, number> = {};
		for (const [, event] of filteredEvents) {
			eventCounts[event.eventType] = (eventCounts[event.eventType] || 0) + 1;
		}

		const timestamps = outputEvents.map(e => e.timestamp).filter(t => t > 0);
		
		return {
			sessionId,
			events: outputEvents,
			summary: {
				totalEvents: outputEvents.length,
				firstEvent: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
				lastEvent: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
				eventCounts
			}
		};
	}
}