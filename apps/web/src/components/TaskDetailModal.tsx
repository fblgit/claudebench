import { format, formatDistanceToNow, parseISO } from "date-fns";
import { CodeViewer } from "./CodeEditor";
import { AttachmentViewer } from "./AttachmentViewer";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Clock,
	User,
	Flag,
	CheckCircle,
	XCircle,
	PlayCircle,
	Calendar,
	Tag,
	Hash,
	AlertCircle,
	Activity,
	Info,
	FileJson,
	Timer,
	Target,
	GitBranch,
	Layers,
	Database,
	Zap,
	TrendingUp,
	Users,
	Package,
	Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Task {
	id: string;
	text: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority: number;
	createdAt: string;
	updatedAt?: string;
	completedAt?: string | null;
	metadata?: Record<string, any>;
	assignedTo?: string;
	result?: any;
	error?: any;
}

interface TaskDetailModalProps {
	task: Task | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUpdate?: (taskId: string, updates: any) => void;
	onComplete?: (taskId: string) => void;
	onDelete?: (taskId: string) => void;
	onAssign?: (taskId: string, instanceId: string) => void;
	instances?: Array<{ id: string; roles: string[]; status?: string; health?: string }>;
}

export function TaskDetailModal({
	task,
	open,
	onOpenChange,
	onUpdate,
	onComplete,
	onDelete,
	onAssign,
	instances = [],
}: TaskDetailModalProps) {
	if (!task) return null;

	// Status configuration
	const statusConfig = {
		pending: {
			icon: <Clock className="h-5 w-5" />,
			color: "text-gray-500",
			bgColor: "bg-gray-100",
			label: "Pending",
		},
		in_progress: {
			icon: <PlayCircle className="h-5 w-5" />,
			color: "text-blue-500",
			bgColor: "bg-blue-100",
			label: "In Progress",
		},
		completed: {
			icon: <CheckCircle className="h-5 w-5" />,
			color: "text-green-500",
			bgColor: "bg-green-100",
			label: "Completed",
		},
		failed: {
			icon: <XCircle className="h-5 w-5" />,
			color: "text-red-500",
			bgColor: "bg-red-100",
			label: "Failed",
		},
	};

	const currentStatus = statusConfig[task.status];

	// Priority configuration
	const getPriorityConfig = (priority: number) => {
		if (priority >= 80) return { color: "text-red-500 border-red-500 bg-red-50", label: "Critical" };
		if (priority >= 60) return { color: "text-orange-500 border-orange-500 bg-orange-50", label: "High" };
		if (priority >= 40) return { color: "text-yellow-500 border-yellow-500 bg-yellow-50", label: "Medium" };
		if (priority >= 20) return { color: "text-blue-500 border-blue-500 bg-blue-50", label: "Low" };
		return { color: "text-gray-500 border-gray-500 bg-gray-50", label: "Trivial" };
	};

	const priorityConfig = getPriorityConfig(task.priority);

	// Extract metadata
	const metadata = task.metadata || {};
	const tags = metadata.tags as string[] || [];
	const dueDate = metadata.dueDate as string;
	const role = metadata.role as string;
	const roles = metadata.roles as string[] || [];
	const dependencies = metadata.dependencies as string[] || [];
	const description = metadata.description as string;
	const type = metadata.type as string;
	const component = metadata.component as string;

	// Parse timestamps safely
	const parseDate = (dateString?: string | null) => {
		if (!dateString || dateString === "null") return null;
		try {
			const date = parseISO(dateString);
			return isNaN(date.getTime()) ? null : date;
		} catch {
			return null;
		}
	};

	const createdDate = parseDate(task.createdAt);
	const updatedDate = parseDate(task.updatedAt);
	const completedDate = parseDate(task.completedAt);

	// Calculate duration
	const getDuration = () => {
		if (!createdDate) return null;
		const endDate = completedDate || new Date();
		const diff = endDate.getTime() - createdDate.getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		return `${minutes}m`;
	};

	const duration = getDuration();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="!max-w-[90vw] !w-[90vw] h-[90vh] flex flex-col p-0 sm:!max-w-[90vw]">
				<DialogHeader className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-background to-muted/20">
					<div className="flex items-start justify-between">
						<div className="flex-1">
							<DialogTitle className="text-xl font-semibold flex items-center gap-3">
								<div className={cn("p-2 rounded-lg", currentStatus.bgColor)}>
									<div className={currentStatus.color}>{currentStatus.icon}</div>
								</div>
								<div className="flex-1">
									<div className="flex items-center gap-2 mb-1">
										<span className="text-muted-foreground text-sm">#{task.id}</span>
										{type && (
											<Badge variant="secondary" className="text-xs">
												<Package className="h-3 w-3 mr-1" />
												{type}
											</Badge>
										)}
										{component && (
											<Badge variant="secondary" className="text-xs">
												<Layers className="h-3 w-3 mr-1" />
												{component}
											</Badge>
										)}
									</div>
									<div className="text-base font-normal text-foreground line-clamp-2">
										{task.text}
									</div>
								</div>
							</DialogTitle>
						</div>
						<div className="flex items-center gap-2">
							{task.status !== "completed" && task.status !== "failed" && onComplete && (
								<Button onClick={() => onComplete(task.id)} size="sm" variant="default">
									<CheckCircle className="h-4 w-4 mr-2" />
									Complete
								</Button>
							)}
							{onDelete && (
								<Button 
									onClick={() => {
										onDelete(task.id);
										onOpenChange(false);
									}} 
									size="sm" 
									variant="destructive"
								>
									<XCircle className="h-4 w-4 mr-2" />
									Delete
								</Button>
							)}
						</div>
					</div>
					{description && (
						<DialogDescription className="mt-3 text-sm">
							{description}
						</DialogDescription>
					)}
				</DialogHeader>

				<ScrollArea className="flex-1 px-6">
					<Tabs defaultValue="overview" className="py-4">
						<TabsList className="grid w-full grid-cols-5">
							<TabsTrigger value="overview">
								<Info className="h-4 w-4 mr-2" />
								Overview
							</TabsTrigger>
							<TabsTrigger value="metadata">
								<FileJson className="h-4 w-4 mr-2" />
								Metadata
							</TabsTrigger>
							<TabsTrigger value="timeline">
								<Activity className="h-4 w-4 mr-2" />
								Timeline
							</TabsTrigger>
							<TabsTrigger value="attachments">
								<Paperclip className="h-4 w-4 mr-2" />
								Attachments
							</TabsTrigger>
							<TabsTrigger value="result">
								<Target className="h-4 w-4 mr-2" />
								Result
							</TabsTrigger>
						</TabsList>

						<TabsContent value="overview" className="mt-6 space-y-6">
							{/* Status and Priority */}
							<div className="grid grid-cols-2 gap-4">
								<Card>
									<CardHeader className="pb-3">
										<CardTitle className="text-sm font-medium text-muted-foreground">
											Status
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="flex items-center gap-2">
											<Badge
												variant="outline"
												className={cn("px-3 py-1", currentStatus.color, currentStatus.bgColor)}
											>
												{currentStatus.icon}
												<span className="ml-2">{currentStatus.label}</span>
											</Badge>
											{duration && (
												<span className="text-sm text-muted-foreground">
													<Timer className="h-3 w-3 inline mr-1" />
													{duration}
												</span>
											)}
										</div>
									</CardContent>
								</Card>

								<Card>
									<CardHeader className="pb-3">
										<CardTitle className="text-sm font-medium text-muted-foreground">
											Priority
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="flex items-center gap-3">
											<Badge
												variant="outline"
												className={cn("px-3 py-1", priorityConfig.color)}
											>
												<Flag className="h-4 w-4 mr-2" />
												{task.priority}/100
											</Badge>
											<span className="text-sm font-medium">{priorityConfig.label}</span>
										</div>
										<div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
											<div
												className={cn("h-full transition-all", 
													task.priority >= 80 ? "bg-red-500" :
													task.priority >= 60 ? "bg-orange-500" :
													task.priority >= 40 ? "bg-yellow-500" :
													task.priority >= 20 ? "bg-blue-500" :
													"bg-gray-500"
												)}
												style={{ width: `${task.priority}%` }}
											/>
										</div>
									</CardContent>
								</Card>
							</div>

							{/* Assignment */}
							<Card>
								<CardHeader className="pb-3">
									<CardTitle className="text-sm font-medium text-muted-foreground">
										Assignment
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-3">
										{task.assignedTo ? (
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													<User className="h-4 w-4 text-muted-foreground" />
													<span className="font-medium">{task.assignedTo}</span>
													{instances.find(i => i.id === task.assignedTo) && (
														<div className="flex gap-1">
															{instances.find(i => i.id === task.assignedTo)?.roles.map(r => (
																<Badge key={r} variant="secondary" className="text-xs">
																	{r}
																</Badge>
															))}
														</div>
													)}
												</div>
												{instances.find(i => i.id === task.assignedTo)?.health && (
													<Badge
														variant="outline"
														className={cn(
															"text-xs",
															instances.find(i => i.id === task.assignedTo)?.health === "healthy"
																? "text-green-500 border-green-500"
																: "text-yellow-500 border-yellow-500"
														)}
													>
														{instances.find(i => i.id === task.assignedTo)?.health}
													</Badge>
												)}
											</div>
										) : (
											<div className="text-sm text-muted-foreground">
												<AlertCircle className="h-4 w-4 inline mr-2" />
												Not assigned
											</div>
										)}
										{(roles.length > 0 || role) && (
											<div className="flex items-center gap-2">
												<Users className="h-4 w-4 text-muted-foreground" />
												<span className="text-sm text-muted-foreground">Required roles:</span>
												<div className="flex gap-1">
													{role && (
														<Badge variant="outline" className="text-xs">
															{role}
														</Badge>
													)}
													{roles.map(r => (
														<Badge key={r} variant="outline" className="text-xs">
															{r}
														</Badge>
													))}
												</div>
											</div>
										)}
									</div>
								</CardContent>
							</Card>

							{/* Tags and Due Date */}
							<div className="grid grid-cols-2 gap-4">
								{tags.length > 0 && (
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-sm font-medium text-muted-foreground">
												<Tag className="h-4 w-4 inline mr-2" />
												Tags
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="flex flex-wrap gap-2">
												{tags.map((tag) => (
													<Badge key={tag} variant="secondary">
														{tag}
													</Badge>
												))}
											</div>
										</CardContent>
									</Card>
								)}

								{dueDate && (
									<Card>
										<CardHeader className="pb-3">
											<CardTitle className="text-sm font-medium text-muted-foreground">
												<Calendar className="h-4 w-4 inline mr-2" />
												Due Date
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="text-sm">
												{format(parseISO(dueDate), "PPP")}
												<div className="text-xs text-muted-foreground mt-1">
													{formatDistanceToNow(parseISO(dueDate), { addSuffix: true })}
												</div>
											</div>
										</CardContent>
									</Card>
								)}
							</div>

							{/* Dependencies */}
							{dependencies.length > 0 && (
								<Card>
									<CardHeader className="pb-3">
										<CardTitle className="text-sm font-medium text-muted-foreground">
											<GitBranch className="h-4 w-4 inline mr-2" />
											Dependencies ({dependencies.length})
										</CardTitle>
									</CardHeader>
									<CardContent>
										<div className="space-y-2">
											{dependencies.map((dep, idx) => (
												<div key={idx} className="flex items-center gap-2">
													<div className="h-2 w-2 rounded-full bg-muted-foreground" />
													<span className="text-sm">{dep}</span>
												</div>
											))}
										</div>
									</CardContent>
								</Card>
							)}
						</TabsContent>

						<TabsContent value="metadata" className="mt-6">
							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium text-muted-foreground">
										<Database className="h-4 w-4 inline mr-2" />
										Raw Metadata
									</CardTitle>
									<CardDescription>
										All metadata fields stored with this task
									</CardDescription>
								</CardHeader>
								<CardContent className="p-0">
									<CodeViewer
										value={JSON.stringify(metadata, null, 2)}
										language="json"
										height="400px"
										minimap={false}
										lineNumbers="off"
										folding={true}
										wordWrap="on"
									/>
								</CardContent>
							</Card>
						</TabsContent>

						<TabsContent value="timeline" className="mt-6">
							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium text-muted-foreground">
										<Clock className="h-4 w-4 inline mr-2" />
										Timeline
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-4">
										{createdDate && (
											<div className="flex items-start gap-4">
												<div className="mt-1">
													<div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
														<Zap className="h-4 w-4 text-blue-500" />
													</div>
												</div>
												<div className="flex-1">
													<div className="font-medium text-sm">Created</div>
													<div className="text-sm text-muted-foreground">
														{format(createdDate, "PPpp")}
													</div>
													<div className="text-xs text-muted-foreground mt-1">
														{formatDistanceToNow(createdDate, { addSuffix: true })}
													</div>
												</div>
											</div>
										)}

										{task.assignedTo && updatedDate && (
											<div className="flex items-start gap-4">
												<div className="mt-1">
													<div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center">
														<User className="h-4 w-4 text-purple-500" />
													</div>
												</div>
												<div className="flex-1">
													<div className="font-medium text-sm">Assigned to {task.assignedTo}</div>
													<div className="text-sm text-muted-foreground">
														{format(updatedDate, "PPpp")}
													</div>
													<div className="text-xs text-muted-foreground mt-1">
														{formatDistanceToNow(updatedDate, { addSuffix: true })}
													</div>
												</div>
											</div>
										)}

										{task.status === "in_progress" && updatedDate && (
											<div className="flex items-start gap-4">
												<div className="mt-1">
													<div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
														<PlayCircle className="h-4 w-4 text-blue-500" />
													</div>
												</div>
												<div className="flex-1">
													<div className="font-medium text-sm">Started</div>
													<div className="text-sm text-muted-foreground">
														{format(updatedDate, "PPpp")}
													</div>
													<div className="text-xs text-muted-foreground mt-1">
														{formatDistanceToNow(updatedDate, { addSuffix: true })}
													</div>
												</div>
											</div>
										)}

										{completedDate && (
											<div className="flex items-start gap-4">
												<div className="mt-1">
													<div className={cn(
														"h-8 w-8 rounded-full flex items-center justify-center",
														task.status === "completed" ? "bg-green-100" : "bg-red-100"
													)}>
														{task.status === "completed" ? (
															<CheckCircle className="h-4 w-4 text-green-500" />
														) : (
															<XCircle className="h-4 w-4 text-red-500" />
														)}
													</div>
												</div>
												<div className="flex-1">
													<div className="font-medium text-sm">
														{task.status === "completed" ? "Completed" : "Failed"}
													</div>
													<div className="text-sm text-muted-foreground">
														{format(completedDate, "PPpp")}
													</div>
													<div className="text-xs text-muted-foreground mt-1">
														{formatDistanceToNow(completedDate, { addSuffix: true })}
													</div>
												</div>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						</TabsContent>

						<TabsContent value="attachments" className="mt-6">
							<AttachmentViewer taskId={task.id} />
						</TabsContent>

						<TabsContent value="result" className="mt-6">
							<Card>
								<CardHeader>
									<CardTitle className="text-sm font-medium text-muted-foreground">
										<Target className="h-4 w-4 inline mr-2" />
										Result
									</CardTitle>
									<CardDescription>
										{task.result ? "Task execution result" : task.error ? "Task execution error" : "No result available yet"}
									</CardDescription>
								</CardHeader>
								<CardContent>
									{task.result && (
										<div className="border rounded-lg overflow-hidden">
											<CodeViewer
												value={typeof task.result === "string" ? task.result : JSON.stringify(task.result, null, 2)}
												language="auto"
												height="400px"
												minimap={false}
												lineNumbers="on"
												folding={true}
												wordWrap="on"
											/>
										</div>
									)}
									{task.error && (
										<div className="space-y-2">
											<div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-l-4 border-red-500 rounded-l">
												<XCircle className="h-4 w-4 text-red-500" />
												<span className="font-medium text-sm text-red-700">Error Details</span>
											</div>
											<CodeViewer
												value={typeof task.error === "string" ? task.error : JSON.stringify(task.error, null, 2)}
												language="auto"
												height="300px"
												minimap={false}
												lineNumbers="off"
												folding={false}
												wordWrap="on"
												className="border-red-200"
											/>
										</div>
									)}
									{!task.result && !task.error && (
										<div className="text-sm text-muted-foreground text-center py-8">
											<AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
											Task has not been completed yet
										</div>
									)}
								</CardContent>
							</Card>
						</TabsContent>
					</Tabs>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}