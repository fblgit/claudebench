import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const configSchema = z.object({
	// Database
	database: z.object({
		url: z.string().url().default("postgresql://postgres:password@localhost:5432/claudebench"),
	}),

	// Redis
	redis: z.object({
		host: z.string().default("localhost"),
		port: z.coerce.number().default(6379),
	}),

	// Server
	server: z.object({
		port: z.coerce.number().default(3000),
		corsOrigin: z.string().default("http://localhost:3001"),
		nodeEnv: z.enum(["development", "production", "test"]).default("development"),
	}),

	// Instance
	instance: z.object({
		id: z.string().default(`worker-${Date.now()}`),
		role: z.string().default("worker"),
	}),

	// Rate Limiting
	rateLimit: z.object({
		windowMs: z.coerce.number().default(1000), // 1 second window
		maxRequests: z.coerce.number().default(100), // 100 requests per window
	}),

	// Circuit Breaker
	circuitBreaker: z.object({
		threshold: z.coerce.number().default(5), // 5 failures to open
		timeout: z.coerce.number().default(30000), // 30 seconds to half-open
		resetTimeout: z.coerce.number().default(60000), // 60 seconds to fully reset
	}),
});

export type Config = z.infer<typeof configSchema>;

const rawConfig = {
	database: {
		url: process.env.DATABASE_URL,
	},
	redis: {
		host: process.env.REDIS_HOST,
		port: process.env.REDIS_PORT,
	},
	server: {
		port: process.env.PORT,
		corsOrigin: process.env.CORS_ORIGIN,
		nodeEnv: process.env.NODE_ENV,
	},
	instance: {
		id: process.env.INSTANCE_ID,
		role: process.env.INSTANCE_ROLE,
	},
	rateLimit: {
		windowMs: process.env.RATE_LIMIT_WINDOW_MS,
		maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS,
	},
	circuitBreaker: {
		threshold: process.env.CIRCUIT_BREAKER_THRESHOLD,
		timeout: process.env.CIRCUIT_BREAKER_TIMEOUT,
		resetTimeout: process.env.CIRCUIT_BREAKER_RESET_TIMEOUT,
	},
};

// Validate and export config
export const config = configSchema.parse(rawConfig);

// Export individual sections for convenience
export const { database, redis, server, instance, rateLimit, circuitBreaker } = config;