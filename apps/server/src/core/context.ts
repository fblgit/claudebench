import { PrismaClient } from "../../prisma/generated/client";
import { getRedis } from "./redis";
import type { Redis as RedisClient } from "ioredis";
import { instance } from "../config";
import { eventBus } from "./bus";

export interface EventContext {
	// Data access
	redis: ReturnType<typeof getRedis>;
	prisma: PrismaClient;
	
	// Event system
	publish: typeof eventBus.publish;
	
	// Request metadata
	eventId: string;
	eventType: string;
	timestamp: number;
	
	// Instance info
	instanceId: string;
	instanceRole: string;
	
	// Helper methods
	persist: boolean;
	metadata: Record<string, any>;
}

let prismaClient: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
	if (!prismaClient) {
		prismaClient = new PrismaClient();
	}
	return prismaClient;
}

export async function createContext(
	eventType: string,
	eventId: string,
	persist = false,
	metadata: Record<string, any> = {}
): Promise<EventContext> {
	return {
		redis: getRedis(),
		prisma: getPrisma(),
		publish: eventBus.publish.bind(eventBus),
		eventId,
		eventType,
		timestamp: Date.now(),
		instanceId: instance.id,
		instanceRole: instance.role,
		persist,
		metadata,
	};
}

export async function cleanupContext(): Promise<void> {
	if (prismaClient) {
		await prismaClient.$disconnect();
		prismaClient = null;
	}
}