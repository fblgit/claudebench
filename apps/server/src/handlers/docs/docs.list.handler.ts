import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { docsListInput, docsListOutput } from "@/schemas/docs.schema";
import type { DocsListInput, DocsListOutput } from "@/schemas/docs.schema";
import { readFile } from "fs/promises";
import { join } from "path";

@EventHandler({
	event: "docs.list",
	inputSchema: docsListInput,
	outputSchema: docsListOutput,
	persist: false,
	rateLimit: 100,
	description: "List all documentation with metadata and filtering",
})
export class DocsListHandler {
	@Instrumented(300) // Cache for 5 minutes
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				docs: [],
				totalCount: 0,
				categories: [],
			})
		}
	})
	async handle(input: DocsListInput, ctx: EventContext): Promise<DocsListOutput> {
		try {
			// Read the generated docs JSON files
			const docsPath = join(process.cwd(), "../..", "docs", ".docusaurus", "docusaurus-plugin-json-api", "default");
			
			// Read the main docs list
			const docsData = await readFile(join(docsPath, "docs.json"), "utf-8");
			const allDocs = JSON.parse(docsData);
			
			// Read categories
			const categoriesData = await readFile(join(docsPath, "categories.json"), "utf-8");
			const categorized = JSON.parse(categoriesData);
			const categories = Object.keys(categorized).sort();
			
			// Filter by category if specified
			let filteredDocs = allDocs;
			if (input.category) {
				filteredDocs = allDocs.filter((doc: any) => doc.category === input.category);
			}
			
			// Apply pagination
			const offset = input.offset || 0;
			const limit = input.limit || 50;
			const paginatedDocs = filteredDocs.slice(offset, offset + limit);
			
			// Transform to output format (exclude content for list view)
			const docs = paginatedDocs.map((doc: any) => ({
				id: doc.id,
				title: doc.title,
				description: doc.description,
				category: doc.category,
				path: doc.path,
				tags: doc.tags || [],
				lastModified: doc.lastModified,
			}));
			
			return {
				docs,
				totalCount: filteredDocs.length,
				categories,
			};
		} catch (error) {
			// If docs haven't been built yet, return empty result
			console.error("Error reading documentation:", error);
			return {
				docs: [],
				totalCount: 0,
				categories: [],
			};
		}
	}
}