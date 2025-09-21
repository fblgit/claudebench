// Task domain handlers - transformed to distributed pull model
export * from "./task.create.handler";
export * from "./task.update.handler";
export * from "./task.assign.handler"; // Backward compat wrapper
export * from "./task.claim.handler";  // NEW pull model
export * from "./task.complete.handler";
export * from "./task.list.handler";   // NEW list/query handler
export * from "./task.delete.handler";  // NEW delete handler
export * from "./task.context.handler"; // NEW context generation
export * from "./task.decompose.handler"; // NEW decompose handler
export * from "./task.create_project.handler"; // NEW project creation

// Task attachment handlers - key-value store for tasks
export * from "./task.create_attachment.handler";
export * from "./task.list_attachments.handler";
export * from "./task.get_attachment.handler";
export * from "./task.get_attachments_batch.handler";