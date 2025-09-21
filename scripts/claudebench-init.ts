#!/usr/bin/env bun
/**
 * ClaudeBench Init - Bootstrap any project with ClaudeBench integration
 * 
 * Usage: bunx claudebench-init [options]
 * Run this from any project directory to connect it with ClaudeBench
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import readline from "readline/promises";

const VERSION = "1.0.0";

// Terminal colors
const c = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
};

// Configuration file that will be created in the project
interface ProjectConfig {
	version: string;
	server: string;
	instanceId: string;
	projectName: string;
	createdAt: string;
	hooks: boolean;
}

async function main() {
	// Parse command line arguments
	const args = process.argv.slice(2);
	const isNonInteractive = args.includes("--non-interactive") || args.includes("-n");
	const serverArg = args.find(a => a.startsWith("--server="))?.split("=")[1];
	const instanceArg = args.find(a => a.startsWith("--instance="))?.split("=")[1];
	
	console.log(`${c.bright}${c.blue}
╔═══════════════════════════════════════╗
║   ClaudeBench Project Initializer     ║
║           Version ${VERSION}              ║
╚═══════════════════════════════════════╝
${c.reset}`);

	const projectDir = process.cwd();
	const projectName = basename(projectDir);
	
	console.log(`${c.cyan}📁 Initializing: ${projectDir}${c.reset}\n`);

	// Check if already initialized
	const configPath = join(projectDir, ".claudebench.json");
	if (existsSync(configPath)) {
		console.log(`${c.yellow}⚠️  Project already initialized with ClaudeBench${c.reset}`);
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		console.log(`   Server: ${config.server}`);
		console.log(`   Instance: ${config.instanceId}\n`);
		
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		const answer = await rl.question("Reinitialize? [y/N]: ");
		rl.close();
		
		if (!answer.toLowerCase().startsWith("y")) {
			console.log("Cancelled.");
			process.exit(0);
		}
	}

	// Interactive configuration
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	
	console.log(`${c.bright}Configuration:${c.reset}\n`);
	
	const server = await rl.question(`ClaudeBench server URL [http://localhost:3000]: `) || "http://localhost:3000";
	const instanceId = await rl.question(`Instance ID [worker-1]: `) || "worker-1";
	const enableHooks = await rl.question(`Enable hooks for Claude Code? [Y/n]: `);
	
	rl.close();

	// Test server connection
	console.log(`\n${c.cyan}🔍 Testing connection to ${server}...${c.reset}`);
	
	try {
		const response = await fetch(`${server}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "system.health",
				params: {},
				id: 1
			}),
		});
		
		const result = await response.json();
		if (!result.result?.healthy) {
			throw new Error("Server unhealthy");
		}
		console.log(`${c.green}✅ Connected successfully${c.reset}\n`);
	} catch (err) {
		console.log(`${c.red}❌ Cannot connect to ClaudeBench server${c.reset}`);
		console.log(`   Make sure ClaudeBench is running: ${c.cyan}bun dev${c.reset}`);
		process.exit(1);
	}

	// Create configuration
	console.log(`${c.bright}Creating project files:${c.reset}\n`);
	
	const config: ProjectConfig = {
		version: VERSION,
		server,
		instanceId,
		projectName,
		createdAt: new Date().toISOString(),
		hooks: !enableHooks.toLowerCase().startsWith("n"),
	};

	// 1. Create .claudebench.json
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	console.log(`${c.green}✅${c.reset} Created ${c.bright}.claudebench.json${c.reset}`);

	// 2. Create CLAUDE.local.md
	const claudeLocalPath = join(projectDir, "CLAUDE.local.md");
	const claudeContent = generateClaudeLocal(config, server, projectDir);
	writeFileSync(claudeLocalPath, claudeContent);
	console.log(`${c.green}✅${c.reset} Created ${c.bright}CLAUDE.local.md${c.reset}`);

	// 3. Update Claude Code hooks if enabled
	if (config.hooks) {
		await setupHooks(config, projectDir);
	}

	// 4. Update .gitignore
	updateGitignore(projectDir);
	console.log(`${c.green}✅${c.reset} Updated ${c.bright}.gitignore${c.reset}`);

	// Success!
	console.log(`\n${c.green}${c.bright}🎉 Success! Project initialized with ClaudeBench${c.reset}\n`);
	
	console.log(`${c.bright}Next steps:${c.reset}`);
	console.log(`1. Start ClaudeBench server (if not running):`);
	console.log(`   ${c.cyan}cd <claudebench-dir> && bun dev${c.reset}`);
	console.log(`2. Restart Claude Code to load hooks`);
	console.log(`3. Open this project in Claude Code`);
	console.log(`\nYour project is now connected to ClaudeBench! 🚀\n`);
}

function generateClaudeLocal(config: ProjectConfig, server: string, projectDir: string): string {
	return `# ClaudeBench Integration

This project is connected to ClaudeBench for enhanced development capabilities.

## Configuration
- **Server**: ${server}
- **Instance**: ${config.instanceId}
- **Project**: ${config.projectName}
- **Initialized**: ${config.createdAt}

## Features
${config.hooks ? "✅ **Hooks**: Tool validation and monitoring enabled" : "❌ **Hooks**: Not configured"}
✅ **Task Management**: Use ClaudeBench tasks instead of TodoWrite
✅ **Auto-commit**: Git commits with task context

## Usage

### Start ClaudeBench server
\`\`\`bash
# In ClaudeBench directory
bun dev
\`\`\`

### Monitor events (optional)
\`\`\`bash
# In ClaudeBench directory
bun relay
\`\`\`

### Task Management
Use these MCP tools for task management:
- \`mcp__claudebench__task__create\` - Create new tasks
- \`mcp__claudebench__task__claim\` - Claim tasks
- \`mcp__claudebench__task__complete\` - Complete tasks
- \`mcp__claudebench__task__list\` - List tasks

## Project Instructions

When working in this project:
1. Always run \`bun relay\` in background to monitor events
2. Use ClaudeBench task tools instead of TodoWrite
3. Document task completions with detailed metadata
4. The backend is the source of truth for all contracts

## Custom Notes

<!-- Add your project-specific instructions here -->
`;
}

async function setupHooks(config: ProjectConfig, projectDir: string) {
	const claudeSettingsPath = join(homedir(), ".claude", "settings.json");
	
	// Check if Claude Code settings exist
	if (!existsSync(claudeSettingsPath)) {
		console.log(`${c.yellow}⚠️${c.reset} Claude Code settings not found at ${claudeSettingsPath}`);
		console.log(`   Hooks configuration skipped - configure manually later`);
		return;
	}

	try {
		// Read existing settings
		const settings = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
		
		// Prepare hook command - this will call the Python bridge script
		// We need to know where ClaudeBench is installed
		const claudeBenchRoot = resolve(__dirname, "..");
		const hookScript = join(claudeBenchRoot, "scripts", "claude_code_hooks.py");
		
		if (!existsSync(hookScript)) {
			console.log(`${c.yellow}⚠️${c.reset} Hook script not found: ${hookScript}`);
			return;
		}

		const hookCommand = `CLAUDEBENCH_RPC_URL="${config.server}/rpc" CLAUDE_PROJECT_DIR="${projectDir}" CLAUDE_INSTANCE_ID="${config.instanceId}" python3 ${hookScript}`;
		
		// Initialize hooks object if needed
		if (!settings.hooks) {
			settings.hooks = {};
		}

		// Add hooks for this project (with condition to only run in this directory)
		const projectCondition = `cwd:${projectDir}`;
		
		// Helper to add hook with condition
		const addHook = (hookType: string, matcher: string = ".*") => {
			if (!settings.hooks[hookType]) {
				settings.hooks[hookType] = [];
			}
			
			// Check if hook already exists for this project
			const existing = settings.hooks[hookType].find((h: any) => 
				h.condition === projectCondition
			);
			
			if (!existing) {
				settings.hooks[hookType].push({
					matcher,
					condition: projectCondition,
					hooks: [{
						type: "command",
						command: hookCommand
					}]
				});
			}
		};

		// Add all hook types
		addHook("PreToolUse");
		addHook("PostToolUse");
		addHook("PostToolUse", "TodoWrite"); // Special handling for TodoWrite
		addHook("UserPromptSubmit", "");
		
		// Save updated settings
		writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2));
		console.log(`${c.green}✅${c.reset} Updated Claude Code hooks`);
		
	} catch (err) {
		console.log(`${c.yellow}⚠️${c.reset} Could not update Claude Code settings: ${err}`);
		console.log(`   You may need to configure hooks manually`);
	}
}

function updateGitignore(projectDir: string) {
	const gitignorePath = join(projectDir, ".gitignore");
	const additions = [
		"",
		"# ClaudeBench",
		".claudebench.log",
		"*.claudebench.tmp",
		""
	];

	let content = "";
	if (existsSync(gitignorePath)) {
		content = readFileSync(gitignorePath, "utf-8");
		
		// Check if already has ClaudeBench section
		if (content.includes("# ClaudeBench")) {
			return;
		}
	}

	// Add entries
	if (!content.endsWith("\n") && content.length > 0) {
		content += "\n";
	}
	content += additions.join("\n");
	
	writeFileSync(gitignorePath, content);
}

// Run the initializer
main().catch((err) => {
	console.error(`${c.red}Error: ${err.message}${c.reset}`);
	process.exit(1);
});