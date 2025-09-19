import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Search, FileText, Folder, Clock, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/docs")({
	component: DocsComponent,
});

interface Doc {
	id: string;
	title: string;
	description: string;
	category: string;
	path: string;
	tags: string[];
	lastModified: string;
	content?: string;
}

interface DocsResponse {
	docs: Doc[];
	totalCount: number;
	categories: string[];
}

function DocsComponent() {
	const [docs, setDocs] = useState<Doc[]>([]);
	const [categories, setCategories] = useState<string[]>([]);
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Fetch docs list
	useEffect(() => {
		fetchDocs();
	}, [selectedCategory]);

	const fetchDocs = async () => {
		setLoading(true);
		setError(null);
		try {
			const body: any = {};
			if (selectedCategory !== "all") {
				body.category = selectedCategory;
			}
			
			const response = await fetch(`http://localhost:3000/docs/list`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch docs: ${response.statusText}`);
			}

			const result = await response.json();
			const data: DocsResponse = result.data;
			setDocs(data.docs);
			setCategories(["all", ...data.categories]);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load documentation");
			console.error("Error fetching docs:", err);
		} finally {
			setLoading(false);
		}
	};

	// Fetch individual doc content
	const fetchDocContent = async (docId: string) => {
		try {
			const response = await fetch(`http://localhost:3000/docs/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ id: docId }),
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch doc: ${response.statusText}`);
			}

			const result = await response.json();
			const data: Doc = result.data;
			setSelectedDoc(data);
		} catch (err) {
			console.error("Error fetching doc content:", err);
			setError(err instanceof Error ? err.message : "Failed to load document");
		}
	};

	// Filter docs based on search
	const filteredDocs = docs.filter(doc => 
		doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
		doc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
		doc.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
	);

	return (
		<div className="container mx-auto px-4 py-4 h-full flex flex-col">
			<div className="mb-4 flex-shrink-0">
				<h1 className="text-2xl font-bold">Documentation</h1>
				<p className="text-muted-foreground">
					Browse and search ClaudeBench documentation
				</p>
			</div>

			<div className="flex gap-4 flex-1 min-h-0">
				{/* Sidebar */}
				<div className="w-80 flex flex-col gap-4">
					{/* Search */}
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search docs..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-10"
						/>
					</div>

					{/* Categories */}
					<Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
						<TabsList className="grid grid-cols-2">
							{categories.slice(0, 4).map(cat => (
								<TabsTrigger key={cat} value={cat} className="capitalize">
									{cat}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>

					{/* Docs List */}
					<ScrollArea className="flex-1">
						<div className="space-y-2">
							{loading ? (
								<div className="text-center py-8 text-muted-foreground">
									Loading documentation...
								</div>
							) : error ? (
								<div className="text-center py-8 text-destructive">
									{error}
								</div>
							) : filteredDocs.length === 0 ? (
								<div className="text-center py-8 text-muted-foreground">
									No documentation found
								</div>
							) : (
								filteredDocs.map(doc => (
									<Card
										key={doc.id}
										className={cn(
											"cursor-pointer transition-colors hover:bg-muted/50",
											selectedDoc?.id === doc.id && "bg-muted"
										)}
										onClick={() => fetchDocContent(doc.id)}
									>
										<CardHeader className="pb-2">
											<div className="flex items-start justify-between">
												<FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
												<Badge variant="outline" className="text-xs">
													{doc.category}
												</Badge>
											</div>
											<CardTitle className="text-sm">{doc.title}</CardTitle>
											<CardDescription className="text-xs line-clamp-2">
												{doc.description}
											</CardDescription>
										</CardHeader>
										<CardContent className="pb-2">
											<div className="flex items-center gap-4 text-xs text-muted-foreground">
												<div className="flex items-center gap-1">
													<Clock className="h-3 w-3" />
													{new Date(doc.lastModified).toLocaleDateString()}
												</div>
												{doc.tags.length > 0 && (
													<div className="flex items-center gap-1">
														<Tag className="h-3 w-3" />
														{doc.tags.length}
													</div>
												)}
											</div>
										</CardContent>
									</Card>
								))
							)}
						</div>
					</ScrollArea>
				</div>

				{/* Content Area */}
				<Card className="flex-1 flex flex-col">
					{selectedDoc ? (
						<>
							<CardHeader>
								<div className="flex items-start justify-between">
									<div className="space-y-1">
										<CardTitle>{selectedDoc.title}</CardTitle>
										<CardDescription>{selectedDoc.description}</CardDescription>
									</div>
									<Badge>{selectedDoc.category}</Badge>
								</div>
								{selectedDoc.tags.length > 0 && (
									<div className="flex gap-1 flex-wrap pt-2">
										{selectedDoc.tags.map(tag => (
											<Badge key={tag} variant="secondary" className="text-xs">
												{tag}
											</Badge>
										))}
									</div>
								)}
							</CardHeader>
							<CardContent className="flex-1 overflow-auto">
								<div className="prose prose-sm dark:prose-invert max-w-none">
									{selectedDoc.content ? (
										<div dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedDoc.content) }} />
									) : (
										<p className="text-muted-foreground">Loading content...</p>
									)}
								</div>
							</CardContent>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-muted-foreground">
							<div className="text-center space-y-2">
								<Folder className="h-12 w-12 mx-auto opacity-50" />
								<p>Select a document to view</p>
							</div>
						</div>
					)}
				</Card>
			</div>
		</div>
	);
}

// Simple markdown renderer (you might want to use a proper markdown library)
function renderMarkdown(content: string): string {
	return content
		.replace(/^### (.*$)/gim, '<h3>$1</h3>')
		.replace(/^## (.*$)/gim, '<h2>$1</h2>')
		.replace(/^# (.*$)/gim, '<h1>$1</h1>')
		.replace(/^\* (.+)/gim, '<li>$1</li>')
		.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*]+)\*/g, '<em>$1</em>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/\n\n/g, '</p><p>')
		.replace(/^/, '<p>')
		.replace(/$/, '</p>');
}