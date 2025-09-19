import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { docsGetInput, docsGetOutput } from "@/schemas/docs.schema";
import type { DocsGetInput, DocsGetOutput } from "@/schemas/docs.schema";
import { readFile } from "fs/promises";
import { join } from "path";

@EventHandler({
	event: "docs.get",
	inputSchema: docsGetInput,
	outputSchema: docsGetOutput,
	persist: false,
	rateLimit: 100,
	description: "Get specific documentation content by ID",
})
export class DocsGetHandler {
	@Instrumented(600) // Cache for 10 minutes
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => null
		}
	})
	async handle(input: DocsGetInput, ctx: EventContext): Promise<DocsGetOutput | null> {
		try {
			// Read the generated docs JSON files
			const docsPath = join(process.cwd(), "../..", "docs", ".docusaurus", "docusaurus-plugin-json-api", "default");
			
			// Try to read individual document file first (more efficient)
			const docFileName = `${input.id.replace(/\//g, "_")}.json`;
			const documentsPath = join(docsPath, "documents");
			
			try {
				const docData = await readFile(join(documentsPath, docFileName), "utf-8");
				const doc = JSON.parse(docData);
				
				return {
					id: doc.id,
					title: doc.title,
					description: doc.description,
					category: doc.category,
					path: doc.path,
					tags: doc.tags || [],
					content: doc.content || "",
					frontmatter: doc.frontmatter || {},
					lastModified: doc.lastModified,
					sidebar_position: doc.sidebar_position,
				};
			} catch (fileError) {
				// Fall back to searching in the main docs list
				const docsData = await readFile(join(docsPath, "docs.json"), "utf-8");
				const allDocs = JSON.parse(docsData);
				
				const doc = allDocs.find((d: any) => d.id === input.id);
				if (!doc) {
					throw new Error(`Document not found: ${input.id}`);
				}
				
				return {
					id: doc.id,
					title: doc.title,
					description: doc.description,
					category: doc.category,
					path: doc.path,
					tags: doc.tags || [],
					content: doc.content || "",
					frontmatter: doc.frontmatter || {},
					lastModified: doc.lastModified,
					sidebar_position: doc.sidebar_position,
				};
			}
		} catch (error) {
			console.error(`Error retrieving document ${input.id}:`, error);
			throw new Error(`Failed to retrieve document: ${input.id}`);
		}
	}
}