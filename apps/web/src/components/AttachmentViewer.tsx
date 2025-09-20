import { useState, useEffect } from "react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { html as diff2html } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import "./AttachmentViewer.css";
import { CodeViewer } from "./CodeEditor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
	FileJson,
	FileText,
	Link,
	Binary,
	Download,
	ExternalLink,
	Copy,
	CheckCircle,
	Hash,
	Calendar,
	User,
	Database,
	Paperclip,
	GitCommit,
	GitBranch,
	FileCode,
	Plus,
	Minus,
	FileDiff,
	Target,
	BookOpen,
	CheckSquare,
	AlertCircle,
	Sparkles,
	Eye,
	Code,
	Clock,
	Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Attachment {
	id: string;
	taskId: string;
	key: string;
	type: "json" | "markdown" | "text" | "url" | "binary";
	value?: any;
	content?: string;
	url?: string;
	size?: number;
	mimeType?: string;
	createdBy?: string;
	createdAt: string;
	updatedAt?: string;
}

interface AttachmentViewerProps {
	taskId: string;
	className?: string;
}

export function AttachmentViewer({ taskId, className }: AttachmentViewerProps) {
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
	const [diffViewMode, setDiffViewMode] = useState<'line-by-line' | 'side-by-side'>('line-by-line');

	useEffect(() => {
		fetchAttachments();
	}, [taskId]);

	const fetchAttachments = async () => {
		setLoading(true);
		setError(null);
		
		try {
			const response = await fetch("/rpc", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					method: "task.list_attachments",
					params: { taskId },
					id: Date.now(),
				}),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const text = await response.text();
			if (!text) {
				throw new Error("Empty response from server");
			}

			let data;
			try {
				data = JSON.parse(text);
			} catch (parseError) {
				console.error("Failed to parse response:", text);
				throw new Error("Invalid JSON response from server");
			}
			
			if (data.error) {
				throw new Error(data.error.message || "Failed to fetch attachments");
			}

			setAttachments(data.result.attachments || []);
			if (data.result.attachments?.length > 0) {
				setSelectedAttachment(data.result.attachments[0]);
			}
		} catch (err) {
			console.error("Failed to fetch attachments:", err);
			setError(err instanceof Error ? err.message : "Failed to fetch attachments");
		} finally {
			setLoading(false);
		}
	};

	const getTypeIcon = (attachment: Attachment) => {
		// Check for special attachment types by key pattern
		if (attachment.key.startsWith("git-commit-") || attachment.key.startsWith("git_commit_")) {
			return <GitCommit className="h-4 w-4" />;
		}
		if (attachment.key.startsWith("context_")) {
			return <Sparkles className="h-4 w-4" />;
		}
		
		switch (attachment.type) {
			case "json":
				return <FileJson className="h-4 w-4" />;
			case "markdown":
			case "text":
				return <FileText className="h-4 w-4" />;
			case "url":
				return <Link className="h-4 w-4" />;
			case "binary":
				return <Binary className="h-4 w-4" />;
			default:
				return <Paperclip className="h-4 w-4" />;
		}
	};

	const getTypeColor = (attachment: Attachment) => {
		// Check for special attachment types by key pattern
		if (attachment.key.startsWith("git-commit-") || attachment.key.startsWith("git_commit_")) {
			return "bg-amber-500/10 text-amber-600 border-amber-500/20";
		}
		if (attachment.key.startsWith("context_")) {
			return "bg-violet-500/10 text-violet-600 border-violet-500/20";
		}
		
		switch (attachment.type) {
			case "json":
				return "bg-blue-500/10 text-blue-600 border-blue-500/20";
			case "markdown":
				return "bg-purple-500/10 text-purple-600 border-purple-500/20";
			case "text":
				return "bg-gray-500/10 text-gray-600 border-gray-500/20";
			case "url":
				return "bg-green-500/10 text-green-600 border-green-500/20";
			case "binary":
				return "bg-orange-500/10 text-orange-600 border-orange-500/20";
			default:
				return "bg-gray-500/10 text-gray-600 border-gray-500/20";
		}
	};

	const copyToClipboard = async (text: string, key: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(key);
			setTimeout(() => setCopied(null), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	// Render formatted view for git commit attachments
	const renderGitCommitFormatted = (attachment: Attachment) => {
		if (!attachment.value) return null;
		
		const data = typeof attachment.value === "string" 
			? JSON.parse(attachment.value) 
			: attachment.value;
		
		return (
			<div className="space-y-4">
				{/* Commit Header */}
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-sm font-medium flex items-center gap-2">
							<GitCommit className="h-4 w-4" />
							Commit Information
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<div className="text-xs text-muted-foreground mb-1">Commit Hash</div>
								<code className="text-sm font-mono bg-muted px-2 py-1 rounded">
									{data.commitHash}
								</code>
							</div>
							<div>
								<div className="text-xs text-muted-foreground mb-1">Branch</div>
								<div className="flex items-center gap-1">
									<GitBranch className="h-3 w-3" />
									<code className="text-sm font-mono bg-muted px-2 py-1 rounded">
										{data.branch}
									</code>
								</div>
							</div>
						</div>
						
						{data.timestamp && (
							<div>
								<div className="text-xs text-muted-foreground mb-1">Committed</div>
								<div className="text-sm flex items-center gap-2">
									<Clock className="h-3 w-3" />
									{format(new Date(data.timestamp), "PPp")}
									<span className="text-muted-foreground">
										({formatDistanceToNow(new Date(data.timestamp), { addSuffix: true })})
									</span>
								</div>
							</div>
						)}

						{data.toolUsed && (
							<div>
								<div className="text-xs text-muted-foreground mb-1">Tool Used</div>
								<Badge variant="secondary">
									<Package className="h-3 w-3 mr-1" />
									{data.toolUsed}
								</Badge>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Files Changed */}
				{data.files && data.files.length > 0 && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<FileCode className="h-4 w-4" />
								Files Changed ({data.files.length})
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="space-y-2">
								{data.files.map((file: string, idx: number) => (
									<div key={idx} className="flex items-center gap-2">
										<FileCode className="h-3 w-3 text-muted-foreground" />
										<code className="text-sm font-mono">{file}</code>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Stats */}
				{data.stats && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<FileDiff className="h-4 w-4" />
								Change Statistics
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex gap-6">
								<div className="flex items-center gap-2">
									<Plus className="h-4 w-4 text-green-500" />
									<span className="text-sm">
										<span className="font-mono font-semibold text-green-600">+{data.stats.additions}</span>
										<span className="text-muted-foreground ml-1">additions</span>
									</span>
								</div>
								<div className="flex items-center gap-2">
									<Minus className="h-4 w-4 text-red-500" />
									<span className="text-sm">
										<span className="font-mono font-semibold text-red-600">-{data.stats.deletions}</span>
										<span className="text-muted-foreground ml-1">deletions</span>
									</span>
								</div>
								<div className="flex items-center gap-2">
									<FileCode className="h-4 w-4 text-blue-500" />
									<span className="text-sm">
										<span className="font-mono font-semibold text-blue-600">{data.stats.filesChanged}</span>
										<span className="text-muted-foreground ml-1">files</span>
									</span>
								</div>
							</div>
						</CardContent>
					</Card>
				)}

				{/* Diff */}
				{data.diff && (
					<Card>
						<CardHeader className="pb-3">
							<div className="flex items-center justify-between">
								<CardTitle className="text-sm font-medium flex items-center gap-2">
									<FileDiff className="h-4 w-4" />
									Diff
								</CardTitle>
								<div className="flex gap-1">
									<Button
										size="sm"
										variant={diffViewMode === 'line-by-line' ? 'default' : 'outline'}
										onClick={() => setDiffViewMode('line-by-line')}
										className="h-7 text-xs"
									>
										Unified
									</Button>
									<Button
										size="sm"
										variant={diffViewMode === 'side-by-side' ? 'default' : 'outline'}
										onClick={() => setDiffViewMode('side-by-side')}
										className="h-7 text-xs"
									>
										Split
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent className="p-0">
							<div 
								className="diff2html-wrapper p-4 overflow-x-auto"
								style={{
									maxHeight: '600px',
									overflowY: 'auto'
								}}
								dangerouslySetInnerHTML={{ 
									__html: diff2html(data.diff, {
										drawFileList: false,
										matching: 'lines',
										outputFormat: diffViewMode,
										renderNothingWhenEmpty: false,
										maxLines: 1000
									})
								}}
							/>
						</CardContent>
					</Card>
				)}

				{/* Commit Message */}
				{data.commitMessage && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium">Commit Message Details</CardTitle>
						</CardHeader>
						<CardContent className="p-0">
							<CodeViewer
								value={typeof data.commitMessage === "string" 
									? data.commitMessage 
									: JSON.stringify(data.commitMessage, null, 2)}
								language="json"
								height="200px"
								minimap={false}
								lineNumbers="off"
								folding={true}
								wordWrap="on"
							/>
						</CardContent>
					</Card>
				)}
			</div>
		);
	};

	// Render formatted view for context attachments
	const renderContextFormatted = (attachment: Attachment) => {
		if (!attachment.value) return null;
		
		const data = typeof attachment.value === "string" 
			? JSON.parse(attachment.value) 
			: attachment.value;
		
		const context = data.context || data;
		
		return (
			<div className="space-y-4">
				{/* Context Header */}
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-sm font-medium flex items-center gap-2">
							<Sparkles className="h-4 w-4" />
							Context Information
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{context.taskId && (
							<div>
								<div className="text-xs text-muted-foreground mb-1">Task ID</div>
								<code className="text-sm font-mono bg-muted px-2 py-1 rounded">
									{context.taskId}
								</code>
							</div>
						)}
						
						{data.specialist && (
							<div>
								<div className="text-xs text-muted-foreground mb-1">Specialist</div>
								<Badge variant="secondary">
									<User className="h-3 w-3 mr-1" />
									{data.specialist}
								</Badge>
							</div>
						)}

						{data.generatedAt && (
							<div>
								<div className="text-xs text-muted-foreground mb-1">Generated</div>
								<div className="text-sm flex items-center gap-2">
									<Clock className="h-3 w-3" />
									{format(parseISO(data.generatedAt), "PPp")}
									<span className="text-muted-foreground">
										({formatDistanceToNow(parseISO(data.generatedAt), { addSuffix: true })})
									</span>
								</div>
							</div>
						)}

						{data.generatedBy && (
							<div>
								<div className="text-xs text-muted-foreground mb-1">Generated By</div>
								<div className="text-sm flex items-center gap-1">
									<User className="h-3 w-3" />
									{data.generatedBy}
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Description and Scope */}
				{(context.description || context.scope) && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<BookOpen className="h-4 w-4" />
								Overview
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3">
							{context.description && (
								<div>
									<div className="text-xs text-muted-foreground mb-1">Description</div>
									<p className="text-sm leading-relaxed">{context.description}</p>
								</div>
							)}
							{context.scope && (
								<div>
									<div className="text-xs text-muted-foreground mb-1">Scope</div>
									<p className="text-sm leading-relaxed text-muted-foreground">{context.scope}</p>
								</div>
							)}
						</CardContent>
					</Card>
				)}

				{/* Constraints */}
				{context.constraints && context.constraints.length > 0 && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<AlertCircle className="h-4 w-4" />
								Constraints ({context.constraints.length})
							</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="space-y-2">
								{context.constraints.map((constraint: string, idx: number) => (
									<li key={idx} className="flex items-start gap-2">
										<div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
										<span className="text-sm">{constraint}</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}

				{/* Requirements */}
				{context.requirements && context.requirements.length > 0 && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<Target className="h-4 w-4" />
								Requirements ({context.requirements.length})
							</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="space-y-2">
								{context.requirements.map((req: string, idx: number) => (
									<li key={idx} className="flex items-start gap-2">
										<div className="h-1.5 w-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
										<span className="text-sm">{req}</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}

				{/* Architecture Constraints */}
				{context.architectureConstraints && context.architectureConstraints.length > 0 && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<Package className="h-4 w-4" />
								Architecture Constraints ({context.architectureConstraints.length})
							</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="space-y-2">
								{context.architectureConstraints.map((constraint: string, idx: number) => (
									<li key={idx} className="flex items-start gap-2">
										<div className="h-1.5 w-1.5 rounded-full bg-purple-500 mt-1.5 flex-shrink-0" />
										<span className="text-sm">{constraint}</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}

				{/* Mandatory Readings */}
				{context.mandatoryReadings && context.mandatoryReadings.length > 0 && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<BookOpen className="h-4 w-4" />
								Mandatory Readings ({context.mandatoryReadings.length})
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{context.mandatoryReadings.map((reading: any, idx: number) => (
									<div key={idx} className="border-l-2 border-muted pl-3">
										<div className="text-sm font-medium">{reading.path}</div>
										{reading.reason && (
											<div className="text-xs text-muted-foreground mt-1">
												{reading.reason}
											</div>
										)}
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{/* Success Criteria */}
				{context.successCriteria && context.successCriteria.length > 0 && (
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm font-medium flex items-center gap-2">
								<CheckSquare className="h-4 w-4" />
								Success Criteria ({context.successCriteria.length})
							</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="space-y-2">
								{context.successCriteria.map((criteria: string, idx: number) => (
									<li key={idx} className="flex items-start gap-2">
										<CheckCircle className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
										<span className="text-sm">{criteria}</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}
			</div>
		);
	};

	const renderAttachmentContent = (attachment: Attachment) => {
		// Check if this is a special attachment type that needs tabbed view
		const isGitCommit = attachment.key.startsWith("git-commit-") || attachment.key.startsWith("git_commit_");
		const isContext = attachment.key.startsWith("context_");
		const isSpecialAttachment = isGitCommit || isContext;

		// For special attachments (git commits and context), show tabbed view
		if (isSpecialAttachment && attachment.type === "json" && attachment.value) {
			return (
				<Tabs defaultValue="formatted" className="w-full">
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="formatted">
							<Eye className="h-4 w-4 mr-2" />
							Formatted
						</TabsTrigger>
						<TabsTrigger value="raw">
							<Code className="h-4 w-4 mr-2" />
							Raw JSON
						</TabsTrigger>
					</TabsList>
					
					<TabsContent value="formatted" className="mt-4">
						<ScrollArea className="h-[600px] pr-4">
							{isGitCommit && renderGitCommitFormatted(attachment)}
							{isContext && renderContextFormatted(attachment)}
						</ScrollArea>
					</TabsContent>
					
					<TabsContent value="raw" className="mt-4">
						<div className="border rounded-lg overflow-hidden">
							<CodeViewer
								value={typeof attachment.value === "string" 
									? attachment.value 
									: JSON.stringify(attachment.value, null, 2)}
								language="json"
								height="600px"
								minimap={false}
								lineNumbers="on"
								folding={true}
								wordWrap="on"
							/>
						</div>
					</TabsContent>
				</Tabs>
			);
		}

		// URL attachments
		if (attachment.type === "url" && attachment.url) {
			return (
				<div className="space-y-4">
					<div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
						<a
							href={attachment.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-blue-600 hover:underline flex items-center gap-2"
						>
							<ExternalLink className="h-4 w-4" />
							{attachment.url}
						</a>
						<Button
							size="sm"
							variant="outline"
							onClick={() => copyToClipboard(attachment.url!, attachment.key)}
						>
							{copied === attachment.key ? (
								<CheckCircle className="h-4 w-4 text-green-500" />
							) : (
								<Copy className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>
			);
		}

		// Regular JSON attachments
		if (attachment.type === "json" && attachment.value) {
			const jsonString = typeof attachment.value === "string" 
				? attachment.value 
				: JSON.stringify(attachment.value, null, 2);
			
			return (
				<div className="border rounded-lg overflow-hidden">
					<CodeViewer
						value={jsonString}
						language="json"
						height="600px"
						minimap={false}
						lineNumbers="on"
						folding={true}
						wordWrap="on"
					/>
				</div>
			);
		}

		// Markdown or text attachments
		if ((attachment.type === "markdown" || attachment.type === "text") && attachment.content) {
			return (
				<div className="border rounded-lg overflow-hidden">
					<CodeViewer
						value={attachment.content}
						language={attachment.type === "markdown" ? "markdown" : "plaintext"}
						height="600px"
						minimap={false}
						lineNumbers={attachment.type === "markdown" ? "off" : "on"}
						folding={true}
						wordWrap="on"
					/>
				</div>
			);
		}

		// Binary attachments
		if (attachment.type === "binary") {
			return (
				<div className="p-4 bg-muted/50 rounded-lg space-y-2">
					<p className="text-sm text-muted-foreground">Binary attachment</p>
					{attachment.mimeType && (
						<p className="text-sm">
							<span className="font-medium">MIME Type:</span> {attachment.mimeType}
						</p>
					)}
					{attachment.size && (
						<p className="text-sm">
							<span className="font-medium">Size:</span> {attachment.size} bytes
						</p>
					)}
				</div>
			);
		}

		return (
			<div className="p-4 bg-muted/50 rounded-lg">
				<p className="text-sm text-muted-foreground">No content available</p>
			</div>
		);
	};

	if (loading) {
		return (
			<div className={cn("space-y-4", className)}>
				<Skeleton className="h-32 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	if (error) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="text-sm text-red-600">Error</CardTitle>
					<CardDescription>{error}</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (attachments.length === 0) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="text-sm font-medium text-muted-foreground">
						<Paperclip className="h-4 w-4 inline mr-2" />
						No Attachments
					</CardTitle>
					<CardDescription>
						This task doesn't have any attachments yet
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<div className={cn("grid grid-cols-4 gap-4", className)}>
			{/* Attachment List */}
			<div className="col-span-1">
				<Card className="h-full">
					<CardHeader className="pb-3">
						<CardTitle className="text-sm font-medium">
							Attachments ({attachments.length})
						</CardTitle>
					</CardHeader>
					<CardContent className="p-0">
						<ScrollArea className="h-[600px]">
							<div className="space-y-1 p-3">
								{attachments.map((attachment) => (
									<button
										key={attachment.id}
										onClick={() => setSelectedAttachment(attachment)}
										className={cn(
											"w-full text-left p-3 rounded-lg transition-colors",
											"hover:bg-muted/50",
											selectedAttachment?.id === attachment.id && "bg-muted"
										)}
									>
										<div className="space-y-2">
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													{getTypeIcon(attachment)}
													<span className="font-medium text-sm truncate">
														{attachment.key}
													</span>
												</div>
												<Badge 
													variant="outline" 
													className={cn("text-xs", getTypeColor(attachment))}
												>
													{attachment.type}
												</Badge>
											</div>
											<div className="flex items-center gap-4 text-xs text-muted-foreground">
												<span className="flex items-center gap-1">
													<Calendar className="h-3 w-3" />
													{format(parseISO(attachment.createdAt), "MMM d, HH:mm")}
												</span>
												{attachment.createdBy && (
													<span className="flex items-center gap-1">
														<User className="h-3 w-3" />
														{attachment.createdBy}
													</span>
												)}
											</div>
										</div>
									</button>
								))}
							</div>
						</ScrollArea>
					</CardContent>
				</Card>
			</div>

			{/* Attachment Content */}
			<div className="col-span-3">
				{selectedAttachment ? (
					<Card className="h-full">
						<CardHeader>
							<div className="flex items-start justify-between">
								<div>
									<CardTitle className="flex items-center gap-2">
										{getTypeIcon(selectedAttachment)}
										{selectedAttachment.key}
									</CardTitle>
									<CardDescription className="mt-2">
										<div className="flex items-center gap-4 text-xs">
											<span className="flex items-center gap-1">
												<Hash className="h-3 w-3" />
												{selectedAttachment.id}
											</span>
											<span className="flex items-center gap-1">
												<Calendar className="h-3 w-3" />
												{format(parseISO(selectedAttachment.createdAt), "PPp")}
											</span>
										</div>
									</CardDescription>
								</div>
								<Badge 
									variant="outline" 
									className={cn("text-xs", getTypeColor(selectedAttachment))}
								>
									{selectedAttachment.type}
								</Badge>
							</div>
						</CardHeader>
						<CardContent>
							{renderAttachmentContent(selectedAttachment)}
						</CardContent>
					</Card>
				) : (
					<Card className="h-full flex items-center justify-center">
						<CardContent>
							<p className="text-muted-foreground">Select an attachment to view</p>
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}