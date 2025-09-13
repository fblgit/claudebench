/**
 * MCP Session Management
 * 
 * Manages MCP sessions with optional Redis persistence.
 * Sessions are primarily in-memory with Redis as backup.
 */

import { getRedis, redisKey } from "../core/redis";

export interface McpSession {
	id: string;
	createdAt: number;
	lastActivity: number;
	metadata?: Record<string, any>;
}

/**
 * Manages MCP sessions
 */
export class SessionManager {
	private static instance: SessionManager;
	private sessions: Map<string, McpSession> = new Map();
	private readonly SESSION_TTL = 3600; // 1 hour in seconds

	private constructor() {}

	static getInstance(): SessionManager {
		if (!SessionManager.instance) {
			SessionManager.instance = new SessionManager();
		}
		return SessionManager.instance;
	}

	/**
	 * Create a new session
	 */
	async createSession(sessionId: string, metadata?: Record<string, any>): Promise<McpSession> {
		const session: McpSession = {
			id: sessionId,
			createdAt: Date.now(),
			lastActivity: Date.now(),
			metadata,
		};

		// Store in memory
		this.sessions.set(sessionId, session);

		// Try to persist to Redis (optional)
		try {
			const redis = getRedis();
			const sessionKey = redisKey("mcp", "session", sessionId);
			// Use the stream client which has Redis commands
			await redis.stream.setex(sessionKey, this.SESSION_TTL, JSON.stringify(session));
		} catch (error) {
			// Redis persistence is optional - log but don't fail
			console.warn(`[MCP] Failed to persist session ${sessionId} to Redis:`, error);
		}

		return session;
	}

	/**
	 * Get an existing session
	 */
	async getSession(sessionId: string): Promise<McpSession | null> {
		// Check memory first
		let session = this.sessions.get(sessionId);
		
		if (!session) {
			// Try to load from Redis (optional)
			try {
				const redis = getRedis();
				const sessionKey = redisKey("mcp", "session", sessionId);
				const data = await redis.stream.get(sessionKey);
				
				if (data) {
					session = JSON.parse(data) as McpSession;
					this.sessions.set(sessionId, session);
				}
			} catch (error) {
				// Redis is optional - log but don't fail
				console.warn(`[MCP] Failed to load session ${sessionId} from Redis:`, error);
			}
		}

		if (session) {
			// Update last activity
			session.lastActivity = Date.now();
			this.sessions.set(sessionId, session);
			
			// Try to update in Redis (optional)
			try {
				const redis = getRedis();
				const sessionKey = redisKey("mcp", "session", sessionId);
				await redis.stream.setex(sessionKey, this.SESSION_TTL, JSON.stringify(session));
			} catch (error) {
				// Non-critical - session still works from memory
			}
		}

		return session || null;
	}

	/**
	 * Remove a session
	 */
	async removeSession(sessionId: string): Promise<void> {
		// Remove from memory
		this.sessions.delete(sessionId);

		// Try to remove from Redis (optional)
		try {
			const redis = getRedis();
			const sessionKey = redisKey("mcp", "session", sessionId);
			await redis.stream.del(sessionKey);
		} catch (error) {
			// Non-critical
			console.warn(`[MCP] Failed to remove session ${sessionId} from Redis:`, error);
		}
	}

	/**
	 * Get all active sessions
	 */
	getAllSessions(): McpSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Clear all sessions
	 */
	async clearAllSessions(): Promise<void> {
		const sessionIds = Array.from(this.sessions.keys());
		
		// Clear memory
		this.sessions.clear();

		// Try to clear from Redis (optional)
		if (sessionIds.length > 0) {
			try {
				const redis = getRedis();
				const keys = sessionIds.map(id => redisKey("mcp", "session", id));
				// Delete all keys at once
				await redis.stream.unlink(...keys);
			} catch (error) {
				// Non-critical
				console.warn("[MCP] Failed to clear sessions from Redis:", error);
			}
		}
	}

	/**
	 * Clean up expired sessions
	 */
	async cleanupExpiredSessions(): Promise<void> {
		const now = Date.now();
		const expiredSessions: string[] = [];

		for (const [sessionId, session] of this.sessions.entries()) {
			// Check if session has been inactive for more than TTL
			if (now - session.lastActivity > this.SESSION_TTL * 1000) {
				expiredSessions.push(sessionId);
			}
		}

		// Remove expired sessions
		for (const sessionId of expiredSessions) {
			await this.removeSession(sessionId);
			console.log(`🧹 Cleaned up expired MCP session: ${sessionId}`);
		}
	}
}