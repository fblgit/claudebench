import { PrismaClient } from "../../prisma/generated/client";
import { getRedis } from "../core/redis";

const prisma = new PrismaClient({
	log: [
		{ level: "error", emit: "stdout" },
		{ level: "warn", emit: "stdout" },
	],
});

// Function to initialize PostgreSQL and set status
export async function initializePostgreSQL() {
	try {
		// Connect to PostgreSQL
		await prisma.$connect();
		console.log("[Prisma] Connected to PostgreSQL");
		
		// Verify connection with a simple query
		await prisma.$queryRaw`SELECT 1`;
		
		// Set PostgreSQL status as healthy with a longer TTL
		const redis = getRedis();
		await redis.pub.setex("cb:service:postgres:status", 3600, "ok"); // 1 hour TTL
		console.log("[Prisma] PostgreSQL status set to ok");
		
		// Keep status alive with periodic heartbeat
		setInterval(async () => {
			try {
				await prisma.$queryRaw`SELECT 1`;
				await redis.pub.setex("cb:service:postgres:status", 3600, "ok");
			} catch (error) {
				console.error("[Prisma] PostgreSQL heartbeat failed:", error);
			}
		}, 5 * 60 * 1000); // Every 5 minutes
		
		return true;
	} catch (error) {
		console.error("[Prisma] Failed to connect to PostgreSQL:", error);
		return false;
	}
}

export default prisma;
