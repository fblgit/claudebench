# swarm.create_project

Create new projects using swarm intelligence with queue-based processing for complex multi-specialist orchestration.

## Overview

The `swarm.create_project` handler provides a high-level interface for creating complex projects that require coordination across multiple specialists. It uses a queue-based approach for asynchronous processing and LLM intelligence for project planning and decomposition.

## Event Details

- **Event**: `swarm.create_project`
- **Type**: Asynchronous project creation
- **Persistence**: ✅ Enabled (PostgreSQL + Redis)
- **Rate Limit**: 5 projects per minute
- **Timeout**: 5 seconds (quick queuing response)
- **Processing**: Asynchronous via job queue

## Input Schema

```typescript
{
  project: string;              // Project description (1-2000 chars)
  priority?: number;            // Priority 0-100 (default: 75)
  constraints?: string[];       // Optional project constraints
  metadata?: Record<string, any>; // Optional metadata
}
```

## Output Schema

```typescript
{
  jobId: string;               // Queue job identifier
  projectId: string;           // Unique project identifier
  status: "queued" | "processing" | "completed" | "failed";
  queuePosition: number;       // Position in processing queue
  estimatedMinutes?: number;   // Estimated completion time
  message: string;             // Status message
}
```

## Project Creation Workflow

### 1. Immediate Response (Queue Entry)

The handler immediately returns with queue information:

```typescript
{
  jobId: "job-1758267405949-abc123",
  projectId: "proj-1758267405949-xyz789", 
  status: "queued",
  queuePosition: 3,
  estimatedMinutes: 45,
  message: "Project queued for processing. Position 3 in queue. Estimated time: 45 minutes."
}
```

### 2. Asynchronous Processing

Background workers process projects through multiple phases:

#### Phase 1: Analysis & Planning
- LLM analyzes project requirements
- Identifies required specialists
- Creates high-level architecture
- Estimates complexity and timeline

#### Phase 2: Decomposition
- Breaks project into manageable tasks
- Assigns specialist types to each task
- Establishes dependency relationships
- Creates execution strategy

#### Phase 3: Specialist Assignment
- Matches tasks to available specialists
- Balances workload across team
- Handles capability requirements
- Manages task queuing

#### Phase 4: Coordination & Monitoring
- Tracks progress across all tasks
- Resolves conflicts between specialists
- Synthesizes completed work
- Manages integration challenges

## Queue Management

### Job Queue Integration

Uses Bull Queue for reliable processing:

```typescript
const job = await swarmQueue.add(
  "create-project",
  {
    type: "create-project",
    projectId,
    project: input.project,
    priority: input.priority,
    constraints: input.constraints,
    sessionId: ctx.metadata?.sessionId
  },
  {
    priority: input.priority,
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 }
  }
);
```

### Queue Position & Estimation

```typescript
// Calculate position and time estimate
const waitingCount = await swarmQueue.getWaitingCount();
const queuePosition = waitingCount + 1;

const estimatedMinutes = Math.ceil(
  5 + // Base processing time
  (input.project.length / 50) + // Complexity factor
  (input.constraints?.length || 0) * 2 // Constraint overhead
);
```

### Priority Handling

Projects with higher priority values are processed first:

- **90-100**: Critical/urgent projects
- **75-89**: High priority (default)
- **50-74**: Normal priority
- **25-49**: Low priority
- **0-24**: Background/experimental

## Project Complexity Assessment

### Automatic Complexity Scoring

The system estimates complexity based on:

```typescript
const complexityFactors = {
  descriptionLength: input.project.length / 50,
  constraintCount: (input.constraints?.length || 0) * 2,
  technologyMentions: countTechnologies(input.project),
  integrationKeywords: countIntegrationTerms(input.project),
  scalabilityRequirements: countScalabilityTerms(input.project)
};

const totalComplexity = Object.values(complexityFactors).reduce((a, b) => a + b, 0);
```

### Time Estimation Algorithm

```typescript
const estimateProjectTime = (complexity: number, constraints: string[]) => {
  const baseTime = 5; // Minimum minutes
  const complexityMultiplier = complexity * 0.5;
  const constraintOverhead = constraints.length * 2;
  
  return Math.ceil(baseTime + complexityMultiplier + constraintOverhead);
};
```

## Project Types & Examples

### Web Applications

```bash
swarm__create_project '{
  "project": "Create a real-time analytics dashboard with charts, filters, and user authentication",
  "priority": 85,
  "constraints": [
    "Use React and TypeScript",
    "Include WebSocket support for real-time updates", 
    "Add export functionality to PDF/CSV",
    "Mobile-responsive design required"
  ]
}'
```

### API Services

```bash
swarm__create_project '{
  "project": "Build a REST API for task management with user authentication and real-time notifications",
  "priority": 80,
  "constraints": [
    "Use Node.js with Express",
    "PostgreSQL database with Prisma ORM",
    "JWT authentication with refresh tokens",
    "WebSocket notifications",
    "Rate limiting and input validation"
  ]
}'
```

### Full-Stack Applications

```bash
swarm__create_project '{
  "project": "Develop an e-commerce platform with product catalog, shopping cart, payment processing, and admin panel",
  "priority": 90,
  "constraints": [
    "Next.js frontend with TypeScript",
    "Node.js backend with PostgreSQL",
    "Stripe payment integration",
    "Image upload and optimization",
    "SEO optimization",
    "Admin dashboard for product management"
  ]
}'
```

### Documentation Projects

```bash
swarm__create_project '{
  "project": "Create comprehensive API documentation with interactive examples and getting started guides",
  "priority": 70,
  "constraints": [
    "Use Docusaurus v3 framework",
    "Auto-generate API docs from OpenAPI spec",
    "Include code examples in multiple languages",
    "Add search functionality",
    "Deploy to GitHub Pages"
  ]
}'
```

## Metadata & Tracking

### Project Metadata

Additional context can be provided:

```typescript
{
  metadata: {
    department: "engineering",
    requestedBy: "product-team",
    deadline: "2025-10-01",
    budget: "medium",
    stakeholders: ["john@company.com", "mary@company.com"],
    repository: "https://github.com/company/new-project"
  }
}
```

### Progress Tracking

Project progress can be monitored through events:

```typescript
// Project lifecycle events
"swarm.project.queued"      // Initial queue entry
"swarm.project.started"     // Processing began
"swarm.project.analyzed"    // Requirements analysis complete
"swarm.project.decomposed"  // Task breakdown complete
"swarm.project.assigned"    // Specialists assigned
"swarm.project.progress"    // Periodic progress updates
"swarm.project.completed"   // Project finished
"swarm.project.failed"      // Project failed
```

## Error Handling

### Circuit Breaker
- **Threshold**: 3 failures
- **Timeout**: 30 seconds
- **Fallback**: Returns failed status with error message

### Job Retry Logic
```typescript
{
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000 // Start with 5 second delay
  }
}
```

### Failure Recovery
- Failed jobs remain in queue for analysis
- Partial progress is preserved
- Manual retry/resume capabilities
- Detailed error logging and reporting

## Performance Considerations

### Queue Throughput
- **Target**: 5-10 projects processed simultaneously
- **Bottleneck**: Available specialist capacity
- **Scaling**: Horizontal specialist scaling

### Resource Management
- Redis TTL: 7 days for project metadata
- Database cleanup: Completed projects archived
- Memory optimization: Streaming large outputs

### Monitoring
- Queue depth monitoring
- Processing time tracking
- Specialist utilization metrics
- Error rate alerting

## Response Examples

### Successful Queuing

```json
{
  "jobId": "job-1758267405949-abc123",
  "projectId": "proj-1758267405949-xyz789",
  "status": "queued", 
  "queuePosition": 2,
  "estimatedMinutes": 32,
  "message": "Project queued for processing. Position 2 in queue. Estimated time: 32 minutes."
}
```

### High Priority Rush Job

```json
{
  "jobId": "job-1758267405949-urgent",
  "projectId": "proj-1758267405949-rush",
  "status": "queued",
  "queuePosition": 1,
  "estimatedMinutes": 15,
  "message": "High priority project queued. Position 1 in queue. Estimated time: 15 minutes."
}
```

## Usage Patterns

### Simple Project Creation

```bash
# Minimal project specification
swarm__create_project '{
  "project": "Create a contact form with email validation and spam protection"
}'
```

### Complex Enterprise Project

```bash
# Detailed enterprise application
swarm__create_project '{
  "project": "Build a microservices-based customer management system with authentication, real-time notifications, reporting dashboard, and mobile app",
  "priority": 95,
  "constraints": [
    "Kubernetes deployment with Helm charts",
    "GDPR compliance required",
    "Multi-tenant architecture",
    "99.9% uptime SLA", 
    "Integration with Salesforce API",
    "Advanced analytics and reporting",
    "White-label customization support"
  ],
  "metadata": {
    "department": "enterprise-solutions",
    "deadline": "2025-12-01",
    "budget": "large",
    "compliance": ["GDPR", "SOC2", "HIPAA"]
  }
}'
```

## Event Integration

### Project Lifecycle Events

The system publishes events throughout project creation:

```typescript
// Initial queuing
await ctx.publish({
  type: "swarm.project.queued",
  payload: {
    projectId,
    jobId: job.id,
    project: input.project,
    priority: input.priority,
    queuePosition,
    estimatedMinutes
  }
});
```

### Progress Monitoring

Use event relay to monitor project progress:

```bash
# Monitor project events
bun relay | grep "swarm.project"
```

## Prerequisites

- Swarm worker must be running for background processing
- Inference server must be available for LLM analysis
- Specialists should be registered for task assignment
- Redis and PostgreSQL for data persistence

## Warnings

⚠️ **Asynchronous Processing**: Project creation may take several minutes to complete

⚠️ **Progress Tracking**: Monitor progress via event relay or project status API

⚠️ **Complexity Limits**: Very large projects may timeout if too complex for automated processing

## Related Handlers

- [`swarm.decompose`](./decompose) - Used internally for task breakdown
- [`swarm.assign`](./assign) - Used for specialist assignment
- [`swarm.synthesize`](./synthesize) - Used for final integration