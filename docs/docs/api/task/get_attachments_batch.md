---
sidebar_position: 10
title: task.get_attachments_batch
description: Get multiple attachments in a single batch operation
---

# task.get_attachments_batch

Retrieve multiple task attachments in a single efficient operation. This handler is optimized for fetching multiple attachments across different tasks, reducing network overhead and database queries.

## Request

### Method
`task.get_attachments_batch`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requests` | array | ✓ | Array of attachment requests (1-100 items) |
| `requests[].taskId` | string | ✓ | ID of the task |
| `requests[].key` | string | ✓ | Attachment key to retrieve |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.get_attachments_batch",
  "params": {
    "requests": [
      {
        "taskId": "t-123456",
        "key": "analysis"
      },
      {
        "taskId": "t-123456",
        "key": "implementation_notes"
      },
      {
        "taskId": "t-789012",
        "key": "test_results"
      }
    ]
  },
  "id": "req-batch-001"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "attachments": [
      {
        "id": "ta-1758272800000-x8k2n9qp3",
        "taskId": "t-123456",
        "key": "analysis",
        "type": "json",
        "value": {
          "complexity": "high",
          "estimatedHours": 8
        },
        "createdAt": "2025-01-19T11:00:00Z",
        "updatedAt": "2025-01-19T11:00:00Z"
      },
      {
        "id": "ta-1758272900000-y9l3o8qr4",
        "taskId": "t-123456",
        "key": "implementation_notes",
        "type": "markdown",
        "content": "## Implementation Details\n\n- Use Redis for caching",
        "createdAt": "2025-01-19T11:01:40Z",
        "updatedAt": "2025-01-19T11:01:40Z"
      },
      {
        "id": "ta-1758273000000-z0m4p9rs5",
        "taskId": "t-789012",
        "key": "test_results",
        "type": "json",
        "value": {
          "passed": 45,
          "failed": 2,
          "skipped": 3
        },
        "createdAt": "2025-01-19T11:03:20Z",
        "updatedAt": "2025-01-19T11:03:20Z"
      }
    ]
  },
  "id": "req-batch-001"
}
```

### Error Response

If any attachment in the batch is not found, the entire operation fails:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Attachment not found: t-789012/test_results",
    "data": {
      "taskId": "t-789012",
      "key": "test_results"
    }
  },
  "id": "req-batch-001"
}
```

## Performance Characteristics

### Optimization Features

1. **Single Database Query**: All attachments retrieved in one query using OR conditions
2. **Order Preservation**: Results maintain the same order as requests
3. **5-Minute Cache**: Results cached for 300 seconds to optimize repeated access
4. **Efficient Indexing**: Uses composite index on (taskId, key) for fast lookups

### Batch Size Limits

- **Minimum**: 1 attachment request
- **Maximum**: 100 attachment requests per batch
- **Recommendation**: Use for 3+ attachments to maximize efficiency

### Performance Comparison

```typescript
// ❌ Multiple individual calls (3 network round trips, 3 DB queries)
const a1 = await get_attachment({ taskId: "t-123", key: "analysis" });
const a2 = await get_attachment({ taskId: "t-123", key: "notes" });
const a3 = await get_attachment({ taskId: "t-456", key: "results" });

// ✅ Single batch call (1 network round trip, 1 DB query)
const { attachments } = await get_attachments_batch({
  requests: [
    { taskId: "t-123", key: "analysis" },
    { taskId: "t-123", key: "notes" },
    { taskId: "t-456", key: "results" }
  ]
});
```

## Use Cases

### 1. Loading Task Context

Retrieve all relevant attachments for a task in one operation:

```typescript
const { attachments } = await get_attachments_batch({
  requests: [
    { taskId, key: "requirements" },
    { taskId, key: "design_doc" },
    { taskId, key: "test_plan" },
    { taskId, key: "implementation_notes" }
  ]
});
```

### 2. Cross-Task Analysis

Gather analysis data from multiple related tasks:

```typescript
const taskIds = ["t-frontend", "t-backend", "t-database"];
const { attachments } = await get_attachments_batch({
  requests: taskIds.map(id => ({
    taskId: id,
    key: "complexity_analysis"
  }))
});

// Process all analyses together
const totalComplexity = attachments.reduce((sum, att) => {
  return sum + (att.value?.estimatedHours || 0);
}, 0);
```

### 3. Git History Collection

Retrieve multiple commit attachments:

```typescript
const commitKeys = ["git-commit-abc123", "git-commit-def456", "git-commit-ghi789"];
const { attachments } = await get_attachments_batch({
  requests: commitKeys.map(key => ({
    taskId: "t-feature",
    key
  }))
});

// Analyze commit history
const totalChanges = attachments.reduce((sum, att) => {
  const stats = att.value?.stats || {};
  return sum + (stats.additions || 0) + (stats.deletions || 0);
}, 0);
```

### 4. Dashboard Data Loading

Efficiently load multiple data points for dashboard display:

```typescript
// Load various metrics and documentation
const { attachments } = await get_attachments_batch({
  requests: [
    { taskId: "t-project", key: "progress_metrics" },
    { taskId: "t-project", key: "risk_assessment" },
    { taskId: "t-project", key: "resource_allocation" },
    { taskId: "t-project", key: "timeline" }
  ]
});

// Build dashboard view
const dashboard = {
  metrics: attachments.find(a => a.key === "progress_metrics")?.value,
  risks: attachments.find(a => a.key === "risk_assessment")?.value,
  resources: attachments.find(a => a.key === "resource_allocation")?.value,
  timeline: attachments.find(a => a.key === "timeline")?.value
};
```

## Error Handling

### Missing Attachments

The batch operation fails if any requested attachment is not found. Handle this appropriately:

```typescript
try {
  const { attachments } = await get_attachments_batch({
    requests: [/* ... */]
  });
} catch (error) {
  if (error.message.includes("Attachment not found")) {
    // Parse error to identify missing attachment
    const match = error.message.match(/Attachment not found: (.+)\/(.+)/);
    if (match) {
      const [_, taskId, key] = match;
      console.log(`Missing: ${taskId}/${key}`);
      
      // Retry without the missing attachment
      const filteredRequests = requests.filter(
        r => !(r.taskId === taskId && r.key === key)
      );
      // Retry with filtered requests...
    }
  }
}
```

### Partial Loading Strategy

For scenarios where missing attachments are acceptable:

```typescript
async function loadAttachmentsGracefully(requests) {
  const results = new Map();
  
  // Try batch operation first
  try {
    const { attachments } = await get_attachments_batch({ requests });
    attachments.forEach(att => {
      results.set(`${att.taskId}:${att.key}`, att);
    });
    return results;
  } catch (error) {
    // Fall back to individual requests on failure
    console.log("Batch failed, loading individually");
    
    for (const req of requests) {
      try {
        const att = await get_attachment(req);
        results.set(`${req.taskId}:${req.key}`, att);
      } catch (e) {
        // Skip missing attachments
        results.set(`${req.taskId}:${req.key}`, null);
      }
    }
    
    return results;
  }
}
```

## Implementation Details

### Database Query Optimization

The handler uses a single PostgreSQL query with OR conditions:

```sql
SELECT * FROM TaskAttachment
WHERE (taskId = 't-123' AND key = 'analysis')
   OR (taskId = 't-123' AND key = 'notes')
   OR (taskId = 't-456' AND key = 'results')
```

### Response Order

Results are returned in the same order as requests, making it easy to correlate:

```typescript
const { attachments } = await get_attachments_batch({
  requests: [
    { taskId: "t-1", key: "a" },  // Index 0
    { taskId: "t-2", key: "b" },  // Index 1
    { taskId: "t-3", key: "c" }   // Index 2
  ]
});

// attachments[0] corresponds to t-1/a
// attachments[1] corresponds to t-2/b
// attachments[2] corresponds to t-3/c
```

### Caching Strategy

- **Cache Duration**: 5 minutes (300 seconds)
- **Cache Key**: Based on sorted request parameters
- **Cache Invalidation**: Automatic on attachment updates
- **Cache Benefits**: Repeated dashboard loads, analysis views

## Notes

### Prerequisites
- Database connection required (no Redis-only fallback)
- All requested attachments must exist (fails on missing)

### Limitations
- Maximum 100 attachments per batch
- No support for wildcards or pattern matching
- Returns full attachment data (no field selection)

### Best Practices
- Use for loading multiple attachments (3+ recommended)
- Implement graceful error handling for missing attachments
- Consider caching results for frequently accessed batches
- Group related attachment requests together

## Related

- [Attachments System Overview](../attachments) - Comprehensive attachment system documentation
- [task.create_attachment](./create_attachment) - Create or update attachments
- [task.get_attachment](./get_attachment) - Retrieve single attachment
- [task.list_attachments](./list_attachments) - List and filter attachments