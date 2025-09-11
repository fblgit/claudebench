import type { Context, Next } from "hono";
import { register, Counter, Histogram, Gauge, Registry } from "prom-client";

// Create a dedicated registry for ClaudeBench
export const metricsRegistry = new Registry();

// Collect default metrics (CPU, memory, GC, etc.)
import { collectDefaultMetrics } from "prom-client";
collectDefaultMetrics({ 
	register: metricsRegistry,
	prefix: "claudebench_"
});

// HTTP metrics
const httpRequestDuration = new Histogram({
	name: "claudebench_http_request_duration_seconds",
	help: "Duration of HTTP requests in seconds",
	labelNames: ["method", "route", "status_code"],
	buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
	registers: [metricsRegistry],
});

const httpRequestTotal = new Counter({
	name: "claudebench_http_requests_total",
	help: "Total number of HTTP requests",
	labelNames: ["method", "route", "status_code"],
	registers: [metricsRegistry],
});

const httpRequestsInFlight = new Gauge({
	name: "claudebench_http_requests_in_flight",
	help: "Number of HTTP requests currently being processed",
	labelNames: ["method", "route"],
	registers: [metricsRegistry],
});

// JSONRPC metrics
const jsonrpcRequestDuration = new Histogram({
	name: "claudebench_jsonrpc_request_duration_seconds",
	help: "Duration of JSONRPC requests in seconds",
	labelNames: ["method", "status"],
	buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
	registers: [metricsRegistry],
});

const jsonrpcRequestTotal = new Counter({
	name: "claudebench_jsonrpc_requests_total",
	help: "Total number of JSONRPC requests",
	labelNames: ["method", "status"],
	registers: [metricsRegistry],
});

// Event metrics
const eventProcessed = new Counter({
	name: "claudebench_events_processed_total",
	help: "Total number of events processed",
	labelNames: ["event_type", "handler", "status"],
	registers: [metricsRegistry],
});

const eventProcessingDuration = new Histogram({
	name: "claudebench_event_processing_duration_seconds",
	help: "Duration of event processing in seconds",
	labelNames: ["event_type", "handler"],
	buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
	registers: [metricsRegistry],
});

// Task queue metrics
export const taskQueueDepth = new Gauge({
	name: "claudebench_task_queue_depth",
	help: "Current depth of task queues",
	labelNames: ["queue", "instance"],
	registers: [metricsRegistry],
});

export const tasksInProgress = new Gauge({
	name: "claudebench_tasks_in_progress",
	help: "Number of tasks currently being processed",
	labelNames: ["instance", "priority"],
	registers: [metricsRegistry],
});

// Instance metrics
export const instancesActive = new Gauge({
	name: "claudebench_instances_active",
	help: "Number of active instances",
	labelNames: ["role"],
	registers: [metricsRegistry],
});

export const instanceHealth = new Gauge({
	name: "claudebench_instance_health_score",
	help: "Instance health score (0-1)",
	labelNames: ["instance_id", "role"],
	registers: [metricsRegistry],
});

// Circuit breaker metrics
export const circuitBreakerState = new Gauge({
	name: "claudebench_circuit_breaker_state",
	help: "Circuit breaker state (0=closed, 0.5=half-open, 1=open)",
	labelNames: ["handler"],
	registers: [metricsRegistry],
});

export const circuitBreakerFailures = new Counter({
	name: "claudebench_circuit_breaker_failures_total",
	help: "Total circuit breaker failures",
	labelNames: ["handler", "error_type"],
	registers: [metricsRegistry],
});

// Redis metrics
export const redisOperations = new Counter({
	name: "claudebench_redis_operations_total",
	help: "Total Redis operations",
	labelNames: ["operation", "status"],
	registers: [metricsRegistry],
});

export const redisOperationDuration = new Histogram({
	name: "claudebench_redis_operation_duration_seconds",
	help: "Redis operation duration",
	labelNames: ["operation"],
	buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
	registers: [metricsRegistry],
});

// Hono middleware for HTTP metrics
export function prometheusMiddleware() {
	return async (c: Context, next: Next) => {
		const start = Date.now();
		const route = c.req.path;
		const method = c.req.method;
		
		// Track in-flight requests
		httpRequestsInFlight.inc({ method, route });
		
		try {
			await next();
		} finally {
			const duration = (Date.now() - start) / 1000;
			const status = c.res.status.toString();
			
			// Record metrics
			httpRequestDuration.observe({ method, route, status_code: status }, duration);
			httpRequestTotal.inc({ method, route, status_code: status });
			httpRequestsInFlight.dec({ method, route });
		}
	};
}

// Helper to record JSONRPC metrics
export function recordJsonRpcRequest(method: string, duration: number, success: boolean) {
	const status = success ? "success" : "error";
	jsonrpcRequestDuration.observe({ method, status }, duration / 1000);
	jsonrpcRequestTotal.inc({ method, status });
}

// Helper to record event processing
export function recordEventProcessing(
	eventType: string,
	handler: string,
	duration: number,
	success: boolean
) {
	const status = success ? "success" : "failure";
	eventProcessed.inc({ event_type: eventType, handler, status });
	eventProcessingDuration.observe({ event_type: eventType, handler }, duration / 1000);
}

// Helper to update circuit breaker state
export function updateCircuitBreaker(handler: string, state: "closed" | "open" | "half-open") {
	const value = state === "closed" ? 0 : state === "half-open" ? 0.5 : 1;
	circuitBreakerState.set({ handler }, value);
}

// Helper to track Redis operations
export function recordRedisOperation(operation: string, duration: number, success: boolean) {
	const status = success ? "success" : "failure";
	redisOperations.inc({ operation, status });
	redisOperationDuration.observe({ operation }, duration / 1000);
}

// Get metrics in Prometheus format
export async function getMetrics(): Promise<string> {
	return metricsRegistry.metrics();
}

// Get metrics as JSON (useful for internal use)
export async function getMetricsJson() {
	const metrics = await metricsRegistry.getMetricsAsJSON();
	return metrics;
}