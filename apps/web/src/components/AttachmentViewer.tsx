import { useState, useEffect } from "react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
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

	const getTypeIcon = (type: string) => {
		switch (type) {
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

	const getTypeColor = (type: string) => {
		switch (type) {
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

	const renderAttachmentContent = (attachment: Attachment) => {
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
													{getTypeIcon(attachment.type)}
													<span className="font-medium text-sm truncate">
														{attachment.key}
													</span>
												</div>
												<Badge 
													variant="outline" 
													className={cn("text-xs", getTypeColor(attachment.type))}
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
										{getTypeIcon(selectedAttachment.type)}
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
									className={cn("text-xs", getTypeColor(selectedAttachment.type))}
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