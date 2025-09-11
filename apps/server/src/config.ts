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

	// Hook Validation Rules - Compact regex-based configuration
	hookValidation: z.object({
		// Rule groups with regex patterns
		ruleGroups: z.array(z.object({
			name: z.string(),
			tools: z.array(z.string()), // Tool patterns this group applies to
			severity: z.enum(["critical", "high", "medium", "low"]),
			action: z.enum(["block", "warn", "modify"]),
			patterns: z.array(z.object({
				regex: z.string(), // Regex pattern
				message: z.string(), // Message template with {{match}} placeholder
				replacement: z.string().optional(), // For modify actions
			})),
		})).default([
			{
				name: "dangerous_operations",
				tools: ["bash", "shell", "command", "Bash"],
				severity: "critical",
				action: "block",
				patterns: [
					{ regex: "rm\\s+-[rf]{2}", message: "dangerous command pattern detected: {{match}}" },
					{ regex: "sudo\\s+(rm|del)", message: "dangerous command pattern detected: {{match}}" },
					{ regex: "(drop|truncate)\\s+(database|table|schema)", message: "dangerous command pattern detected: {{match}}" },
					{ regex: "format\\s+[cd]:", message: "dangerous command pattern detected: {{match}}" },
					{ regex: "del\\s+/[fs]", message: "dangerous command pattern detected: {{match}}" },
				],
			},
			{
				name: "system_protection",
				tools: ["write", "Write", "file.write", "file.delete"],
				severity: "high",
				action: "block",
				patterns: [
					{ regex: "/(etc|sys|boot|proc|dev)/", message: "Cannot modify system directory: {{match}}" },
					{ regex: "C:\\\\(Windows|System32|System)\\\\", message: "Cannot modify system directory: {{match}}" },
				],
			},
			{
				name: "privilege_stripping",
				tools: ["bash", "shell", "command"],
				severity: "low",
				action: "modify",
				patterns: [
					{ regex: "^sudo\\s+", message: "sudo removed", replacement: "" },
				],
			},
			{
				name: "performance_warnings",
				tools: ["bash", "shell"],
				severity: "medium",
				action: "warn",
				patterns: [
					{ regex: "(very-)?large-file", message: "Warning: Large file operation" },
					{ regex: "find\\s+/\\s+-", message: "Warning: Filesystem-wide operation" },
				],
			},
		]),
		
		// Safe patterns whitelist (bypass all validation)
		safePatterns: z.array(z.string()).default([
			"^(ls|pwd|echo|whoami|date|uptime)(\\s|$)",
			"^cat\\s+[^>]+$",  // cat without output redirection
			"^grep\\s+[^>]+$", // grep without output redirection
		]),
		
		// Severity configuration
		severityConfig: z.object({
			priority: z.object({
				critical: z.number().default(10),
				high: z.number().default(20),
				medium: z.number().default(30),
				low: z.number().default(40),
			}).default({ critical: 10, high: 20, medium: 30, low: 40 }),
			// How many ms to cache validation results per severity
			cacheTTL: z.object({
				critical: z.number().default(60000), // 1 minute
				high: z.number().default(120000),    // 2 minutes
				medium: z.number().default(300000),  // 5 minutes
				low: z.number().default(600000),     // 10 minutes
			}).default({ critical: 60000, high: 120000, medium: 300000, low: 600000 }),
		}).default({ 
			priority: { critical: 10, high: 20, medium: 30, low: 40 },
			cacheTTL: { critical: 60000, high: 120000, medium: 300000, low: 600000 }
		}),
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
	hookValidation: {
		// Can be overridden by environment variables or external config
		ruleGroups: process.env.HOOK_VALIDATION_RULES ? JSON.parse(process.env.HOOK_VALIDATION_RULES) : undefined,
		safePatterns: process.env.HOOK_SAFE_PATTERNS ? JSON.parse(process.env.HOOK_SAFE_PATTERNS) : undefined,
		severityConfig: process.env.HOOK_SEVERITY_CONFIG ? JSON.parse(process.env.HOOK_SEVERITY_CONFIG) : undefined,
	},
};

// Validate and export config
export const config = configSchema.parse(rawConfig);

// Export individual sections for convenience
export const { database, redis, server, instance, rateLimit, circuitBreaker, hookValidation } = config;