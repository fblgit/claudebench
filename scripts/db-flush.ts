#!/usr/bin/env bun

/**
 * Database Flush Script for ClaudeBench
 * Clears all data from both PostgreSQL and Redis
 * 
 * Usage: bun scripts/db-flush.ts [--force]
 * 
 * Options:
 *   --force    Skip confirmation prompt
 *   --redis    Flush only Redis
 *   --postgres Flush only PostgreSQL
 * 
 * WARNING: This will permanently delete all data!
 */

import { $ } from "bun";
import Redis from "ioredis";
import { PrismaClient } from "../apps/server/prisma/generated/client";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379");
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/claudebench";

// Parse command line arguments
const args = process.argv.slice(2);
const force = args.includes("--force");
const redisOnly = args.includes("--redis");
const postgresOnly = args.includes("--postgres");
const flushBoth = !redisOnly && !postgresOnly;

// Color codes for terminal output
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m"
};

function colorize(text: string, color: keyof typeof colors): string {
	return `${colors[color]}${text}${colors.reset}`;
}

async function flushRedis(): Promise<void> {
	console.log(colorize("\n🗑️  Flushing Redis...", "yellow"));
	
	const redis = new Redis({
		host: REDIS_HOST,
		port: REDIS_PORT,
		lazyConnect: true
	});

	try {
		await redis.connect();
		
		// Get key count before flush
		const keyCount = await redis.dbsize();
		console.log(`   Found ${colorize(keyCount.toString(), "cyan")} keys to delete`);
		
		// Flush the database
		await redis.flushdb();
		
		console.log(colorize("   ✓ Redis flushed successfully", "green"));
	} catch (error) {
		console.error(colorize(`   ✗ Failed to flush Redis: ${error}`, "red"));
		throw error;
	} finally {
		await redis.quit();
	}
}

async function flushPostgres(): Promise<void> {
	console.log(colorize("\n🗑️  Flushing PostgreSQL...", "yellow"));
	
	const prisma = new PrismaClient({
		datasources: {
			db: {
				url: DATABASE_URL
			}
		}
	});

	try {
		// Get all table names from Prisma schema
		const tables = [
			"Task",
			"TaskAttachment",
			"SessionState",
			"SessionEvent",
			"SessionSnapshot",
			"HookAudit",
			"GitCommit"
		];

		let totalDeleted = 0;

		// Delete data from each table
		for (const table of tables) {
			try {
				// Use raw query to bypass Prisma's type checking for dynamic table names
				const result = await prisma.$executeRawUnsafe(
					`DELETE FROM "${table}"`
				);
				console.log(`   Deleted records from ${colorize(table, "cyan")}: ${result}`);
				totalDeleted += result;
			} catch (error: any) {
				// Table might not exist yet if migrations haven't been run
				if (error.code === 'P2010' || error.message?.includes('does not exist')) {
					console.log(`   Skipped ${colorize(table, "cyan")} (table doesn't exist)`);
				} else {
					console.error(colorize(`   ✗ Failed to clear ${table}: ${error.message}`, "red"));
				}
			}
		}

		// Reset sequences for auto-increment fields
		try {
			await prisma.$executeRawUnsafe(`
				DO $$ 
				DECLARE 
					r RECORD;
				BEGIN
					FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') 
					LOOP
						EXECUTE 'ALTER SEQUENCE IF EXISTS ' || quote_ident(r.tablename || '_id_seq') || ' RESTART WITH 1';
					END LOOP;
				END $$;
			`);
			console.log(colorize("   ✓ Reset auto-increment sequences", "green"));
		} catch (error) {
			// Sequences might not exist for all tables
			console.log("   Note: Some sequences may not exist (this is normal)");
		}

		console.log(colorize(`   ✓ PostgreSQL flushed successfully (${totalDeleted} total records deleted)`, "green"));
	} catch (error) {
		console.error(colorize(`   ✗ Failed to flush PostgreSQL: ${error}`, "red"));
		throw error;
	} finally {
		await prisma.$disconnect();
	}
}

async function confirmFlush(): Promise<boolean> {
	if (force) {
		return true;
	}

	console.log(colorize("\n⚠️  WARNING: This will permanently delete all data!", "red"));
	console.log("   Affected databases:");
	
	if (flushBoth || redisOnly) {
		console.log(`   • Redis at ${colorize(`${REDIS_HOST}:${REDIS_PORT}`, "cyan")}`);
	}
	if (flushBoth || postgresOnly) {
		console.log(`   • PostgreSQL at ${colorize(DATABASE_URL.replace(/:[^@]+@/, ':****@'), "cyan")}`);
	}

	console.log(colorize("\n   This action cannot be undone!", "red"));
	process.stdout.write("\n   Type 'FLUSH' to confirm: ");

	// Use readline for interactive input
	for await (const line of console) {
		return line.trim() === "FLUSH";
	}
}

async function main() {
	console.log(colorize("\n=== ClaudeBench Database Flush Utility ===", "magenta"));

	try {
		// Check for confirmation
		if (!(await confirmFlush())) {
			console.log(colorize("\n✗ Flush cancelled", "yellow"));
			process.exit(0);
		}

		console.log(colorize("\n🚀 Starting flush operation...", "blue"));

		// Flush databases based on flags
		if (flushBoth || redisOnly) {
			await flushRedis();
		}

		if (flushBoth || postgresOnly) {
			await flushPostgres();
		}

		console.log(colorize("\n✅ All data flushed successfully!", "green"));
		console.log("   You can now start fresh with a clean database.\n");

		// Exit successfully
		process.exit(0);
	} catch (error) {
		console.error(colorize(`\n✗ Flush operation failed: ${error}`, "red"));
		console.error("   Please check your database connections and try again.\n");
		process.exit(1);
	}
}

// Run the script
main().catch(console.error);