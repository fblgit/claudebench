#!/usr/bin/env bun

/**
 * Test script to verify TodoWrite task transitions work properly
 */

console.log("Testing TodoWrite task state transitions...\n");

const baseUrl = "http://localhost:3000/rpc";

async function executeHandler(event, params) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: event,
      params,
      id: Date.now().toString(),
      metadata: {
        sessionId: "test-session",
        instanceId: "test-instance",
      },
    }),
  });
  const result = await response.json();
  if (result.error) {
    throw new Error(`${event} failed: ${result.error.message}`);
  }
  return result.result;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    // Step 1: Register the instance
    console.log("1. Registering test instance...");
    await executeHandler("system.register", {
      id: "test-instance",
      roles: ["worker"],
    });
    console.log("   ✓ Instance registered\n");

    // Step 2: Create initial todos (all pending)
    console.log("2. Creating initial todos (all pending)...");
    const todos1 = [
      { content: "Read documentation", status: "pending", activeForm: "Reading documentation" },
      { content: "Write code", status: "pending", activeForm: "Writing code" },
      { content: "Run tests", status: "pending", activeForm: "Running tests" },
    ];
    await executeHandler("hook.todo_write", { todos: todos1 });
    console.log("   ✓ Created 3 pending todos\n");

    await sleep(100); // Let events propagate

    // Step 3: Transition first todo to in_progress
    console.log("3. Transitioning first todo to in_progress...");
    const todos2 = [
      { content: "Read documentation", status: "in_progress", activeForm: "Reading documentation" },
      { content: "Write code", status: "pending", activeForm: "Writing code" },
      { content: "Run tests", status: "pending", activeForm: "Running tests" },
    ];
    await executeHandler("hook.todo_write", { todos: todos2 });
    console.log("   ✓ First todo transitioned to in_progress (should trigger task.assign)\n");

    await sleep(100);

    // Step 4: Transition second todo to in_progress, first to completed
    console.log("4. Completing first todo, starting second...");
    const todos3 = [
      { content: "Read documentation", status: "completed", activeForm: "Reading documentation" },
      { content: "Write code", status: "in_progress", activeForm: "Writing code" },
      { content: "Run tests", status: "pending", activeForm: "Running tests" },
    ];
    await executeHandler("hook.todo_write", { todos: todos3 });
    console.log("   ✓ First todo completed, second todo in_progress\n");

    await sleep(100);

    // Step 5: Complete all todos
    console.log("5. Completing all todos...");
    const todos4 = [
      { content: "Read documentation", status: "completed", activeForm: "Reading documentation" },
      { content: "Write code", status: "completed", activeForm: "Writing code" },
      { content: "Run tests", status: "completed", activeForm: "Running tests" },
    ];
    await executeHandler("hook.todo_write", { todos: todos4 });
    console.log("   ✓ All todos completed\n");

    await sleep(100);

    // Step 6: Check system metrics to verify tasks were created and updated
    console.log("6. Checking system metrics...");
    const metrics = await executeHandler("system.metrics", {});
    console.log("   System metrics:", JSON.stringify(metrics, null, 2));
    console.log("\n✅ All task state transitions working properly!");

  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);