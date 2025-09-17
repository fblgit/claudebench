#!/usr/bin/env bun

/**
 * Database Backup Script for ClaudeBench
 * Backs up both PostgreSQL and Redis data to a single archive
 * 
 * Usage: bun scripts/db-backup.ts [filename]
 * Example: bun scripts/db-backup.ts backup-2025-09-17.tar.gz
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import Redis from "ioredis";

const BACKUP_DIR = "backups";
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

async function backupPostgres(tempDir: string) {
	console.log("📦 Backing up PostgreSQL...");
	
	const dbConfig = parsePostgresUrl(DATABASE_URL);
	const backupFile = join(tempDir, "postgres.sql");
	
	// Check if we should use Docker or direct connection
	const useDocker = await $`docker ps --filter name=${POSTGRES_CONTAINER} --format "{{.Names}}"`.text();
	
	if (useDocker.trim() === POSTGRES_CONTAINER) {
		// Use Docker container
		console.log("   Using Docker container:", POSTGRES_CONTAINER);
		await $`docker exec ${POSTGRES_CONTAINER} pg_dump -U ${dbConfig.user} ${dbConfig.database} > ${backupFile}`;
	} else {
		// Direct connection
		console.log("   Using direct connection to:", dbConfig.host);
		process.env.PGPASSWORD = dbConfig.password;
		await $`pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} ${dbConfig.database} > ${backupFile}`;
		delete process.env.PGPASSWORD;
	}
	
	const stats = await Bun.file(backupFile).size;
	console.log(`   ✅ PostgreSQL backup: ${(stats / 1024 / 1024).toFixed(2)} MB`);
}

async function backupRedis(tempDir: string) {
	console.log("📦 Backing up Redis...");
	
	const redis = new Redis({
		host: REDIS_HOST,
		port: REDIS_PORT,
		retryStrategy: () => null
	});
	
	try {
		// Get all ClaudeBench keys
		const keys = await redis.keys("cb:*");
		console.log(`   Found ${keys.length} ClaudeBench keys`);
		
		if (keys.length === 0) {
			console.log("   ⚠️  No ClaudeBench data in Redis");
			await Bun.write(join(tempDir, "redis.json"), JSON.stringify({ keys: [] }));
			return;
		}
		
		const backup: any = { keys: [] };
		
		for (const key of keys) {
			const ttl = await redis.ttl(key);
			const type = await redis.type(key);
			let value: any;
			
			switch (type) {
				case "string":
					value = await redis.get(key);
					break;
				case "hash":
					value = await redis.hgetall(key);
					break;
				case "list":
					value = await redis.lrange(key, 0, -1);
					break;
				case "set":
					value = await redis.smembers(key);
					break;
				case "zset":
					value = await redis.zrange(key, 0, -1, "WITHSCORES");
					break;
				case "stream":
					value = await redis.xrange(key, "-", "+");
					break;
				default:
					console.warn(`   ⚠️  Unknown type ${type} for key ${key}`);
					continue;
			}
			
			backup.keys.push({
				key,
				type,
				ttl: ttl > 0 ? ttl : -1,
				value
			});
		}
		
		await Bun.write(join(tempDir, "redis.json"), JSON.stringify(backup, null, 2));
		const stats = await Bun.file(join(tempDir, "redis.json")).size;
		console.log(`   ✅ Redis backup: ${(stats / 1024).toFixed(2)} KB`);
	} finally {
		redis.disconnect();
	}
}

async function createMetadata(tempDir: string) {
	const metadata = {
		timestamp: new Date().toISOString(),
		version: "1.0",
		claudebench: {
			node_version: process.version,
			bun_version: Bun.version,
			platform: process.platform
		}
	};
	
	await Bun.write(join(tempDir, "metadata.json"), JSON.stringify(metadata, null, 2));
	console.log("📝 Created backup metadata");
}

async function main() {
	const filename = process.argv[2] || `backup-${new Date().toISOString().replace(/:/g, "-").split(".")[0]}.tar.gz`;
	const backupPath = join(BACKUP_DIR, filename);
	
	// Create backup directory
	if (!existsSync(BACKUP_DIR)) {
		mkdirSync(BACKUP_DIR, { recursive: true });
	}
	
	// Create temp directory
	const tempDir = await $`mktemp -d`.text();
	const tempDirPath = tempDir.trim();
	console.log(`🔧 Using temp directory: ${tempDirPath}`);
	
	try {
		// Backup both databases
		await createMetadata(tempDirPath);
		await backupPostgres(tempDirPath);
		await backupRedis(tempDirPath);
		
		// Create archive
		console.log("📦 Creating archive...");
		await $`tar -czf ${backupPath} -C ${tempDirPath} .`;
		
		const stats = await Bun.file(backupPath).size;
		console.log(`\n✅ Backup complete: ${backupPath}`);
		console.log(`   Size: ${(stats / 1024 / 1024).toFixed(2)} MB`);
		
		// Cleanup
		await $`rm -rf ${tempDirPath}`;
	} catch (error) {
		console.error("❌ Backup failed:", error);
		// Cleanup on error
		await $`rm -rf ${tempDirPath}`.quiet();
		process.exit(1);
	}
}

main();