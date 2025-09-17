import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemPostgresTablesInput, systemPostgresTablesOutput } from "@/schemas/system.schema";
import type { SystemPostgresTablesInput, SystemPostgresTablesOutput } from "@/schemas/system.schema";

@EventHandler({
	event: "system.postgres.tables",
	inputSchema: systemPostgresTablesInput,
	outputSchema: systemPostgresTablesOutput,
	persist: false,
	rateLimit: 30, // Lower rate limit for potentially expensive database operations
	description: "List PostgreSQL tables with metadata for troubleshooting",
	mcp: {
		visible: false, // Admin debugging tool, not for Claude to use
	}
})
export class SystemPostgresTablesHandler {
	@Instrumented(120) // Cache for 2 minutes (table structure doesn't change often)
	@Resilient({
		rateLimit: { limit: 30, windowMs: 60000 }, // 30 requests per minute
		timeout: 15000, // 15 second timeout for database operations
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000, // Longer timeout for DB issues
			fallback: () => ({ 
				tables: [],
				schema: "public",
				totalTables: 0
			})
		}
	})
	async handle(input: SystemPostgresTablesInput, ctx: EventContext): Promise<SystemPostgresTablesOutput> {
		const { schema, includeViews, includeSystemTables } = input;
		
		try {
			// Build the query to get table information
			let tableTypeFilter = "'BASE TABLE'";
			if (includeViews) {
				tableTypeFilter += ", 'VIEW', 'MATERIALIZED VIEW'";
			}
			
			let schemaFilter = "table_schema = $1";
			if (includeSystemTables) {
				schemaFilter += " OR table_schema = 'information_schema' OR table_schema = 'pg_catalog'";
			}
			
			// Get basic table information
			const tablesQuery = `
				SELECT 
					t.table_name,
					t.table_schema,
					t.table_type,
					pg_total_relation_size(quote_ident(t.table_schema)||'.'||quote_ident(t.table_name)) as size_bytes,
					(SELECT reltuples::bigint AS row_count
					 FROM pg_class c
					 JOIN pg_namespace n ON n.oid = c.relnamespace
					 WHERE n.nspname = t.table_schema AND c.relname = t.table_name) as row_count
				FROM information_schema.tables t
				WHERE table_type IN (${tableTypeFilter})
				  AND (${schemaFilter})
				ORDER BY t.table_schema, t.table_name
			`;
			
			const tablesResult = await ctx.prisma.$queryRawUnsafe<any[]>(tablesQuery, schema);
			
			// Get column information for each table
			const tables = await Promise.all(tablesResult.map(async (table) => {
				// Get columns
				const columnsQuery = `
					SELECT 
						c.column_name,
						c.data_type,
						c.is_nullable,
						c.column_default,
						CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
					FROM information_schema.columns c
					LEFT JOIN (
						SELECT ku.column_name
						FROM information_schema.table_constraints tc
						JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
						WHERE tc.constraint_type = 'PRIMARY KEY'
						  AND tc.table_name = $1
						  AND tc.table_schema = $2
					) pk ON pk.column_name = c.column_name
					WHERE c.table_name = $1 AND c.table_schema = $2
					ORDER BY c.ordinal_position
				`;
				
				const columns = await ctx.prisma.$queryRawUnsafe<any[]>(
					columnsQuery, 
					table.table_name, 
					table.table_schema
				);
				
				// Get indexes
				const indexesQuery = `
					SELECT 
						i.indexname as name,
						i.indexdef as definition,
						i.indexdef LIKE '%UNIQUE%' as unique,
						i.indexdef LIKE '%PRIMARY KEY%' as primary
					FROM pg_indexes i
					WHERE i.tablename = $1 AND i.schemaname = $2
				`;
				
				const indexes = await ctx.prisma.$queryRawUnsafe<any[]>(
					indexesQuery, 
					table.table_name, 
					table.table_schema
				);
				
				// Parse index columns from definition (simplified)
				const parsedIndexes = indexes.map(idx => {
					// Extract column names from index definition (basic parsing)
					const match = idx.definition.match(/\(([^)]+)\)/);
					const columns = match ? match[1].split(',').map((col: string) => col.trim()) : [];
					
					return {
						name: idx.name,
						columns,
						unique: Boolean(idx.unique),
						primary: Boolean(idx.primary),
					};
				});
				
				// Get constraints
				const constraintsQuery = `
					SELECT 
						tc.constraint_name as name,
						tc.constraint_type as type,
						pg_get_constraintdef(pgc.oid) as definition
					FROM information_schema.table_constraints tc
					JOIN pg_constraint pgc ON pgc.conname = tc.constraint_name
					WHERE tc.table_name = $1 AND tc.table_schema = $2
				`;
				
				const constraints = await ctx.prisma.$queryRawUnsafe<any[]>(
					constraintsQuery, 
					table.table_name, 
					table.table_schema
				);
				
				return {
					name: table.table_name,
					schema: table.table_schema,
					type: this.mapTableType(table.table_type),
					rowCount: table.row_count ? parseInt(table.row_count) : 0,
					sizeBytes: table.size_bytes ? parseInt(table.size_bytes) : 0,
					columns: columns.map(col => ({
						name: col.column_name,
						type: col.data_type,
						nullable: col.is_nullable === 'YES',
						defaultValue: col.column_default,
						isPrimaryKey: col.is_primary_key,
					})),
					indexes: parsedIndexes.length > 0 ? parsedIndexes : undefined,
					constraints: constraints.length > 0 ? constraints.map(c => ({
						name: c.name,
						type: c.type,
						definition: c.definition,
					})) : undefined,
				};
			}));
			
			await ctx.publish({
				type: "system.postgres.tables.listed",
				payload: {
					schema,
					tablesFound: tables.length,
					includeViews,
					includeSystemTables,
				},
			});
			
			return {
				tables,
				schema,
				totalTables: tables.length,
			};
		} catch (error: any) {
			console.error(`PostgreSQL tables listing failed for schema "${schema}":`, error?.message || error);
			
			await ctx.publish({
				type: "system.postgres.tables.error",
				payload: {
					schema,
					error: error?.message || "Unknown database error",
				},
			});
			
			throw new Error(`Failed to list PostgreSQL tables: ${error?.message || "Unknown error"}`);
		}
	}
	
	private mapTableType(pgType: string): "table" | "view" | "materialized_view" {
		switch (pgType) {
			case "BASE TABLE":
				return "table";
			case "VIEW":
				return "view";
			case "MATERIALIZED VIEW":
				return "materialized_view";
			default:
				return "table";
		}
	}
}