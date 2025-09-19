const fs = require('fs').promises;
const path = require('path');
const matter = require('gray-matter');
const { glob } = require('glob');

module.exports = function docsApiPlugin(context, options = {}) {
	const { siteDir, generatedFilesDir } = context;
	const docsDir = options.docsDir || path.join(siteDir, 'docs');
	const includeContent = options.includeContent !== false;

	return {
		name: 'docusaurus-plugin-json-api',

		async loadContent() {
			// Find all markdown files
			const files = await glob('**/*.{md,mdx}', {
				cwd: docsDir,
				ignore: ['**/node_modules/**'],
			});

			const docs = await Promise.all(
				files.map(async (file) => {
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
			const categorized = docs.reduce((acc, doc) => {
				if (!acc[doc.category]) {
					acc[doc.category] = [];
				}
				acc[doc.category].push(doc);
				return acc;
			}, {});

			// Sort docs within each category
			Object.keys(categorized).forEach(category => {
				categorized[category].sort((a, b) => {
					if (a.sidebar_position !== b.sidebar_position) {
						return a.sidebar_position - b.sidebar_position;
					}
					return a.title.localeCompare(b.title);
				});
			});

			return {
				docs,
				categorized,
				categories: Object.keys(categorized).sort(),
			};
		},

		async contentLoaded({ content, actions }) {
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

		async postBuild({ outDir, content }) {
			if (!content) return;
			
			// Copy API files to build output
			const apiDir = path.join(outDir, 'api', 'docs');
			await fs.mkdir(apiDir, { recursive: true });

			// Create main API index
			await fs.writeFile(
				path.join(apiDir, 'index.json'),
				JSON.stringify({
					version: '1.0.0',
					total: content.docs.length,
					categories: content.categories,
					endpoints: {
						list: '/api/docs/list.json',
						categories: '/api/docs/categories.json',
						get: '/api/docs/{id}.json',
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
					Object.entries(content.categorized).reduce((acc, [category, docs]) => {
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
			const docsDir = path.join(apiDir, 'documents');
			await fs.mkdir(docsDir, { recursive: true });
			
			for (const doc of content.docs) {
				const docPath = path.join(docsDir, `${doc.id.replace(/\//g, '_')}.json`);
				await fs.writeFile(docPath, JSON.stringify(doc, null, 2));
			}

			console.log(`✅ Generated JSON API for ${content.docs.length} documents`);
			console.log(`   Available at: /api/docs/`);
		},
	};
};