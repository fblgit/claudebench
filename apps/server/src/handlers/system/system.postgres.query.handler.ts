import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemPostgresQueryInput, systemPostgresQueryOutput } from "@/schemas/system.schema";
import type { SystemPostgresQueryInput, SystemPostgresQueryOutput } from "@/schemas/system.schema";

@EventHandler({
	event: "system.postgres.query",
	inputSchema: systemPostgresQueryInput,
	outputSchema: systemPostgresQueryOutput,
	persist: false,
	rateLimit: 50, // Moderate rate limit for database queries
	description: "Query PostgreSQL table data with filtering and pagination",
})
export class SystemPostgresQueryHandler {
	@Instrumented(60) // Cache for 1 minute for identical queries
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 requests per minute
		timeout: 20000, // 20 second timeout for complex queries
		circuitBreaker: { 
			threshold: 5, 
			timeout: 60000,
			fallback: () => ({ 
				table: "",
				schema: "public",
				columns: [],
				rows: [],
				totalRows: 0,
				hasMore: false,
				executionTime: 0,
				queryInfo: {
					sql: "",
					parameters: []
				}
			})
		}
	})
	async handle(input: SystemPostgresQueryInput, ctx: EventContext): Promise<SystemPostgresQueryOutput> {
		const { table, schema, columns, where, orderBy, limit, offset, format } = input;
		
		try {
			const startTime = Date.now();
			
			// Validate table exists and get column information
			const tableExistsQuery = `
				SELECT column_name, data_type 
				FROM information_schema.columns 
				WHERE table_name = $1 AND table_schema = $2
				ORDER BY ordinal_position
			`;
			
			const tableColumns = await ctx.prisma.$queryRawUnsafe<any[]>(
				tableExistsQuery, 
				table, 
				schema
			);
			
			if (tableColumns.length === 0) {
				throw new Error(`Table "${schema}"."${table}" not found or has no accessible columns`);
			}
			
			// Build the SELECT clause
			const selectColumns = columns && columns.length > 0 
				? columns.map(col => this.sanitizeColumnName(col)).join(', ')
				: '*';
			
			// Build the main query
			const queryParts = [`SELECT ${selectColumns}`];
			queryParts.push(`FROM "${schema}"."${table}"`);
			
			const parameters: any[] = [];
			let paramIndex = 1;
			
			// Add WHERE clause if provided
			if (where && where.trim()) {
				// Basic SQL injection protection - only allow safe characters
				if (this.containsSuspiciousSql(where)) {
					throw new Error("WHERE clause contains potentially dangerous SQL constructs");
				}
				queryParts.push(`WHERE ${where}`);
			}
			
			// Add ORDER BY clause if provided
			if (orderBy && orderBy.trim()) {
				if (this.containsSuspiciousSql(orderBy)) {
					throw new Error("ORDER BY clause contains potentially dangerous SQL constructs");
				}
				queryParts.push(`ORDER BY ${orderBy}`);
			}
			
			// Add LIMIT and OFFSET
			queryParts.push(`LIMIT ${limit} OFFSET ${offset}`);
			
			const finalQuery = queryParts.join(' ');
			
			// Execute the query
			const rows = await ctx.prisma.$queryRawUnsafe<any[]>(finalQuery);
			
			const executionTime = Date.now() - startTime;
			
			// Get total count for pagination info (if no WHERE clause, use table statistics)
			let totalCount = 0;
			if (!where) {
				// Use approximate count from statistics for better performance
				try {
					const statsQuery = `
						SELECT reltuples::bigint as estimate
						FROM pg_class c
						JOIN pg_namespace n ON n.oid = c.relnamespace
						WHERE n.nspname = $1 AND c.relname = $2
					`;
					const countResult = await ctx.prisma.$queryRawUnsafe<any[]>(statsQuery, schema, table);
					totalCount = countResult[0]?.estimate || rows.length;
				} catch {
					totalCount = rows.length;
				}
			} else {
				// For WHERE queries, we'd need to run a COUNT query, but skip for performance
				totalCount = rows.length;
			}
			
			// Format rows based on requested format
			const formattedRows = format === "pretty" 
				? rows.map(row => this.formatRowData(row))
				: rows;
			
			// Get column metadata for the result
			const resultColumns = columns && columns.length > 0 
				? tableColumns.filter(col => columns.includes(col.column_name))
				: tableColumns;
			
			await ctx.publish({
				type: "system.postgres.query.executed",
				payload: {
					table,
					schema,
					rowsReturned: rows.length,
					executionTime,
					hasWhere: Boolean(where),
				},
			});
			
			return {
				table,
				schema,
				columns: resultColumns.map(col => ({
					name: col.column_name,
					type: col.data_type,
				})),
				rows: formattedRows,
				totalRows: formattedRows.length,
				hasMore: rows.length === limit, // Rough estimate
				executionTime,
				queryInfo: {
					sql: finalQuery,
					parameters,
				},
			};
		} catch (error: any) {
			console.error(`PostgreSQL query failed for table "${schema}"."${table}":`, error?.message || error);
			
			await ctx.publish({
				type: "system.postgres.query.error",
				payload: {
					table,
					schema,
					error: error?.message || "Unknown database error",
				},
			});
			
			throw new Error(`Failed to query PostgreSQL table: ${error?.message || "Unknown error"}`);
		}
	}
	
	private sanitizeColumnName(columnName: string): string {
		// Only allow alphanumeric, underscore, and dot characters
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
			throw new Error(`Invalid column name: ${columnName}`);
		}
		return `"${columnName}"`;
	}
	
	private containsSuspiciousSql(input: string): boolean {
		const suspiciousPatterns = [
			/\b(DROP|DELETE|UPDATE|INSERT|CREATE|ALTER|TRUNCATE)\b/i,
			/;.*?--/,
			/\/\*.*?\*\//,
			/\bUNION\b/i,
			/\bEXEC\b/i,
			/\bxp_\w+/i,
			/\bsp_\w+/i,
		];
		
		return suspiciousPatterns.some(pattern => pattern.test(input));
	}
	
	private formatRowData(row: Record<string, any>): Record<string, any> {
		const formatted: Record<string, any> = {};
		
		for (const [key, value] of Object.entries(row)) {
			if (value === null) {
				formatted[key] = null;
			} else if (value instanceof Date) {
				formatted[key] = value.toISOString();
			} else if (typeof value === 'object' && value !== null) {
				try {
					// If it's already an object, keep it as is
					formatted[key] = value;
				} catch {
					formatted[key] = String(value);
				}
			} else {
				formatted[key] = value;
			}
		}
		
		return formatted;
	}
}