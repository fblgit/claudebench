import { getRedis, redisKey } from "./redis";
import type { Redis as RedisClient } from "ioredis";

export interface Event {
	id?: string;
	type: string;
	payload: any;
	metadata?: Record<string, any>;
	timestamp?: number;
}

export class EventBus {
	private redis: ReturnType<typeof getRedis>;
	private subscribers: Map<string, Set<(event: Event) => Promise<void>>> = new Map();

	constructor() {
		this.redis = getRedis();
	}

	async publish(event: Event): Promise<string> {
		const eventId = event.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const streamKey = redisKey("stream", event.type);
		const eventData = {
			...event,
			id: eventId,
			timestamp: event.timestamp || Date.now(),
		};

		// Add to Redis Stream for persistence
		await this.redis.stream.xadd(
			streamKey,
			"*",
			"data",
			JSON.stringify(eventData)
		);

		// Publish to Redis pub/sub for real-time
		await this.redis.pub.publish(event.type, JSON.stringify(eventData));

		return eventId;
	}

	async subscribe(eventType: string, handler: (event: Event) => Promise<void>): Promise<void> {
		if (!this.subscribers.has(eventType)) {
			this.subscribers.set(eventType, new Set());
			
			// Subscribe to Redis channel
			await this.redis.sub.subscribe(eventType);
			this.redis.sub.on("message", async (channel, message) => {
				if (channel === eventType) {
					const event = JSON.parse(message);
					const handlers = this.subscribers.get(eventType);
					if (handlers) {
						await Promise.all([...handlers].map(h => h(event)));
					}
				}
			});
		}
		
		this.subscribers.get(eventType)!.add(handler);
	}

	async getEvents(eventType: string, limit = 100): Promise<Event[]> {
		const streamKey = redisKey("stream", eventType);
		const events = await this.redis.stream.xrevrange(streamKey, "+", "-", "COUNT", limit);
		return events.map(([, fields]) => JSON.parse(fields[1]));
	}
}

export const eventBus = new EventBus();