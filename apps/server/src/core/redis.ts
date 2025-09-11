import Redis from "ioredis";
import type { Redis as RedisClient, RedisOptions } from "ioredis";

export class RedisConnection {
	private static instance: RedisConnection;
	private pubClient: RedisClient;
	private subClient: RedisClient;
	private streamClient: RedisClient;

	private constructor(options: RedisOptions = {}) {
		const defaultOptions: RedisOptions = {
			host: process.env.REDIS_HOST || "localhost",
			port: parseInt(process.env.REDIS_PORT || "6379"),
			retryStrategy: (times) => Math.min(times * 50, 2000),
			maxRetriesPerRequest: 3,
			enableReadyCheck: true,
			lazyConnect: false,
		};

		const finalOptions = { ...defaultOptions, ...options };

		// Create separate clients for different concerns
		this.pubClient = new Redis(finalOptions);
		this.subClient = new Redis(finalOptions);
		this.streamClient = new Redis(finalOptions);

		// Set client names for debugging
		this.pubClient.client("SETNAME", "cb:pub");
		this.subClient.client("SETNAME", "cb:sub");
		this.streamClient.client("SETNAME", "cb:stream");
	}

	static getInstance(options?: RedisOptions): RedisConnection {
		if (!RedisConnection.instance) {
			RedisConnection.instance = new RedisConnection(options);
		}
		return RedisConnection.instance;
	}

	get pub(): RedisClient {
		return this.pubClient;
	}

	get sub(): RedisClient {
		return this.subClient;
	}

	get stream(): RedisClient {
		return this.streamClient;
	}

	async disconnect(): Promise<void> {
		// Disconnect all clients gracefully
		await Promise.all([
			this.pubClient.quit().catch(() => {}),
			this.subClient.quit().catch(() => {}),
			this.streamClient.quit().catch(() => {}),
		]);
		// Clear the singleton instance
		RedisConnection.instance = null as any;
	}

	async ping(): Promise<boolean> {
		try {
			const result = await this.streamClient.ping();
			return result === "PONG";
		} catch {
			return false;
		}
	}

	isConnected(): boolean {
		return this.streamClient.status === "ready";
	}

	// Helper for Redis key namespacing
	static key(...parts: string[]): string {
		return `cb:${parts.join(":")}`;
	}
}

// Export singleton instance getter
export const getRedis = (options?: RedisOptions) => RedisConnection.getInstance(options);

// Export key helper
export const redisKey = RedisConnection.key;