import { getRedis, redisKey } from "./redis";

export interface Metrics {
	queueDepth: number;
	eventsProcessed: number;
	avgLatency: number;
	throughput: number;
	activeInstances: number;
	tasksPending: number;
	tasksCompleted: number;
	circuitBreakerTrips: number;
	hookValidations: number;
}

export class MetricsCollector {
	private redis = getRedis();
	private metricsInterval: NodeJS.Timeout | null = null;

	// Start collecting metrics periodically
	startCollection(intervalMs: number = 5000): void {
		if (this.metricsInterval) return;
		
		this.metricsInterval = setInterval(async () => {
			await this.collectMetrics();
		}, intervalMs);
	}

	// Stop metrics collection
	stopCollection(): void {
		if (this.metricsInterval) {
			clearInterval(this.metricsInterval);
			this.metricsInterval = null;
		}
	}

	// Collect all metrics
	private async collectMetrics(): Promise<void> {
		// Queue depth
		const queueKey = redisKey("queue", "tasks", "pending");
		const queueDepth = await this.redis.stream.zcard(queueKey);
		await this.setMetric("queue:depth", queueDepth);

		// Active instances
		const instancePattern = redisKey("instance", "*");
		const instanceKeys = await this.redis.stream.keys(instancePattern);
		await this.setMetric("instances:active", instanceKeys.length);

		// Tasks metrics
		const taskPattern = redisKey("task", "*");
		const taskKeys = await this.redis.stream.keys(taskPattern);
		let pending = 0, completed = 0;
		
		// Sample first 100 tasks for performance
		for (const key of taskKeys.slice(0, 100)) {
			const status = await this.redis.stream.hget(key, "status");
			if (status === "pending") pending++;
			else if (status === "completed") completed++;
		}
		
		await this.setMetric("tasks:pending", pending);
		await this.setMetric("tasks:completed", completed);
	}

	// Record event processing
	async recordEvent(eventType: string, duration: number): Promise<void> {
		const eventKey = redisKey("metrics", "events", eventType);
		
		// Increment counter
		await this.redis.stream.hincrby(eventKey, "count", 1);
		
		// Update latency (running average)
		const currentAvg = await this.redis.stream.hget(eventKey, "avgLatency");
		const count = await this.redis.stream.hget(eventKey, "count");
		const newAvg = currentAvg && count
			? (parseFloat(currentAvg) * (parseInt(count) - 1) + duration) / parseInt(count)
			: duration;
		
		await this.redis.stream.hset(eventKey, "avgLatency", newAvg.toString());
		await this.redis.stream.expire(eventKey, 3600);

		// Update global metrics
		await this.incrementMetric("events:total");
	}

	// Record task queue metrics
	async recordQueueMetrics(): Promise<void> {
		const globalQueueKey = redisKey("queue", "tasks", "pending");
		const depth = await this.redis.stream.zcard(globalQueueKey);
		
		await this.setMetric("queue:depth", depth);
		
		// Calculate throughput (tasks per minute)
		const completed = await this.getMetric("tasks:completed");
		const startTime = await this.getMetric("metrics:startTime");
		if (startTime) {
			const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes
			const throughput = completed / elapsed;
			await this.setMetric("queue:throughput", throughput);
		}
	}

	// Set a metric value
	private async setMetric(key: string, value: number): Promise<void> {
		const metricsKey = redisKey("metrics", "current");
		await this.redis.stream.hset(metricsKey, key, value.toString());
		await this.redis.stream.expire(metricsKey, 300); // 5 minute TTL
	}

	// Get a metric value
	private async getMetric(key: string): Promise<number> {
		const metricsKey = redisKey("metrics", "current");
		const value = await this.redis.stream.hget(metricsKey, key);
		return value ? parseFloat(value) : 0;
	}

	// Increment a counter metric
	private async incrementMetric(key: string, by: number = 1): Promise<void> {
		const metricsKey = redisKey("metrics", "current");
		await this.redis.stream.hincrby(metricsKey, key, by);
		await this.redis.stream.expire(metricsKey, 300);
	}

	// Get all current metrics
	async getMetrics(): Promise<Partial<Metrics>> {
		const metricsKey = redisKey("metrics", "current");
		const raw = await this.redis.stream.hgetall(metricsKey);
		
		return {
			queueDepth: parseInt(raw["queue:depth"] || "0"),
			eventsProcessed: parseInt(raw["events:total"] || "0"),
			avgLatency: parseFloat(raw["events:avgLatency"] || "0"),
			throughput: parseFloat(raw["queue:throughput"] || "0"),
			activeInstances: parseInt(raw["instances:active"] || "0"),
			tasksPending: parseInt(raw["tasks:pending"] || "0"),
			tasksCompleted: parseInt(raw["tasks:completed"] || "0"),
			circuitBreakerTrips: parseInt(raw["circuit:trips"] || "0"),
			hookValidations: parseInt(raw["hooks:total"] || "0"),
		};
	}

	// Track rate limiting
	async trackRateLimit(key: string, window: number = 60): Promise<number> {
		const rateKey = redisKey("rate", key);
		const now = Date.now();
		
		// Add current request
		await this.redis.stream.zadd(rateKey, now, now.toString());
		
		// Remove old entries outside window
		await this.redis.stream.zremrangebyscore(rateKey, 0, now - window * 1000);
		
		// Count requests in window
		const count = await this.redis.stream.zcard(rateKey);
		
		// Set TTL
		await this.redis.stream.expire(rateKey, window);
		
		return count;
	}

	// Calculate percentiles for latency
	async getLatencyPercentiles(eventType: string): Promise<{ p50: number; p95: number; p99: number }> {
		const latencyKey = redisKey("metrics", "latency", eventType);
		const latencies = await this.redis.stream.zrange(latencyKey, 0, -1, "WITHSCORES");
		
		if (latencies.length === 0) {
			return { p50: 0, p95: 0, p99: 0 };
		}
		
		// Extract scores (latencies) from the result
		const values: number[] = [];
		for (let i = 1; i < latencies.length; i += 2) {
			values.push(parseFloat(latencies[i]));
		}
		
		values.sort((a, b) => a - b);
		
		const p50Index = Math.floor(values.length * 0.5);
		const p95Index = Math.floor(values.length * 0.95);
		const p99Index = Math.floor(values.length * 0.99);
		
		return {
			p50: values[p50Index] || 0,
			p95: values[p95Index] || 0,
			p99: values[p99Index] || 0,
		};
	}

	// Initialize metrics on startup
	async initialize(): Promise<void> {
		const metricsKey = redisKey("metrics", "current");
		await this.redis.stream.hset(metricsKey, "metrics:startTime", Date.now().toString());
		await this.redis.stream.expire(metricsKey, 300);
	}
}

export const metrics = new MetricsCollector();