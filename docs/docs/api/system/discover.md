# system.discover

Discover available methods and their schemas.

## Method

`system.discover`

## Description

Provides dynamic discovery of all available ClaudeBench handler methods and their input/output schemas. This introspection method allows clients to understand the available API surface, validate parameters, and build dynamic interfaces. Converts Zod schemas to JSON Schema format for interoperability.

⚠️ **Development Tool**: Primarily intended for development, testing, and dynamic client generation - not typically used in production workflows.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `domain` | `string` | No | Optional filter to return only methods from a specific domain (e.g., "task", "system", "hook") |

## Response

| Name | Type | Description |
|------|------|-------------|
| `methods` | `array` | Array of available method definitions with schemas and metadata |

### Method Object Structure

| Name | Type | Description |
|------|------|-------------|
| `name` | `string` | Method name in `domain.action` format |
| `description` | `string` | Human-readable description of method functionality |
| `inputSchema` | `object` | JSON Schema representation of input parameters |
| `outputSchema` | `object` | JSON Schema representation of response structure |
| `metadata` | `object` | Method configuration and constraints |

### Metadata Object Structure

| Name | Type | Description |
|------|------|-------------|
| `persist` | `boolean` | Whether method results are persisted to PostgreSQL |
| `rateLimit` | `number` | Maximum calls per minute |
| `roles` | `array` | Required instance roles to call this method |

## JSON-RPC Request Example

### All Methods
```json
{
  "jsonrpc": "2.0",
  "method": "system.discover",
  "params": {},
  "id": "discover-all-1"
}
```

### Filtered by Domain
```json
{
  "jsonrpc": "2.0",
  "method": "system.discover", 
  "params": {
    "domain": "task"
  },
  "id": "discover-task-1"
}
```

## JSON-RPC Response Example

### Partial Response (Filtered)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "methods": [
      {
        "name": "task.create",
        "description": "Create a new task and add it to the queue",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "priority": {
              "type": "number",
              "minimum": 0,
              "maximum": 100
            },
            "metadata": {
              "type": "object"
            }
          },
          "required": ["text"]
        },
        "outputSchema": {
          "type": "object", 
          "properties": {
            "id": {
              "type": "string"
            },
            "status": {
              "type": "string",
              "enum": ["pending", "in_progress", "completed", "failed"]
            },
            "createdAt": {
              "type": "string"
            }
          },
          "required": ["id", "status", "createdAt"]
        },
        "metadata": {
          "persist": true,
          "rateLimit": 100,
          "roles": ["worker"]
        }
      },
      {
        "name": "task.update",
        "description": "Update an existing task",
        "inputSchema": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1
            },
            "updates": {
              "type": "object",
              "properties": {
                "status": {
                  "type": "string",
                  "enum": ["pending", "in_progress", "completed", "failed"]
                },
                "text": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "priority": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 100
                },
                "metadata": {
                  "type": "object"
                }
              }
            }
          },
          "required": ["id", "updates"]
        },
        "outputSchema": {
          "type": "object",
          "properties": {
            "updated": {
              "type": "boolean"
            }
          },
          "required": ["updated"]
        },
        "metadata": {
          "persist": true,
          "rateLimit": 100
        }
      }
    ]
  },
  "id": "discover-task-1"
}
```

## Schema Conversion

The method converts Zod schemas to JSON Schema using these mappings:

### Basic Types
- `ZodString` → `{"type": "string"}` (with minLength, maxLength if specified)
- `ZodNumber` → `{"type": "number"}` (with minimum, maximum if specified)  
- `ZodBoolean` → `{"type": "boolean"}`
- `ZodAny` → `{"type": "any"}`

### Complex Types
- `ZodObject` → `{"type": "object", "properties": {...}, "required": [...]}`
- `ZodArray` → `{"type": "array", "items": {...}}`
- `ZodEnum` → `{"type": "string", "enum": [...]}`
- `ZodOptional` → Adds `"optional": true` to the wrapped schema
- `ZodUnion` → `{"oneOf": [...]}`
- `ZodLiteral` → `{"const": value}`

### Schema Example
Original Zod Schema:
```typescript
z.object({
  name: z.string().min(1).max(100),
  age: z.number().min(0).max(150),
  active: z.boolean().optional(),
  tags: z.array(z.string()),
  role: z.enum(["admin", "user"])
})
```

Converted JSON Schema:
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "age": {
      "type": "number", 
      "minimum": 0,
      "maximum": 150
    },
    "active": {
      "type": "boolean",
      "optional": true
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "role": {
      "type": "string",
      "enum": ["admin", "user"]
    }
  },
  "required": ["name", "age", "tags", "role"]
}
```

## Domain Filtering

Available domains include:

- **`task`** - Task management operations
- **`system`** - System administration and monitoring
- **`hook`** - Lifecycle hooks and event handling  
- **`mcp`** - Model Context Protocol operations
- **`swarm`** - Distributed swarm intelligence (if enabled)

### Domain Examples

**Task Domain:**
- `task.create`
- `task.update` 
- `task.list`
- `task.complete`

**System Domain:**
- `system.health`
- `system.register`
- `system.metrics`
- `system.discover`

**Hook Domain:**
- `hook.pre_tool`
- `hook.post_tool`

## Registry Integration

The method queries the internal handler registry which maintains:
- **Handler metadata** from `@EventHandler` decorators
- **Schema definitions** from Zod validation
- **Runtime configuration** including rate limits and roles
- **Dynamic registration** of new handlers

## Prerequisites

- ClaudeBench system must be running with registered handlers
- Handler registry must be properly initialized
- Zod schemas must be well-formed for conversion

## Warnings

⚠️ **Rate Limiting**: Limited to 100 calls per minute for system stability

⚠️ **Schema Complexity**: Very complex Zod schemas may not convert perfectly to JSON Schema

⚠️ **Dynamic Changes**: Results reflect handlers registered at query time - may change as system evolves

⚠️ **Large Responses**: Systems with many handlers may return substantial response data

## Use Cases

### Client Code Generation
```javascript
const discovery = await client.call('system.discover');
// Generate TypeScript interfaces from schemas
generateTypes(discovery.result.methods);
```

### API Documentation
```javascript
const taskMethods = await client.call('system.discover', {domain: 'task'});
// Generate API documentation from method metadata
generateDocs(taskMethods.result.methods);
```

### Dynamic Validation
```javascript
const schema = discovery.methods.find(m => m.name === 'task.create').inputSchema;
// Use JSON Schema for client-side validation
const isValid = validateInput(userInput, schema);
```

### Runtime Introspection
```javascript
const systemMethods = await client.call('system.discover', {domain: 'system'});
// Discover available monitoring methods
const monitoringMethods = systemMethods.result.methods
  .filter(m => m.description.includes('monitor'));
```

## Related Methods

- [`system.health`](./health) - Check system health before discovery
- [`system.get_state`](./get_state) - Get current system state
- All discovered methods can be called using their `name` field