// Task domain handlers - transformed to distributed pull model
export * from "./task.create.handler";
export * from "./task.update.handler";
export * from "./task.assign.handler"; // Backward compat wrapper
export * from "./task.claim.handler";  // NEW pull model
export * from "./task.complete.handler";