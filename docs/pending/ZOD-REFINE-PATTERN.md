# Zod v4 Required Field Pattern

## The Problem

In Zod v4, both `z.any()` and `z.unknown()` make fields **optional** in object schemas, even though they appear to be required. This is counterintuitive but documented behavior.

```typescript
// This schema ACCEPTS objects missing the 'data' field!
const schema = z.object({
  id: z.string(),
  data: z.unknown()  // Field is actually optional!
});

schema.parse({ id: "123" }); // ✅ Passes (unexpected!)
schema.parse({ id: "123", data: null }); // ✅ Passes
schema.parse({ id: "123", data: "anything" }); // ✅ Passes
```

## The Solution

Use `.refine()` to enforce field presence when you need a required field that accepts any type:

```typescript
const schema = z.object({
  id: z.string(),
  data: z.unknown()
}).refine(data => 'data' in data, {
  message: "data field is required"
});

schema.parse({ id: "123" }); // ❌ Fails - data field is required
schema.parse({ id: "123", data: null }); // ✅ Passes
schema.parse({ id: "123", data: "anything" }); // ✅ Passes
```

## When to Use refine()

### ✅ DO use refine() when:
- Field must be **required** (not optional)
- Field uses `z.unknown()` or `z.any()`
- Contract specifies field is required with any type

### ❌ DON'T use refine() when:
- Field is explicitly `.optional()`
- Field is inside `z.record()` or `z.array()`
- Field has a specific type like `z.string()` or `z.number()`

## Current Usage in ClaudeBench

### Already Applied:
- `hookPreToolInput.params` - Required field accepting any params
- `hookPostToolInput.result` - Required field accepting any result
- `hookPostToolOutput.processed` - Required field accepting any processed value

### Correctly Optional (no refine needed):
- `jsonRpcRequest.params` - Optional per JSONRPC 2.0 spec
- `taskCompleteInput.result` - Optional result field
- `taskCreateInput.metadata` - Optional metadata
- All fields marked with `.optional()`

## Implementation Pattern

```typescript
// For single required field with any type
export const mySchema = z.object({
  requiredField: z.unknown(),
  optionalField: z.unknown().optional(), // No refine needed
}).refine(data => 'requiredField' in data, {
  message: "requiredField is required"
});

// For multiple required fields with any type
export const multiSchema = z.object({
  field1: z.unknown(),
  field2: z.unknown(),
}).refine(data => 'field1' in data && 'field2' in data, {
  message: "field1 and field2 are required"
});
```

## Testing

Always test that your schema:
1. Rejects objects missing the required field
2. Accepts objects with the field present (even if null)
3. Rejects objects with wrong field names

```typescript
// Test file example
it("should reject missing required field", () => {
  const result = schema.safeParse({ otherField: "value" });
  expect(result.success).toBe(false);
});

it("should accept field with null value", () => {
  const result = schema.safeParse({ requiredField: null });
  expect(result.success).toBe(true);
});
```

## Future Considerations

When upgrading Zod or if behavior changes, search for all uses of:
- `.refine(data => '` to find field existence checks
- `z.unknown()` and `z.any()` to verify behavior

This workaround may not be needed in future Zod versions if the behavior changes.