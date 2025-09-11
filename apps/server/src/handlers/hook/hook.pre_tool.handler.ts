import { EventHandler, Instrumented } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookPreToolInput, hookPreToolOutput } from "@/schemas/hook.schema";
import type { HookPreToolInput, HookPreToolOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "hook.pre_tool",
	inputSchema: hookPreToolInput,
	outputSchema: hookPreToolOutput,
	persist: false,
	rateLimit: 1000,
	description: "Validate tool execution before it happens",
})
export class PreToolHookHandler {
	@Instrumented(300) // Cache for 5 minutes - handles caching, metrics, and audit
	async handle(input: HookPreToolInput, ctx: EventContext): Promise<HookPreToolOutput> {
		
		// Simple dangerous command detection
		const DANGEROUS_PATTERNS = [
			"rm -rf",
			"sudo rm",
			"format c:",
			"del /f /s",
			"drop database",
			"truncate table",
		];
		
		// Check if this is a bash/command execution tool
		if (input.tool === "bash" || input.tool === "command" || input.tool === "shell") {
			const command = typeof input.params === 'object' && input.params !== null && 'command' in input.params
				? String((input.params as any).command).toLowerCase() 
				: String(input.params).toLowerCase();
			
			// Check for dangerous patterns
			for (const pattern of DANGEROUS_PATTERNS) {
				if (command.includes(pattern)) {
					// Decorator handles audit logging and caching
					return {
						allow: false,
						reason: `dangerous command pattern detected: ${pattern}`,
					};
				}
			}
			
		}
		
		// Check for file system operations on system directories
		if (input.tool === "file.write" || input.tool === "file.delete" || input.tool === "Write") {
			const path = typeof input.params === 'object' && input.params !== null 
				? (input.params as any).path || (input.params as any).file_path
				: String(input.params);
			
			const systemPaths = ['/etc/', '/sys/', '/boot/', 'C:\\Windows\\', 'C:\\System'];
			for (const sysPath of systemPaths) {
				if (path && path.includes(sysPath)) {
					// Decorator handles audit logging
					return {
						allow: false,
						reason: `Cannot modify system directory: ${sysPath}`,
					};
				}
			}
		}
		
		// Example: Add timeout to long-running operations
		let modified = undefined;
		if (input.tool === "bash" && typeof input.params === 'object' && input.params !== null) {
			const params = input.params as any;
			if (!params.timeout) {
				modified = {
					...params,
					timeout: 30000, // Default 30 second timeout
				};
			}
		}
		
		// Decorator handles caching, metrics, and audit logging
		return {
			allow: true,
			modified,
		};
	}
}