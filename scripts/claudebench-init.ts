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

	// Configuration - use args or interactive
	let server: string;
	let instanceId: string;
	let enableHooks: string;
	
	if (isNonInteractive) {
		console.log(`${c.bright}Non-interactive mode${c.reset}\n`);
		server = serverArg || "http://localhost:3000";
		instanceId = instanceArg || "worker-1";
		enableHooks = "Y";
		console.log(`Server: ${server}`);
		console.log(`Instance: ${instanceId}`);
		console.log(`Hooks: enabled\n`);
	} else {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		
		console.log(`${c.bright}Configuration:${c.reset}\n`);
		
		server = await rl.question(`ClaudeBench server URL [http://localhost:3000]: `) || "http://localhost:3000";
		instanceId = await rl.question(`Instance ID [worker-1]: `) || "worker-1";
		enableHooks = await rl.question(`Enable hooks for Claude Code? [Y/n]: `);
		
		rl.close();
	}

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
		// Accept any response with a result object as healthy
		if (!result.result) {
			throw new Error("Invalid server response");
		}
		console.log(`${c.green}✅ Connected successfully${c.reset}\n`);
	} catch (err) {
		console.log(`${c.red}❌ Cannot connect to ClaudeBench server${c.reset}`);
		console.log(`   Make sure ClaudeBench is running: ${c.cyan}bun dev${c.reset}`);
		console.log(`   Error: ${err}`);
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

	// 3. Setup hooks and MCP configuration
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
	// Create project-local .claude directory
	const claudeDir = join(projectDir, ".claude");
	const claudeSettingsPath = join(claudeDir, "settings.json");
	
	// Create .claude directory if it doesn't exist
	if (!existsSync(claudeDir)) {
		mkdirSync(claudeDir, { recursive: true });
	}
	
	// Load the template from scripts/claude_code_hooks.json
	const claudeBenchRoot = resolve(__dirname, "..");
	const templatePath = join(claudeBenchRoot, "scripts", "claude_code_hooks.json");
	const hookScript = join(claudeBenchRoot, "scripts", "claude_code_hooks.py");
	
	if (!existsSync(templatePath)) {
		console.log(`${c.yellow}⚠️${c.reset} Template not found: ${templatePath}`);
		return;
	}
	
	if (!existsSync(hookScript)) {
		console.log(`${c.yellow}⚠️${c.reset} Hook script not found: ${hookScript}`);
		return;
	}

	// Load template settings
	const template = JSON.parse(readFileSync(templatePath, "utf-8"));
	
	// Create the hook command with environment variables
	// CLAUDE_INSTANCE_ID comes from the environment when Claude Code runs
	const hookCommand = `CLAUDEBENCH_RPC_URL="${config.server}/rpc" CLAUDE_PROJECT_DIR="${projectDir}" python3 ${hookScript}`;
	
	// Update all hook commands in the template to use our configured command
	const settings = JSON.parse(JSON.stringify(template)); // Deep clone
	
	// Update all hooks to use the configured command
	for (const hookType in settings.hooks) {
		if (Array.isArray(settings.hooks[hookType])) {
			for (const hookConfig of settings.hooks[hookType]) {
				if (hookConfig.hooks && Array.isArray(hookConfig.hooks)) {
					for (const hook of hookConfig.hooks) {
						if (hook.type === "command") {
							hook.command = hookCommand;
						}
					}
				}
			}
		}
	}
	
	// Add project-specific metadata
	settings.project = config.projectName;
	settings.claudebench = {
		server: config.server,
		instanceId: config.instanceId,
		version: config.version
	};
	
	// Save project-local Claude settings
	writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2));
	console.log(`${c.green}✅${c.reset} Created .claude/settings.json`);
	
	// Also create .mcp.json for MCP configuration
	const mcpPath = join(projectDir, ".mcp.json");
	const mcpConfig = {
		version: "1.0.0",
		servers: {
			claudebench: {
				command: "bun",
				args: [join(claudeBenchRoot, "apps", "server", "src", "mcp-server.ts")],
				env: {
					CLAUDEBENCH_RPC_URL: `${config.server}/rpc`,
					NODE_ENV: "production"
				}
			}
		}
	};
	
	writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
	console.log(`${c.green}✅${c.reset} Created .mcp.json`);
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