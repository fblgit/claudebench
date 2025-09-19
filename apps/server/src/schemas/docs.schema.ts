import { z } from "zod";

// docs.list - List all documentation with metadata
export const docsListInput = z.object({
	category: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(50).optional(),
	offset: z.number().int().min(0).default(0).optional(),
});

export const docsListOutput = z.object({
	docs: z.array(z.object({
		id: z.string(),
		title: z.string(),
		description: z.string(),
		category: z.string(),
		path: z.string(),
		tags: z.array(z.string()),
		lastModified: z.string().datetime(),
	})),
	totalCount: z.number(),
	categories: z.array(z.string()),
});

// docs.get - Get specific documentation content
export const docsGetInput = z.object({
	id: z.string().min(1),
});

export const docsGetOutput = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	category: z.string(),
	path: z.string(),
	tags: z.array(z.string()),
	content: z.string(),
	frontmatter: z.record(z.string(), z.unknown()),
	lastModified: z.string().datetime(),
	sidebar_position: z.number().optional(),
});

// Type exports
export type DocsListInput = z.infer<typeof docsListInput>;
export type DocsListOutput = z.infer<typeof docsListOutput>;
export type DocsGetInput = z.infer<typeof docsGetInput>;
export type DocsGetOutput = z.infer<typeof docsGetOutput>;