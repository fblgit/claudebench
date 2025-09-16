import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRedisGetInput, systemRedisGetOutput } from "@/schemas/system.schema";
import type { SystemRedisGetInput, SystemRedisGetOutput } from "@/schemas/system.schema";

@EventHandler({
	event: "system.redis.get",
	inputSchema: systemRedisGetInput,
	outputSchema: systemRedisGetOutput,
	persist: false,
	rateLimit: 100, // Higher rate limit for read operations
	description: "Inspect Redis key data with type-aware formatting",
})
export class SystemRedisGetHandler {
	@Instrumented(30) // Cache for 30 seconds
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 requests per minute
		timeout: 8000, // 8 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				key: "",
				exists: false,
				type: "none",
				ttl: -2,
				size: 0,
				data: null
			})
		}
	})
	async handle(input: SystemRedisGetInput, ctx: EventContext): Promise<SystemRedisGetOutput> {
		const { key, format, limit } = input;
		
		try {
			// Check if key exists and get basic info
			const exists = await ctx.redis.stream.exists(key);
			if (!exists) {
				return {
					key,
					exists: false,
					type: "none",
					ttl: -2,
					size: 0,
					data: null,
				};
			}
			
			// Get key metadata
			const [type, ttl] = await Promise.all([
				ctx.redis.stream.type(key),
				ctx.redis.stream.ttl(key),
			]);
			
			// Get size and data based on type
			let size = 0;
			let data: any = null;
			let metadata: any = {};
			
			switch (type) {
				case "string":
					const stringValue = await ctx.redis.stream.get(key);
					size = stringValue ? stringValue.length : 0;
					data = this.formatStringData(stringValue, format);
					break;
					
				case "hash":
					const hashData = await ctx.redis.stream.hgetall(key);
					size = Object.keys(hashData).length;
					data = this.formatHashData(hashData, format);
					break;
					
				case "list":
					size = await ctx.redis.stream.llen(key);
					const listData = await ctx.redis.stream.lrange(key, 0, limit - 1);
					data = this.formatListData(listData, format, size, limit);
					break;
					
				case "set":
					size = await ctx.redis.stream.scard(key);
					const setData = await ctx.redis.stream.smembers(key);
					data = this.formatSetData(setData.slice(0, limit), format, size, limit);
					break;
					
				case "zset":
					size = await ctx.redis.stream.zcard(key);
					const zsetData = await ctx.redis.stream.zrevrange(key, 0, limit - 1, "WITHSCORES");
					data = this.formatZSetData(zsetData, format, size, limit);
					break;
					
				case "stream":
					const streamInfo = await ctx.redis.stream.xinfo("STREAM", key).catch(() => ([] as any[]));
					if (streamInfo && Array.isArray(streamInfo) && streamInfo.length > 1) {
						size = parseInt(streamInfo[1] as string); // length is at index 1
						const streamData = await ctx.redis.stream.xrevrange(key, "+", "-", "COUNT", limit);
						data = this.formatStreamData(streamData, format, size, limit);
						metadata.streamInfo = this.parseStreamInfo(streamInfo);
					}
					break;
			}
			
			// Get additional metadata if available
			try {
				const [encoding, memory] = await Promise.all([
					ctx.redis.stream.object("ENCODING", key).catch(() => null),
					ctx.redis.stream.memory("USAGE", key).catch(() => null),
				]);
				
				if (encoding) metadata.encoding = encoding;
				if (memory) metadata.memory = memory;
			} catch (error) {
				// Ignore metadata errors
			}
			
			await ctx.publish({
				type: "system.redis.get.inspected",
				payload: {
					key,
					type,
					size,
					hasData: data !== null,
				},
			});
			
			return {
				key,
				exists: true,
				type,
				ttl,
				size,
				data,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		} catch (error: any) {
			console.error(`Redis key inspection failed for "${key}":`, error?.message || error);
			
			await ctx.publish({
				type: "system.redis.get.error",
				payload: {
					key,
					error: error?.message || "Unknown Redis error",
				},
			});
			
			throw new Error(`Failed to inspect Redis key: ${error?.message || "Unknown error"}`);
		}
	}
	
	private formatStringData(value: string | null, format: string): any {
		if (!value) return null;
		
		if (format === "json") {
			try {
				return JSON.parse(value);
			} catch {
				return value; // Return as string if not valid JSON
			}
		}
		
		if (format === "pretty" && this.isJSON(value)) {
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}
		}
		
		return value;
	}
	
	private formatHashData(hash: Record<string, string>, format: string): any {
		if (format === "raw") return hash;
		
		// Try to parse JSON values in hash fields
		if (format === "pretty" || format === "json") {
			const formatted: Record<string, any> = {};
			for (const [field, value] of Object.entries(hash)) {
				if (this.isJSON(value)) {
					try {
						formatted[field] = JSON.parse(value);
					} catch {
						formatted[field] = value;
					}
				} else {
					formatted[field] = value;
				}
			}
			return formatted;
		}
		
		return hash;
	}
	
	private formatListData(list: string[], format: string, totalSize: number, limit: number): any {
		const formatted = format === "raw" ? list : list.map(item => {
			if (this.isJSON(item)) {
				try {
					return JSON.parse(item);
				} catch {
					return item;
				}
			}
			return item;
		});
		
		return {
			items: formatted,
			total: totalSize,
			showing: Math.min(limit, list.length),
			hasMore: totalSize > limit,
		};
	}
	
	private formatSetData(set: string[], format: string, totalSize: number, limit: number): any {
		const formatted = format === "raw" ? set : set.map(item => {
			if (this.isJSON(item)) {
				try {
					return JSON.parse(item);
				} catch {
					return item;
				}
			}
			return item;
		});
		
		return {
			members: formatted,
			total: totalSize,
			showing: Math.min(limit, set.length),
			hasMore: totalSize > limit,
		};
	}
	
	private formatZSetData(zsetData: string[], format: string, totalSize: number, limit: number): any {
		// zsetData is alternating [member, score, member, score, ...]
		const items = [];
		for (let i = 0; i < zsetData.length; i += 2) {
			const member = zsetData[i];
			const score = parseFloat(zsetData[i + 1]);
			
			let formattedMember = member;
			if (format !== "raw" && this.isJSON(member)) {
				try {
					formattedMember = JSON.parse(member);
				} catch {
					formattedMember = member;
				}
			}
			
			items.push({ member: formattedMember, score });
		}
		
		return {
			items,
			total: totalSize,
			showing: Math.min(limit, items.length),
			hasMore: totalSize > limit,
		};
	}
	
	private formatStreamData(streamData: any[], format: string, totalSize: number, limit: number): any {
		const entries = streamData.map(([id, fields]) => {
			const fieldMap: Record<string, any> = {};
			for (let i = 0; i < fields.length; i += 2) {
				const field = fields[i];
				let value = fields[i + 1];
				
				// Try to parse JSON values
				if (format !== "raw" && this.isJSON(value)) {
					try {
						value = JSON.parse(value);
					} catch {
						// Keep as string
					}
				}
				
				fieldMap[field] = value;
			}
			
			return { id, fields: fieldMap };
		});
		
		return {
			entries,
			total: totalSize,
			showing: Math.min(limit, entries.length),
			hasMore: totalSize > limit,
		};
	}
	
	private parseStreamInfo(info: any[]): any {
		const parsed: Record<string, any> = {};
		for (let i = 0; i < info.length; i += 2) {
			const key = info[i];
			const value = info[i + 1];
			parsed[key] = value;
		}
		return parsed;
	}
	
	private isJSON(str: string): boolean {
		if (typeof str !== "string") return false;
		const trimmed = str.trim();
		return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			   (trimmed.startsWith("[") && trimmed.endsWith("]"));
	}
}