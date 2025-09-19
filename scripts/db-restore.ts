#!/usr/bin/env bun

/**
 * Database Restore Script for ClaudeBench
 * Restores both PostgreSQL and Redis data from a backup archive
 * 
 * Usage: bun scripts/db-restore.ts <filename>
 * Example: bun scripts/db-restore.ts backups/backup-2025-09-17.tar.gz
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import Redis from "ioredis";

const POSTGRES_CONTAINER = "claudebench-postgres";
const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379");
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/claudebench";

// Parse PostgreSQL connection string
function parsePostgresUrl(url: string) {
	const match = url.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
	if (!match) throw new Error("Invalid DATABASE_URL format");
	return {
		user: match[1],
		password: match[2],
		host: match[3],
		port: match[4],
		database: match[5]
	};
}

async function restorePostgres(tempDir: string) {
	console.log("🔄 Restoring PostgreSQL...");
	
	const dbConfig = parsePostgresUrl(DATABASE_URL);
	const backupFile = join(tempDir, "postgres.sql");
	
	if (!existsSync(backupFile)) {
		console.log("   ⚠️  No PostgreSQL backup found, skipping");
		return;
	}
	
	// Check if we should use Docker or direct connection
	const useDocker = await $`docker ps --filter name=${POSTGRES_CONTAINER} --format "{{.Names}}"`.text();
	
	if (useDocker.trim() === POSTGRES_CONTAINER) {
		// Use Docker container
		console.log("   Using Docker container:", POSTGRES_CONTAINER);
		
		// Drop existing connections and recreate database
		await $`docker exec ${POSTGRES_CONTAINER} psql -U ${dbConfig.user} -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbConfig.database}' AND pid <> pg_backend_pid();"`.quiet();
		await $`docker exec ${POSTGRES_CONTAINER} psql -U ${dbConfig.user} -c "DROP DATABASE IF EXISTS ${dbConfig.database};"`.quiet();
		await $`docker exec ${POSTGRES_CONTAINER} psql -U ${dbConfig.user} -c "CREATE DATABASE ${dbConfig.database};"`;
		
		// Restore from backup
		await $`docker exec -i ${POSTGRES_CONTAINER} psql -U ${dbConfig.user} ${dbConfig.database} < ${backupFile}`;
	} else {
		// Direct connection
		console.log("   Using direct connection to:", dbConfig.host);
		process.env.PGPASSWORD = dbConfig.password;
		
		// Drop existing connections and recreate database
		await $`psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbConfig.database}' AND pid <> pg_backend_pid();"`.quiet();
		await $`psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -c "DROP DATABASE IF EXISTS ${dbConfig.database};"`.quiet();
		await $`psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -c "CREATE DATABASE ${dbConfig.database};"`;
		
		// Restore from backup
		await $`psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} ${dbConfig.database} < ${backupFile}`;
		delete process.env.PGPASSWORD;
	}
	
	console.log("   ✅ PostgreSQL restored successfully");
}

async function restoreRedis(tempDir: string) {
	console.log("🔄 Restoring Redis...");
	
	const backupFile = join(tempDir, "redis.json");
	
	if (!existsSync(backupFile)) {
		console.log("   ⚠️  No Redis backup found, skipping");
		return;
	}
	
	const redis = new Redis({
		host: REDIS_HOST,
		port: REDIS_PORT,
		retryStrategy: () => null
	});
	
	try {
		// Clear existing ClaudeBench keys
		const existingKeys = await redis.keys("cb:*");
		if (existingKeys.length > 0) {
			console.log(`   Clearing ${existingKeys.length} existing keys...`);
			await redis.del(...existingKeys);
		}
		
		// Load backup
		const backup = await Bun.file(backupFile).json();
		console.log(`   Restoring ${backup.keys.length} keys...`);
		
		for (const item of backup.keys) {
			const { key, type, ttl, value } = item;
			
			switch (type) {
				case "string":
					await redis.set(key, value);
					break;
				case "hash":
					if (Object.keys(value).length > 0) {
						await redis.hset(key, value);
					}
					break;
				case "list":
					if (value.length > 0) {
						await redis.rpush(key, ...value);
					}
					break;
				case "set":
					if (value.length > 0) {
						await redis.sadd(key, ...value);
					}
					break;
				case "zset":
					if (value.length > 0) {
						// Convert WITHSCORES format back
						const members: string[] = [];
						for (let i = 0; i < value.length; i += 2) {
							members.push(value[i+1], value[i]); // score, member
						}
						await redis.zadd(key, ...members);
					}
					break;
				case "stream":
					// Stream restoration is complex, store as JSON in hash
					console.warn(`   ⚠️  Converting stream ${key} to hash (stream restore not implemented)`);
					await redis.hset(key, { data: JSON.stringify(value) });
					break;
				default:
					console.warn(`   ⚠️  Unknown type ${type} for key ${key}`);
					continue;
			}
			
			// Restore TTL if it was set
			if (ttl > 0) {
				await redis.expire(key, ttl);
			}
		}
		
		console.log("   ✅ Redis restored successfully");
	} finally {
		redis.disconnect();
	}
}

async function validateBackup(tempDir: string) {
	console.log("🔍 Validating backup...");
	
	const metadataFile = join(tempDir, "metadata.json");
	if (!existsSync(metadataFile)) {
		throw new Error("Invalid backup: metadata.json not found");
	}
	
	const metadata = await Bun.file(metadataFile).json();
	console.log(`   Backup created: ${metadata.timestamp}`);
	console.log(`   Backup version: ${metadata.version}`);
	
	return metadata;
}

async function main() {
	const filename = process.argv[2];
	
	if (!filename) {
		console.error("❌ Usage: bun scripts/db-restore.ts <filename>");
		console.error("   Example: bun scripts/db-restore.ts backups/backup-2025-09-17.tar.gz");
		process.exit(1);
	}
	
	if (!existsSync(filename)) {
		console.error(`❌ Backup file not found: ${filename}`);
		process.exit(1);
	}
	
	// Extract to temp directory
	const tempDir = await $`mktemp -d`.text();
	const tempDirPath = tempDir.trim();
	console.log(`🔧 Using temp directory: ${tempDirPath}`);
	
	try {
		// Extract archive
		console.log("📦 Extracting archive...");
		await $`tar -xzf ${filename} -C ${tempDirPath}`;
		
		// Validate and restore
		await validateBackup(tempDirPath);
		
		// Prompt for confirmation
		console.log("\n⚠️  WARNING: This will replace all existing data!");
		console.log("   Press Ctrl+C to cancel, or Enter to continue...");
		
		for await (const _ of console) {
			break;
		}
		
		await restorePostgres(tempDirPath);
		await restoreRedis(tempDirPath);
		
		console.log("\n✅ Restore complete!");
		
		// Cleanup
		await $`rm -rf ${tempDirPath}`;
	} catch (error) {
		console.error("❌ Restore failed:", error);
		// Cleanup on error
		await $`rm -rf ${tempDirPath}`.quiet();
		process.exit(1);
	}
}

main();