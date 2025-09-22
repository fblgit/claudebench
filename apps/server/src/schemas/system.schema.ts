import { z } from "zod";

export const InstanceStatus = z.enum(["ACTIVE", "IDLE", "BUSY", "OFFLINE"]);

// system.health - Aligned with JSONRPC contract
export const systemHealthInput = z.object({});

export const systemHealthOutput = z.object({
	status: z.enum(["healthy", "degraded", "unhealthy"]),
	services: z.object({
		redis: z.boolean(),
		postgres: z.boolean(),
		mcp: z.boolean(),
	}),
});

// system.register - Aligned with JSONRPC contract
export const systemRegisterInput = z.object({
	id: z.string().min(1),
	roles: z.array(z.string()),
	metadata: z.object({
		workingDirectory: z.string().optional(),
	}).optional(),
});

export const systemRegisterOutput = z.object({
	registered: z.boolean(),
});

// system.heartbeat - Aligned with JSONRPC contract
export const systemHeartbeatInput = z.object({
	instanceId: z.string().min(1),
});

export const systemHeartbeatOutput = z.object({
	alive: z.boolean(),
});

// system.get_state - Aligned with JSONRPC contract
export const systemGetStateInput = z.object({});

export const systemGetStateOutput = z.object({
	tasks: z.array(z.any()).optional(),
	instances: z.array(z.any()).optional(),
	recentEvents: z.array(z.any()).optional(),
});

// system.metrics - Aligned with JSONRPC contract
export const systemMetricsInput = z.object({
	detailed: z.boolean().optional(), // Request detailed metrics
});

export const systemMetricsOutput = z.object({
	eventsProcessed: z.number().optional(),
	tasksCompleted: z.number().optional(),
	averageLatency: z.number().optional(),
	memoryUsage: z.number().optional(),
	// Extended metrics (when detailed=true)
	circuitBreaker: z.object({
		totalSuccesses: z.number(),
		totalFailures: z.number(),
		totalTrips: z.number(),
		successRate: z.number(),
	}).optional(),
	queue: z.object({
		depth: z.number(),
		pending: z.number(),
		throughput: z.number(),
	}).optional(),
	cache: z.object({
		hits: z.number(),
		misses: z.number(),
		sets: z.number(),
		hitRate: z.number().optional(),
	}).optional(),
	counters: z.object({
		circuit: z.record(z.string(), z.number()).optional(),
		ratelimit: z.record(z.string(), z.number()).optional(),
		timeout: z.record(z.string(), z.number()).optional(),
	}).optional(),
	global: z.object({
		taskSuccess: z.number().optional(),
		taskFailure: z.number().optional(),
		systemSuccess: z.number().optional(),
		totalEvents: z.number().optional(),
		totalTasks: z.number().optional(),
		avgLatency: z.number().optional(),
		throughput: z.number().optional(),
	}).optional(),
	scaling: z.object({
		instanceCount: z.number().optional(),
		loadBalance: z.number().optional(),
		totalLoad: z.number().optional(),
	}).optional(),
	current: z.object({
		eventsTotal: z.number().optional(),
		queueDepth: z.number().optional(),
		instancesActive: z.number().optional(),
		tasksPending: z.number().optional(),
		tasksCompleted: z.number().optional(),
		metricsStartTime: z.number().optional(),
	}).optional(),
	mcpCalls: z.number().optional(),
	systemHealthCheck: z.object({
		lastCheck: z.number().optional(),
	}).optional(),
	handlers: z.record(z.string(), z.object({
		totalCalls: z.number(),
		successCount: z.number(),
		errorCount: z.number(),
		avgResponseTime: z.number(),
		circuitState: z.string(),
		rateLimitHits: z.number().optional(),
		cacheHitRate: z.number().optional(),
		lastCalled: z.string().optional(),
	})).optional(),
});

// system.discover - Expose registered handlers and their schemas
export const systemDiscoverInput = z.object({
	domain: z.string().optional(), // Optional filter by domain (e.g., "task", "system", "hook")
});

export const systemDiscoverOutput = z.object({
	methods: z.array(z.object({
		name: z.string(), // Event name (e.g., "task.create")
		description: z.string().optional(),
		inputSchema: z.any().optional(), // The Zod schema as JSON
		outputSchema: z.any().optional(), // The Zod schema as JSON
		metadata: z.object({
			persist: z.boolean().optional(),
			rateLimit: z.number().optional(),
			roles: z.array(z.string()).optional(),
		}).optional(),
	})),
});

export type SystemHealthInput = z.infer<typeof systemHealthInput>;
export type SystemHealthOutput = z.infer<typeof systemHealthOutput>;
export type SystemRegisterInput = z.infer<typeof systemRegisterInput>;
export type SystemRegisterOutput = z.infer<typeof systemRegisterOutput>;
export type SystemHeartbeatInput = z.infer<typeof systemHeartbeatInput>;
export type SystemHeartbeatOutput = z.infer<typeof systemHeartbeatOutput>;
export type SystemGetStateInput = z.infer<typeof systemGetStateInput>;
export type SystemGetStateOutput = z.infer<typeof systemGetStateOutput>;
export type SystemMetricsInput = z.infer<typeof systemMetricsInput>;
export type SystemMetricsOutput = z.infer<typeof systemMetricsOutput>;
export type SystemDiscoverInput = z.infer<typeof systemDiscoverInput>;
export type SystemDiscoverOutput = z.infer<typeof systemDiscoverOutput>;

// system.unregister - Clean up instance registration on session end
// NOTE: This stays in system domain as it's about ClaudeBench instance management
export const systemUnregisterInput = z.object({
	instanceId: z.string().min(1),
	sessionId: z.string().min(1),
	timestamp: z.number(),
});

export const systemUnregisterOutput = z.object({
	unregistered: z.boolean(),
	tasksReassigned: z.number().optional(),
});

export type SystemUnregisterInput = z.infer<typeof systemUnregisterInput>;
export type SystemUnregisterOutput = z.infer<typeof systemUnregisterOutput>;

// system.redis.keys - Redis key scanning for troubleshooting
export const systemRedisKeysInput = z.object({
	pattern: z.string().default("*").describe("Redis key pattern to search (e.g., 'cb:task:*', '*')"),
	cursor: z.number().default(0).describe("SCAN cursor for pagination"),
	count: z.number().min(1).max(1000).default(100).describe("Maximum number of keys to return"),
});

export const systemRedisKeysOutput = z.object({
	keys: z.array(z.string()).describe("Array of matching Redis keys"),
	cursor: z.number().describe("Next cursor for pagination (0 if done)"),
	pattern: z.string().describe("The pattern that was searched"),
	total: z.number().optional().describe("Total number of matching keys if available"),
	keysByType: z.record(z.number()).optional().describe("Count of keys by Redis data type"),
});

export type SystemRedisKeysInput = z.infer<typeof systemRedisKeysInput>;
export type SystemRedisKeysOutput = z.infer<typeof systemRedisKeysOutput>;

// system.redis.get - Redis key inspection for troubleshooting
export const systemRedisGetInput = z.object({
	key: z.string().min(1).describe("Redis key to inspect"),
	format: z.enum(["raw", "json", "pretty"]).default("pretty").describe("Output format for the data"),
	limit: z.number().min(1).max(1000).default(100).describe("Limit for list/set/hash elements"),
});

export const systemRedisGetOutput = z.object({
	key: z.string().describe("The Redis key that was inspected"),
	exists: z.boolean().describe("Whether the key exists in Redis"),
	type: z.string().describe("Redis data type (string, hash, list, set, zset, stream)"),
	ttl: z.number().describe("Time to live in seconds (-1 if no expiration, -2 if key doesn't exist)"),
	size: z.number().describe("Size/length of the data structure"),
	data: z.any().describe("The actual data content, formatted according to type"),
	metadata: z.object({
		encoding: z.string().optional().describe("Redis internal encoding"),
		memory: z.number().optional().describe("Memory usage in bytes"),
		lastModified: z.string().optional().describe("Last modification time if available"),
	}).optional().describe("Additional metadata about the key"),
});

export type SystemRedisGetInput = z.infer<typeof systemRedisGetInput>;
export type SystemRedisGetOutput = z.infer<typeof systemRedisGetOutput>;

// system.postgres.tables - PostgreSQL table listing for troubleshooting
export const systemPostgresTablesInput = z.object({
	schema: z.string().default("public").describe("Database schema to list tables from"),
	includeViews: z.boolean().default(false).describe("Include views in the table listing"),
	includeSystemTables: z.boolean().default(false).describe("Include system tables"),
});

export const systemPostgresTablesOutput = z.object({
	tables: z.array(z.object({
		name: z.string().describe("Table name"),
		schema: z.string().describe("Schema name"),
		type: z.enum(["table", "view", "materialized_view"]).describe("Table type"),
		rowCount: z.number().optional().describe("Approximate row count"),
		sizeBytes: z.number().optional().describe("Table size in bytes"),
		columns: z.array(z.object({
			name: z.string().describe("Column name"),
			type: z.string().describe("PostgreSQL data type"),
			nullable: z.boolean().describe("Whether column allows NULL"),
			defaultValue: z.string().nullable().describe("Default value if any"),
			isPrimaryKey: z.boolean().describe("Whether column is part of primary key"),
		})).describe("Table columns information"),
		indexes: z.array(z.object({
			name: z.string().describe("Index name"),
			columns: z.array(z.string()).describe("Indexed columns"),
			unique: z.boolean().describe("Whether index is unique"),
			primary: z.boolean().describe("Whether index is primary key"),
		})).optional().describe("Table indexes"),
		constraints: z.array(z.object({
			name: z.string().describe("Constraint name"),
			type: z.string().describe("Constraint type (PRIMARY KEY, FOREIGN KEY, etc.)"),
			definition: z.string().describe("Constraint definition"),
		})).optional().describe("Table constraints"),
	})).describe("Array of table information"),
	schema: z.string().describe("The schema that was queried"),
	totalTables: z.number().describe("Total number of tables found"),
});

export type SystemPostgresTablesInput = z.infer<typeof systemPostgresTablesInput>;
export type SystemPostgresTablesOutput = z.infer<typeof systemPostgresTablesOutput>;

// system.postgres.query - PostgreSQL table data querying for troubleshooting
export const systemPostgresQueryInput = z.object({
	table: z.string().min(1).describe("Table name to query"),
	schema: z.string().default("public").describe("Database schema"),
	columns: z.array(z.string()).optional().describe("Specific columns to select (default: all)"),
	where: z.string().optional().describe("WHERE clause conditions (without WHERE keyword)"),
	orderBy: z.string().optional().describe("ORDER BY clause (without ORDER BY keyword)"),
	limit: z.number().min(1).max(1000).default(100).describe("Maximum number of rows to return"),
	offset: z.number().min(0).default(0).describe("Number of rows to skip for pagination"),
	format: z.enum(["raw", "pretty"]).default("pretty").describe("Output format for the data"),
});

export const systemPostgresQueryOutput = z.object({
	table: z.string().describe("The table that was queried"),
	schema: z.string().describe("The schema that was queried"),
	columns: z.array(z.object({
		name: z.string().describe("Column name"),
		type: z.string().describe("PostgreSQL data type"),
	})).describe("Column information for the result set"),
	rows: z.array(z.record(z.any())).describe("Query result rows"),
	totalRows: z.number().describe("Total number of rows returned"),
	hasMore: z.boolean().describe("Whether there are more rows available"),
	executionTime: z.number().describe("Query execution time in milliseconds"),
	queryInfo: z.object({
		sql: z.string().describe("The actual SQL query that was executed"),
		parameters: z.array(z.any()).describe("Query parameters that were used"),
	}).describe("Information about the executed query"),
});

export type SystemPostgresQueryInput = z.infer<typeof systemPostgresQueryInput>;
export type SystemPostgresQueryOutput = z.infer<typeof systemPostgresQueryOutput>;