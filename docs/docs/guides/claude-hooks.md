# Claude Hooks Guide

Advanced hook system for integrating ClaudeBench with Claude Code and Claude Desktop tool execution workflows.

## Overview

The Claude hooks system allows you to:

- **Pre-tool Validation**: Inspect and modify tool calls before execution
- **Post-tool Processing**: Transform tool results and collect metrics
- **Security Controls**: Block dangerous operations and enforce policies
- **Workflow Automation**: Create complex AI-assisted workflows
- **Context Enhancement**: Add domain-specific information to tool contexts

## Hook Architecture

### Hook Flow

```
Claude AI Tool Request
    ↓
Pre-tool Hook (hook.pre_tool)
    ↓ (if allowed)
Original Tool Execution
    ↓
Post-tool Hook (hook.post_tool)  
    ↓
Modified Result to Claude
```

### Hook Types

1. **Pre-tool Hooks** (`hook.pre_tool`)
   - Validate tool parameters
   - Modify or block tool execution
   - Add security constraints
   - Inject additional context

2. **Post-tool Hooks** (`hook.post_tool`)
   - Transform tool results
   - Collect execution metrics
   - Log tool usage
   - Trigger follow-up actions

3. **User Prompt Hooks** (`hook.user_prompt`)
   - Process user interactions
   - Add context to conversations
   - Implement custom workflows

4. **Todo Write Hooks** (`hook.todo_write`)
   - Convert todos into tasks
   - Aggregate todo metrics
   - Sync with external systems

## Pre-tool Hook Implementation

### Basic Pre-tool Hook

```typescript
import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { preToolHookInput, preToolHookOutput } from "@/schemas/hook.schema";
import type { PreToolHookInput, PreToolHookOutput } from "@/schemas/hook.schema";

@EventHandler({
  event: "hook.pre_tool",
  inputSchema: preToolHookInput,
  outputSchema: preToolHookOutput,
  persist: false,
  description: "Validate and modify tool calls before execution"
})
export class PreToolHookHandler {
  @Instrumented(300) // Cache validation results for 5 minutes
  @Resilient({
    rateLimit: { limit: 1000, windowMs: 60000 }, // High rate for tool validations
    timeout: 3000, // Quick validation timeout
    circuitBreaker: { 
      threshold: 5, 
      timeout: 30000,
      fallback: () => ({ 
        allowed: true, // Fail open for availability
        reason: "Validation service unavailable - allowing by default",
        modifiedParameters: null
      })
    }
  })
  async handle(input: PreToolHookInput, ctx: EventContext): Promise<PreToolHookOutput> {
    const { toolName, parameters, context } = input;
    
    // Security validation
    const securityCheck = await this.validateSecurity(toolName, parameters);
    if (!securityCheck.allowed) {
      return {
        allowed: false,
        reason: securityCheck.reason,
        modifiedParameters: null
      };
    }
    
    // Parameter enhancement
    const enhancedParameters = await this.enhanceParameters(toolName, parameters, context);
    
    // Log tool attempt
    await this.logToolAttempt(toolName, parameters, context);
    
    return {
      allowed: true,
      reason: "Tool execution approved",
      modifiedParameters: enhancedParameters !== parameters ? enhancedParameters : null
    };
  }
  
  private async validateSecurity(toolName: string, parameters: any): Promise<{ allowed: boolean; reason: string }> {
    // Block dangerous file operations
    if (toolName === "bash" && this.isDangerousCommand(parameters.command)) {
      return {
        allowed: false,
        reason: `Dangerous command blocked: ${parameters.command}`
      };
    }
    
    // Block access to sensitive files
    if (toolName === "read_file" && this.isSensitivePath(parameters.path)) {
      return {
        allowed: false,
        reason: `Access to sensitive file blocked: ${parameters.path}`
      };
    }
    
    // Block network access to internal services
    if (toolName === "web_fetch" && this.isInternalUrl(parameters.url)) {
      return {
        allowed: false,
        reason: `Access to internal URL blocked: ${parameters.url}`
      };
    }
    
    return { allowed: true, reason: "Security check passed" };
  }
  
  private isDangerousCommand(command: string): boolean {
    const dangerousPatterns = [
      /rm\s+-rf\s+\//, // Delete root
      /dd\s+if=\/dev\/zero/, // Disk wipe
      /chmod\s+777/, // Overly permissive
      /sudo\s+.*/, // Sudo commands
      /curl\s+.*\|\s*sh/, // Pipe to shell
      /wget\s+.*\|\s*sh/, // Pipe to shell
      /mkfs/, // Format filesystem
      /fdisk/, // Partition disk
    ];
    
    return dangerousPatterns.some(pattern => pattern.test(command));
  }
  
  private isSensitivePath(path: string): boolean {
    const sensitivePaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/root/',
      '/.ssh/',
      '/home/*/.ssh/',
      '*.key',
      '*.pem',
      '.env',
      'secrets.json'
    ];
    
    return sensitivePaths.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(path);
      }
      return path.includes(pattern);
    });
  }
  
  private isInternalUrl(url: string): boolean {
    const internalPatterns = [
      /^https?:\/\/localhost/,
      /^https?:\/\/127\.0\.0\.1/,
      /^https?:\/\/192\.168\./,
      /^https?:\/\/10\./,
      /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,
      /^https?:\/\/.*\.internal$/,
      /^https?:\/\/.*\.local$/
    ];
    
    return internalPatterns.some(pattern => pattern.test(url));
  }
  
  private async enhanceParameters(toolName: string, parameters: any, context: any): Promise<any> {
    const enhanced = { ...parameters };
    
    // Add automatic backups for file modifications
    if (toolName === "edit_file" && !enhanced.backup) {
      enhanced.backup = true;
      enhanced.backupDir = "/tmp/claudebench-backups";
    }
    
    // Add safety flags to bash commands
    if (toolName === "bash" && !enhanced.safeMode) {
      enhanced.safeMode = true;
      enhanced.timeout = enhanced.timeout || 30000; // 30 second timeout
    }
    
    // Add project context to file operations
    if (["read_file", "edit_file", "write_file"].includes(toolName)) {
      enhanced.projectContext = {
        workingDirectory: context.workingDirectory,
        projectName: context.projectName || "unknown",
        timestamp: new Date().toISOString()
      };
    }
    
    return enhanced;
  }
  
  private async logToolAttempt(toolName: string, parameters: any, context: any): Promise<void> {
    await ctx.publish({
      type: "tool.attempt",
      payload: {
        toolName,
        parameters: this.sanitizeParameters(parameters),
        userId: context.userId,
        sessionId: context.sessionId
      },
      metadata: {
        timestamp: new Date().toISOString(),
        source: "pre-tool-hook"
      }
    });
  }
  
  private sanitizeParameters(parameters: any): any {
    // Remove sensitive data from logs
    const sanitized = { ...parameters };
    
    // Remove passwords, tokens, etc.
    const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'auth'];
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }
}
```

### Advanced Pre-tool Validation

```typescript
// Advanced validation with policy engine
export class AdvancedPreToolValidator {
  private policies: Map<string, PolicyRule[]> = new Map();
  
  constructor() {
    this.loadPolicies();
  }
  
  async validateWithPolicies(toolName: string, parameters: any, context: any): Promise<ValidationResult> {
    const policies = this.policies.get(toolName) || [];
    const violations: string[] = [];
    
    for (const policy of policies) {
      const result = await this.evaluatePolicy(policy, parameters, context);
      if (!result.passed) {
        violations.push(result.message);
      }
    }
    
    if (violations.length > 0) {
      return {
        allowed: false,
        reason: `Policy violations: ${violations.join(', ')}`,
        modifiedParameters: null
      };
    }
    
    return {
      allowed: true,
      reason: "All policies passed",
      modifiedParameters: null
    };
  }
  
  private loadPolicies(): void {
    // File operation policies
    this.policies.set("edit_file", [
      {
        name: "no_system_files",
        condition: (params: any) => !params.path.startsWith('/etc/'),
        message: "Cannot edit system configuration files"
      },
      {
        name: "require_backup",
        condition: (params: any) => params.backup !== false,
        message: "Backup required for file modifications",
        enhance: (params: any) => ({ ...params, backup: true })
      }
    ]);
    
    // Bash command policies
    this.policies.set("bash", [
      {
        name: "timeout_limit",
        condition: (params: any) => (params.timeout || 30000) <= 300000, // 5 minutes max
        message: "Command timeout too long",
        enhance: (params: any) => ({ ...params, timeout: Math.min(params.timeout || 30000, 300000) })
      },
      {
        name: "no_privileged_commands",
        condition: (params: any) => !params.command.includes('sudo'),
        message: "Privileged commands not allowed"
      }
    ]);
    
    // Network request policies
    this.policies.set("web_fetch", [
      {
        name: "allowed_domains",
        condition: (params: any) => this.isAllowedDomain(params.url),
        message: "Domain not in allowed list"
      },
      {
        name: "rate_limit",
        condition: async (params: any, context: any) => {
          return await this.checkRateLimit(context.userId, 'web_fetch');
        },
        message: "Rate limit exceeded for web requests"
      }
    ]);
  }
  
  private async evaluatePolicy(policy: PolicyRule, parameters: any, context: any): Promise<PolicyResult> {
    try {
      const passed = await policy.condition(parameters, context);
      return {
        passed,
        message: passed ? "Policy passed" : policy.message,
        enhancement: passed && policy.enhance ? policy.enhance(parameters) : null
      };
    } catch (error) {
      return {
        passed: false,
        message: `Policy evaluation error: ${error.message}`,
        enhancement: null
      };
    }
  }
  
  private isAllowedDomain(url: string): boolean {
    const allowedDomains = [
      'api.github.com',
      'docs.python.org',
      'developer.mozilla.org',
      'stackoverflow.com',
      'npmjs.com'
    ];
    
    try {
      const domain = new URL(url).hostname;
      return allowedDomains.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`));
    } catch {
      return false;
    }
  }
  
  private async checkRateLimit(userId: string, operation: string): Promise<boolean> {
    const key = `rate_limit:${userId}:${operation}`;
    const current = await redis.get(key);
    const limit = 100; // 100 requests per hour
    
    if (!current) {
      await redis.setex(key, 3600, "1");
      return true;
    }
    
    const count = parseInt(current);
    if (count >= limit) {
      return false;
    }
    
    await redis.incr(key);
    return true;
  }
}

interface PolicyRule {
  name: string;
  condition: (params: any, context?: any) => boolean | Promise<boolean>;
  message: string;
  enhance?: (params: any) => any;
}

interface PolicyResult {
  passed: boolean;
  message: string;
  enhancement: any;
}
```

## Post-tool Hook Implementation

### Basic Post-tool Hook

```typescript
@EventHandler({
  event: "hook.post_tool",
  inputSchema: postToolHookInput,
  outputSchema: postToolHookOutput,
  persist: false,
  description: "Process tool results and collect metrics"
})
export class PostToolHookHandler {
  @Instrumented(60) // Cache transformations for 1 minute
  @Resilient({
    rateLimit: { limit: 1000, windowMs: 60000 },
    timeout: 5000,
    circuitBreaker: { 
      threshold: 5, 
      timeout: 30000,
      fallback: (input: any) => ({ 
        transformedResult: input.result // Pass through on failure
      })
    }
  })
  async handle(input: PostToolHookInput, ctx: EventContext): Promise<PostToolHookOutput> {
    const { toolName, parameters, result, duration, success, error } = input;
    
    // Collect metrics
    await this.collectMetrics(toolName, duration, success);
    
    // Log execution
    await this.logExecution(toolName, parameters, result, duration, success, error);
    
    // Transform result if needed
    const transformedResult = await this.transformResult(toolName, result, parameters);
    
    // Trigger follow-up actions
    await this.triggerFollowupActions(toolName, result, success);
    
    return {
      transformedResult: transformedResult !== result ? transformedResult : undefined
    };
  }
  
  private async collectMetrics(toolName: string, duration: number, success: boolean): Promise<void> {
    const metricsKey = `cb:metrics:tools:${toolName}`;
    
    // Update counters
    await redis.incr(`${metricsKey}:total`);
    if (success) {
      await redis.incr(`${metricsKey}:success`);
    } else {
      await redis.incr(`${metricsKey}:errors`);
    }
    
    // Update timing statistics
    await redis.zadd(`${metricsKey}:timing`, Date.now(), duration);
    
    // Keep only last 1000 timing entries
    await redis.zremrangebyrank(`${metricsKey}:timing`, 0, -1001);
    
    // Update hourly statistics
    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    await redis.incr(`cb:metrics:tools:hourly:${hour}:${toolName}`);
    await redis.expire(`cb:metrics:tools:hourly:${hour}:${toolName}`, 7 * 24 * 3600); // 7 days
  }
  
  private async logExecution(
    toolName: string, 
    parameters: any, 
    result: any, 
    duration: number, 
    success: boolean, 
    error?: string
  ): Promise<void> {
    const logEntry = {
      toolName,
      parameters: this.sanitizeForLogging(parameters),
      success,
      duration,
      resultSize: JSON.stringify(result || {}).length,
      timestamp: new Date().toISOString(),
      error: error ? this.sanitizeError(error) : undefined
    };
    
    // Log to structured logging
    ctx.logger.info('Tool execution', logEntry);
    
    // Publish event for real-time monitoring
    await ctx.publish({
      type: "tool.executed",
      payload: logEntry,
      metadata: {
        source: "post-tool-hook"
      }
    });
    
    // Special handling for errors
    if (!success && error) {
      await ctx.publish({
        type: "tool.error",
        payload: {
          toolName,
          error: this.sanitizeError(error),
          parameters: this.sanitizeForLogging(parameters)
        },
        metadata: {
          severity: "error",
          source: "post-tool-hook"
        }
      });
    }
  }
  
  private async transformResult(toolName: string, result: any, parameters: any): Promise<any> {
    switch (toolName) {
      case "read_file":
        return this.transformFileReadResult(result, parameters);
        
      case "bash":
        return this.transformBashResult(result, parameters);
        
      case "web_fetch":
        return this.transformWebFetchResult(result, parameters);
        
      default:
        return result;
    }
  }
  
  private transformFileReadResult(result: any, parameters: any): any {
    if (!result.content) return result;
    
    // Add file metadata
    const enhanced = {
      ...result,
      metadata: {
        path: parameters.path,
        size: result.content.length,
        lines: result.content.split('\n').length,
        readAt: new Date().toISOString()
      }
    };
    
    // Truncate large files
    if (result.content.length > 100000) {
      enhanced.content = result.content.substring(0, 100000);
      enhanced.truncated = true;
      enhanced.originalSize = result.content.length;
    }
    
    // Add syntax highlighting hints
    const extension = parameters.path.split('.').pop()?.toLowerCase();
    if (extension) {
      enhanced.metadata.language = this.getLanguageFromExtension(extension);
    }
    
    return enhanced;
  }
  
  private transformBashResult(result: any, parameters: any): any {
    if (!result.output) return result;
    
    return {
      ...result,
      metadata: {
        command: parameters.command,
        exitCode: result.exitCode || 0,
        executionTime: result.duration || 0,
        executedAt: new Date().toISOString()
      },
      // Limit output size
      output: result.output.length > 10000 
        ? result.output.substring(0, 10000) + '\n... [output truncated]'
        : result.output
    };
  }
  
  private transformWebFetchResult(result: any, parameters: any): any {
    if (!result.content) return result;
    
    return {
      ...result,
      metadata: {
        url: parameters.url,
        fetchedAt: new Date().toISOString(),
        contentLength: result.content.length,
        statusCode: result.statusCode || 200
      },
      // Add content summary for large responses
      ...(result.content.length > 50000 && {
        summary: result.content.substring(0, 1000) + '... [content truncated]',
        fullContentAvailable: true
      })
    };
  }
  
  private async triggerFollowupActions(toolName: string, result: any, success: boolean): Promise<void> {
    // Create tasks for failed operations
    if (!success) {
      await this.createFailureTask(toolName, result);
    }
    
    // Auto-save important files
    if (toolName === "edit_file" && success) {
      await this.autoBackupFile(result);
    }
    
    // Trigger security scans for certain operations
    if (["bash", "edit_file"].includes(toolName) && success) {
      await this.triggerSecurityScan(toolName, result);
    }
  }
  
  private async createFailureTask(toolName: string, result: any): Promise<void> {
    await ctx.publish({
      type: "task.create",
      payload: {
        text: `Investigate ${toolName} failure`,
        priority: 70,
        metadata: {
          toolName,
          error: result.error,
          autoGenerated: true,
          category: "tool-failure"
        }
      }
    });
  }
  
  private getLanguageFromExtension(extension: string): string {
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'sh': 'bash',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'html': 'html',
      'css': 'css'
    };
    
    return languageMap[extension] || 'text';
  }
  
  private sanitizeForLogging(data: any): any {
    // Remove sensitive information from logs
    const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'auth'];
    const sanitized = JSON.parse(JSON.stringify(data));
    
    const sanitizeObject = (obj: any): any => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      for (const key in obj) {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          obj[key] = sanitizeObject(obj[key]);
        }
      }
      
      return obj;
    };
    
    return sanitizeObject(sanitized);
  }
  
  private sanitizeError(error: string): string {
    // Remove file paths and sensitive info from error messages
    return error
      .replace(/\/[^\/\s]+\/[^\/\s]+\/[^\s]*/g, '[PATH]') // Remove file paths
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]') // Remove IP addresses
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'); // Remove emails
  }
}
```

## Hook Configuration and Registration

### Hook Registration

```typescript
// src/hooks/registry.ts
export class HookRegistry {
  private preToolHooks: PreToolHook[] = [];
  private postToolHooks: PostToolHook[] = [];
  
  registerPreToolHook(hook: PreToolHook): void {
    this.preToolHooks.push(hook);
    console.log(`Registered pre-tool hook: ${hook.name}`);
  }
  
  registerPostToolHook(hook: PostToolHook): void {
    this.postToolHooks.push(hook);
    console.log(`Registered post-tool hook: ${hook.name}`);
  }
  
  async executePreToolHooks(context: PreToolContext): Promise<PreToolResult> {
    const results: PreToolResult[] = [];
    
    for (const hook of this.preToolHooks) {
      try {
        const result = await hook.execute(context);
        results.push(result);
        
        // If any hook blocks the tool, return immediately
        if (!result.allowed) {
          return result;
        }
        
        // Apply parameter modifications
        if (result.modifiedParameters) {
          context.parameters = result.modifiedParameters;
        }
      } catch (error) {
        console.error(`Pre-tool hook error: ${hook.name}`, error);
        // Continue with other hooks unless configured to fail fast
      }
    }
    
    return {
      allowed: true,
      reason: "All pre-tool hooks passed",
      modifiedParameters: context.parameters
    };
  }
  
  async executePostToolHooks(context: PostToolContext): Promise<PostToolResult> {
    let transformedResult = context.result;
    
    for (const hook of this.postToolHooks) {
      try {
        const result = await hook.execute({
          ...context,
          result: transformedResult
        });
        
        if (result.transformedResult !== undefined) {
          transformedResult = result.transformedResult;
        }
      } catch (error) {
        console.error(`Post-tool hook error: ${hook.name}`, error);
      }
    }
    
    return { transformedResult };
  }
}

// Hook interfaces
export interface PreToolHook {
  name: string;
  priority: number;
  execute(context: PreToolContext): Promise<PreToolResult>;
}

export interface PostToolHook {
  name: string;
  priority: number;
  execute(context: PostToolContext): Promise<PostToolResult>;
}
```

### Configuration-Driven Hooks

```typescript
// src/hooks/config.ts
export interface HookConfiguration {
  preToolHooks: PreToolHookConfig[];
  postToolHooks: PostToolHookConfig[];
  globalSettings: {
    timeout: number;
    failureMode: 'fail-fast' | 'continue';
    logging: boolean;
  };
}

export interface PreToolHookConfig {
  name: string;
  enabled: boolean;
  priority: number;
  rules: ValidationRule[];
  enhancers: ParameterEnhancer[];
}

export class ConfigurableHookSystem {
  constructor(private config: HookConfiguration) {}
  
  createPreToolHook(config: PreToolHookConfig): PreToolHook {
    return {
      name: config.name,
      priority: config.priority,
      execute: async (context: PreToolContext): Promise<PreToolResult> => {
        // Apply validation rules
        for (const rule of config.rules) {
          const result = await this.evaluateRule(rule, context);
          if (!result.passed) {
            return {
              allowed: false,
              reason: result.message,
              modifiedParameters: null
            };
          }
        }
        
        // Apply parameter enhancers
        let parameters = context.parameters;
        for (const enhancer of config.enhancers) {
          parameters = await this.applyEnhancer(enhancer, parameters, context);
        }
        
        return {
          allowed: true,
          reason: `Hook ${config.name} passed`,
          modifiedParameters: parameters !== context.parameters ? parameters : null
        };
      }
    };
  }
  
  private async evaluateRule(rule: ValidationRule, context: PreToolContext): Promise<RuleResult> {
    // Rule evaluation logic
    switch (rule.type) {
      case 'regex':
        return this.evaluateRegexRule(rule, context);
      case 'function':
        return this.evaluateFunctionRule(rule, context);
      case 'policy':
        return this.evaluatePolicyRule(rule, context);
      default:
        return { passed: true, message: "Unknown rule type" };
    }
  }
  
  private async applyEnhancer(enhancer: ParameterEnhancer, parameters: any, context: PreToolContext): Promise<any> {
    switch (enhancer.type) {
      case 'add-field':
        return { ...parameters, [enhancer.field]: enhancer.value };
      case 'transform':
        return enhancer.transform(parameters, context);
      case 'merge':
        return { ...parameters, ...enhancer.data };
      default:
        return parameters;
    }
  }
}
```

## Specialized Hook Implementations

### Security-focused Hook

```typescript
@EventHandler({
  event: "hook.security_validation",
  inputSchema: securityValidationInput,
  outputSchema: securityValidationOutput
})
export class SecurityValidationHook {
  private securityPolicies: SecurityPolicy[];
  private threatDetector: ThreatDetector;
  
  constructor() {
    this.securityPolicies = this.loadSecurityPolicies();
    this.threatDetector = new ThreatDetector();
  }
  
  async handle(input: any, ctx: EventContext): Promise<any> {
    const { toolName, parameters, userContext } = input;
    
    // Check against security policies
    const policyViolations = await this.checkSecurityPolicies(toolName, parameters, userContext);
    if (policyViolations.length > 0) {
      return {
        allowed: false,
        reason: `Security policy violations: ${policyViolations.join(', ')}`,
        threatLevel: 'high'
      };
    }
    
    // Threat detection
    const threatAssessment = await this.threatDetector.assess(toolName, parameters);
    if (threatAssessment.riskLevel === 'high') {
      return {
        allowed: false,
        reason: `High risk operation detected: ${threatAssessment.reason}`,
        threatLevel: 'high'
      };
    }
    
    // Rate limiting based on risk
    const rateLimitOk = await this.checkRateLimit(userContext.userId, threatAssessment.riskLevel);
    if (!rateLimitOk) {
      return {
        allowed: false,
        reason: "Rate limit exceeded for this risk level",
        threatLevel: threatAssessment.riskLevel
      };
    }
    
    return {
      allowed: true,
      reason: "Security validation passed",
      threatLevel: threatAssessment.riskLevel,
      recommendedEnhancements: threatAssessment.recommendedEnhancements
    };
  }
  
  private loadSecurityPolicies(): SecurityPolicy[] {
    return [
      {
        name: "file-access-policy",
        applies: (tool: string) => ["read_file", "edit_file", "write_file"].includes(tool),
        validate: (params: any) => {
          const sensitivePatterns = ['/etc/', '/root/', '/.ssh/', '.env', 'secrets'];
          return !sensitivePatterns.some(pattern => params.path?.includes(pattern));
        },
        message: "Access to sensitive files is restricted"
      },
      {
        name: "command-execution-policy",
        applies: (tool: string) => tool === "bash",
        validate: (params: any) => {
          const dangerousCommands = ['rm -rf', 'dd', 'mkfs', 'fdisk', 'sudo'];
          return !dangerousCommands.some(cmd => params.command?.includes(cmd));
        },
        message: "Dangerous commands are not allowed"
      },
      {
        name: "network-access-policy",
        applies: (tool: string) => tool === "web_fetch",
        validate: (params: any) => {
          try {
            const url = new URL(params.url);
            const allowedDomains = ['api.github.com', 'docs.python.org'];
            return allowedDomains.some(domain => url.hostname.endsWith(domain));
          } catch {
            return false;
          }
        },
        message: "Network access is restricted to approved domains"
      }
    ];
  }
}
```

### Performance Monitoring Hook

```typescript
@EventHandler({
  event: "hook.performance_monitor",
  inputSchema: performanceMonitorInput,
  outputSchema: performanceMonitorOutput
})
export class PerformanceMonitorHook {
  private performanceThresholds: Map<string, PerformanceThresholds>;
  private metricsCollector: MetricsCollector;
  
  constructor() {
    this.performanceThresholds = new Map([
      ['bash', { maxDuration: 30000, maxMemory: 100 * 1024 * 1024 }], // 30s, 100MB
      ['read_file', { maxDuration: 5000, maxFileSize: 10 * 1024 * 1024 }], // 5s, 10MB
      ['web_fetch', { maxDuration: 15000, maxResponseSize: 5 * 1024 * 1024 }] // 15s, 5MB
    ]);
    this.metricsCollector = new MetricsCollector();
  }
  
  async handle(input: any, ctx: EventContext): Promise<any> {
    const { toolName, parameters, result, duration, memoryUsage } = input;
    
    // Collect performance metrics
    await this.metricsCollector.recordExecution({
      toolName,
      duration,
      memoryUsage,
      success: !input.error,
      timestamp: Date.now()
    });
    
    // Check performance thresholds
    const thresholds = this.performanceThresholds.get(toolName);
    if (thresholds) {
      const violations = this.checkThresholds(thresholds, {
        duration,
        memoryUsage,
        parameters,
        result
      });
      
      if (violations.length > 0) {
        await this.handlePerformanceViolations(toolName, violations);
      }
    }
    
    // Generate performance report
    const performanceReport = await this.generatePerformanceReport(toolName, duration);
    
    return {
      performanceReport,
      optimizationSuggestions: await this.generateOptimizationSuggestions(toolName, parameters, duration)
    };
  }
  
  private checkThresholds(thresholds: PerformanceThresholds, metrics: any): string[] {
    const violations: string[] = [];
    
    if (thresholds.maxDuration && metrics.duration > thresholds.maxDuration) {
      violations.push(`Duration exceeded: ${metrics.duration}ms > ${thresholds.maxDuration}ms`);
    }
    
    if (thresholds.maxMemory && metrics.memoryUsage > thresholds.maxMemory) {
      violations.push(`Memory exceeded: ${metrics.memoryUsage} > ${thresholds.maxMemory}`);
    }
    
    if (thresholds.maxFileSize && metrics.result?.size > thresholds.maxFileSize) {
      violations.push(`File size exceeded: ${metrics.result.size} > ${thresholds.maxFileSize}`);
    }
    
    return violations;
  }
  
  private async generateOptimizationSuggestions(toolName: string, parameters: any, duration: number): Promise<string[]> {
    const suggestions: string[] = [];
    
    // Tool-specific suggestions
    switch (toolName) {
      case 'read_file':
        if (duration > 2000) {
          suggestions.push("Consider reading file in chunks for large files");
        }
        break;
        
      case 'bash':
        if (duration > 10000) {
          suggestions.push("Consider breaking long commands into smaller parts");
          suggestions.push("Add timeout parameter to prevent hanging");
        }
        break;
        
      case 'web_fetch':
        if (duration > 8000) {
          suggestions.push("Consider using streaming for large responses");
          suggestions.push("Add timeout and retry logic");
        }
        break;
    }
    
    return suggestions;
  }
}
```

## Integration with Claude Code

### Claude Code Configuration

Configure Claude Code to use ClaudeBench hooks:

```json
{
  "hooks": {
    "pre_tool": {
      "enabled": true,
      "endpoint": "http://localhost:3000/jsonrpc",
      "method": "hook.pre_tool",
      "timeout": 5000,
      "failureMode": "allow"
    },
    "post_tool": {
      "enabled": true,
      "endpoint": "http://localhost:3000/jsonrpc", 
      "method": "hook.post_tool",
      "timeout": 10000,
      "failureMode": "continue"
    }
  },
  "security": {
    "blockDangerousCommands": true,
    "requireApprovalForSensitiveOperations": true,
    "logAllToolExecutions": true
  }
}
```

### Hook Integration in Claude Code Workflow

```typescript
// Claude Code integration example
export class ClaudeCodeHookIntegration {
  private claudeBenchClient: ClaudeBenchClient;
  
  constructor(endpoint: string) {
    this.claudeBenchClient = new ClaudeBenchClient(endpoint);
  }
  
  async executeToolWithHooks(toolName: string, parameters: any, context: any): Promise<any> {
    // Pre-tool hook
    const preHookResult = await this.claudeBenchClient.call("hook.pre_tool", {
      toolName,
      parameters,
      context: {
        userId: context.userId,
        sessionId: context.sessionId,
        workingDirectory: process.cwd(),
        projectName: context.projectName
      }
    });
    
    if (!preHookResult.allowed) {
      throw new Error(`Tool execution blocked: ${preHookResult.reason}`);
    }
    
    // Use modified parameters if provided
    const finalParameters = preHookResult.modifiedParameters || parameters;
    
    // Execute the actual tool
    const startTime = Date.now();
    let result: any;
    let success = true;
    let error: string | undefined;
    
    try {
      result = await this.executeTool(toolName, finalParameters);
    } catch (err) {
      success = false;
      error = err.message;
      result = { error: err.message };
    }
    
    const duration = Date.now() - startTime;
    
    // Post-tool hook
    try {
      const postHookResult = await this.claudeBenchClient.call("hook.post_tool", {
        toolName,
        parameters: finalParameters,
        result,
        duration,
        success,
        error,
        context
      });
      
      // Use transformed result if provided
      if (postHookResult.transformedResult !== undefined) {
        result = postHookResult.transformedResult;
      }
    } catch (postHookError) {
      console.warn("Post-tool hook failed:", postHookError);
      // Continue with original result
    }
    
    return result;
  }
  
  private async executeTool(toolName: string, parameters: any): Promise<any> {
    // Tool execution logic specific to Claude Code
    switch (toolName) {
      case 'read_file':
        return await this.readFile(parameters.path);
      case 'edit_file':
        return await this.editFile(parameters.path, parameters.content);
      case 'bash':
        return await this.executeBash(parameters.command, parameters.timeout);
      // ... other tools
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
```

## Best Practices

### 1. Hook Design
- **Keep Hooks Fast**: Pre-tool hooks should complete in < 3 seconds
- **Fail Gracefully**: Provide meaningful fallbacks when hooks fail
- **Cache Results**: Cache expensive validations and transformations
- **Log Everything**: Comprehensive logging for debugging and auditing

### 2. Security
- **Principle of Least Privilege**: Block by default, allow specific cases
- **Defense in Depth**: Multiple layers of validation
- **Input Sanitization**: Clean all data before processing
- **Rate Limiting**: Prevent abuse and DoS attacks

### 3. Performance
- **Async Processing**: Use async/await for all I/O operations
- **Connection Pooling**: Reuse database and Redis connections
- **Resource Limits**: Set timeouts and memory limits
- **Monitoring**: Track hook performance and failures

### 4. Maintainability
- **Configuration-Driven**: Use config files for rules and policies
- **Modular Design**: Separate concerns into focused hooks
- **Testing**: Unit and integration tests for all hooks
- **Documentation**: Clear documentation for hook behavior

For more advanced integration patterns, see the [MCP Integration Guide](mcp-integration.md) and [WebSocket Events Guide](websocket-events.md).