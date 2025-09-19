import type { Plugin, LoadContext } from '@docusaurus/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { globby } from 'globby';

interface DocMetadata {
	id: string;
	title: string;
	description: string;
	category: string;
	tags: string[];
	sidebar_position: number;
	path: string;
	content: string;
	frontmatter: Record<string, any>;
	lastModified: string;
}

interface PluginOptions {
	docsDir?: string;
	apiPath?: string;
	includeContent?: boolean;
}

interface PluginContent {
	docs: DocMetadata[];
	categorized: Record<string, DocMetadata[]>;
	categories: string[];
}

export default function docsApiPlugin(
	context: LoadContext,
	options: PluginOptions = {}
): Plugin<PluginContent> {
	const { siteDir, generatedFilesDir } = context;
	const docsDir = options.docsDir || path.join(siteDir, 'docs');
	const includeContent = options.includeContent !== false;

	return {
		name: 'docusaurus-plugin-json-api',

		async loadContent(): Promise<PluginContent> {
			// Find all markdown files
			const files = await globby(['**/*.{md,mdx}'], {
				cwd: docsDir,
				ignore: ['**/node_modules/**'],
			});

			const docs = await Promise.all(
				files.map(async (file): Promise<DocMetadata> => {
					const fullPath = path.join(docsDir, file);
					const content = await fs.readFile(fullPath, 'utf-8');
					const { data: frontmatter, content: body } = matter(content);
					
					// Generate ID from file path
					const id = file
						.replace(/\.(md|mdx)$/, '')
						.replace(/\\/g, '/')
						.replace(/^index$/, '')
						.replace(/\/index$/, '');

					// Extract categories from path
					const pathParts = id.split('/');
					const category = pathParts.length > 1 ? pathParts[0] : 'general';
					
					// Get file stats
					const stats = await fs.stat(fullPath);
					
					return {
						id,
						title: frontmatter.title || pathParts[pathParts.length - 1],
						description: frontmatter.description || '',
						category,
						tags: frontmatter.tags || [],
						sidebar_position: frontmatter.sidebar_position || 999,
						path: `/${id}`,
						content: includeContent ? body : '',
						frontmatter,
						lastModified: stats.mtime.toISOString(),
					};
				})
			);

			// Group by category
			const categorized = docs.reduce<Record<string, DocMetadata[]>>((acc, doc) => {
				if (!acc[doc.category]) {
					acc[doc.category] = [];
				}
				acc[doc.category].push(doc);
				return acc;
			}, {});

			// Sort docs within each category
			Object.keys(categorized).forEach(category => {
				categorized[category].sort((a, b) => {
					// First sort by sidebar_position
					if (a.sidebar_position !== b.sidebar_position) {
						return a.sidebar_position - b.sidebar_position;
					}
					// Then by title
					return a.title.localeCompare(b.title);
				});
			});

			return {
				docs,
				categorized,
				categories: Object.keys(categorized).sort(),
			};
		},

		async contentLoaded({ content, actions }): Promise<void> {
			const { createData, setGlobalData } = actions;
			
			// Create JSON files for API access
			await createData('docs.json', JSON.stringify(content.docs, null, 2));
			await createData('categories.json', JSON.stringify(content.categorized, null, 2));
			await createData('index.json', JSON.stringify({
				total: content.docs.length,
				categories: content.categories,
				lastUpdated: new Date().toISOString(),
			}, null, 2));

			// Set global data for client access
			setGlobalData({
				docsApi: {
					total: content.docs.length,
					categories: content.categories,
				},
			});
		},

		async postBuild({ outDir, content }): Promise<void> {
			if (!content) return;
			
			// Copy API files to build output
			const apiDir = path.join(outDir, 'api', 'docs');
			await fs.mkdir(apiDir, { recursive: true });

			// Create endpoint files
			await fs.writeFile(
				path.join(apiDir, 'index.json'),
				JSON.stringify({
					version: '1.0.0',
					total: content.docs.length,
					categories: content.categories,
					endpoints: {
						list: '/api/docs/list.json',
						categories: '/api/docs/categories.json',
						search: '/api/docs/search',
						get: '/api/docs/{id}',
					},
					schema: {
						doc: {
							id: 'string',
							title: 'string',
							description: 'string',
							category: 'string',
							tags: 'string[]',
							path: 'string',
							content: 'string?',
							lastModified: 'ISO8601',
						},
					},
				}, null, 2)
			);

			// Create list endpoint
			await fs.writeFile(
				path.join(apiDir, 'list.json'),
				JSON.stringify(content.docs.map(doc => ({
					id: doc.id,
					title: doc.title,
					description: doc.description,
					category: doc.category,
					path: doc.path,
					tags: doc.tags,
					lastModified: doc.lastModified,
				})), null, 2)
			);

			// Create categories endpoint
			await fs.writeFile(
				path.join(apiDir, 'categories.json'),
				JSON.stringify(
					Object.entries(content.categorized).reduce<Record<string, any[]>>((acc, [category, docs]) => {
						acc[category] = docs.map(doc => ({
							id: doc.id,
							title: doc.title,
							description: doc.description,
							path: doc.path,
						}));
						return acc;
					}, {}),
					null,
					2
				)
			);

			// Create individual doc endpoints
			const docsDir = path.join(apiDir, 'docs');
			await fs.mkdir(docsDir, { recursive: true });
			
			for (const doc of content.docs) {
				const docPath = path.join(docsDir, `${doc.id.replace(/\//g, '_')}.json`);
				await fs.writeFile(docPath, JSON.stringify(doc, null, 2));
			}

			console.log(`✅ Generated API for ${content.docs.length} documents`);
			console.log(`   API available at: /api/docs/`);
		},

		configureWebpack() {
			return {
				resolve: {
					fallback: {
						fs: false,
						path: require('path-browserify'),
					},
				},
			};
		},
	};
};