import { useState, useMemo } from "react";
import { useEventQuery, useEventMutation } from "@/hooks/use-event";
import { TaskCard } from "./TaskCard";
import { AttachmentViewer } from "./AttachmentViewer";
import { ContextGenerationDialog } from "./ContextGenerationDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import {
	Folder,
	ArrowLeft,
	RefreshCw,
	AlertCircle,
	CheckCircle,
	Clock,
	PlayCircle,
	Users,
	Layers,
	Calendar,
	Target,
	Paperclip,
	FileText,
	GitBranch,
	Zap,
	Package,
	ListChecks,
	ChevronRight,
	Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface ProjectDetailViewProps {
	projectId?: string;
	taskId?: string;
	onBack?: () => void;
	className?: string;
}

export function ProjectDetailView({
	projectId,
	taskId,
	onBack,
	className,
}: ProjectDetailViewProps) {
	// State
	const [selectedTab, setSelectedTab] = useState("overview");
	const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
	const [selectedTaskForContext, setSelectedTaskForContext] = useState<string | null>(null);
	const [viewAttachments, setViewAttachments] = useState<{ taskId: string; key?: string } | null>(null);

	// Fetch project data using the new task.get_project handler
	const { data, isLoading, error, refetch } = useEventQuery(
		"task.get_project",
		projectId ? { projectId } : { taskId },
		{
			enabled: !!(projectId || taskId),
			refetchInterval: 10000,
		}
	);

	// Mutations
	const updateTaskMutation = useEventMutation("task.update");
	const completeTaskMutation = useEventMutation("task.complete");
	const claimTaskMutation = useEventMutation("task.claim");

	// Group subtasks by specialist
	const tasksBySpecialist = useMemo(() => {
		if (!data?.subtasks) return {};
		
		const grouped: Record<string, any[]> = {};
		data.subtasks.forEach((task: any) => {
			const specialist = task.specialist || "general";
			if (!grouped[specialist]) {
				grouped[specialist] = [];
			}
			grouped[specialist].push(task);
		});
		return grouped;
	}, [data]);

	// Calculate overall progress
	const progress = useMemo(() => {
		if (!data?.stats) return 0;
		return ((data.stats.completedTasks / data.stats.totalTasks) * 100) || 0;
	}, [data]);

	// Priority color mapping
	const getPriorityColor = (priority: number) => {
		if (priority >= 80) return "text-red-500 border-red-500";
		if (priority >= 60) return "text-orange-500 border-orange-500";
		if (priority >= 40) return "text-yellow-500 border-yellow-500";
		return "text-green-500 border-green-500";
	};

	// Status icon and color
	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle className="h-4 w-4 text-green-500" />;
			case "in_progress":
				return <PlayCircle className="h-4 w-4 text-blue-500" />;
			case "failed":
				return <AlertCircle className="h-4 w-4 text-red-500" />;
			default:
				return <Clock className="h-4 w-4 text-gray-400" />;
		}
	};

	// Handlers
	const handleTaskUpdate = async (taskId: string, updates: any) => {
		try {
			await updateTaskMutation.mutateAsync({ id: taskId, updates });
			toast.success("Task updated");
			refetch();
		} catch (error) {
			toast.error("Failed to update task");
		}
	};

	const handleTaskComplete = async (taskId: string) => {
		try {
			await completeTaskMutation.mutateAsync({ id: taskId });
			toast.success("Task completed");
			refetch();
		} catch (error) {
			toast.error("Failed to complete task");
		}
	};

	const handleTaskClaim = async (taskId: string) => {
		try {
			await claimTaskMutation.mutateAsync({ workerId: "worker-1", maxTasks: 1 });
			toast.success("Task claimed");
			refetch();
		} catch (error) {
			toast.error("Failed to claim task");
		}
	};

	const toggleTaskExpanded = (taskId: string) => {
		const newExpanded = new Set(expandedTasks);
		if (newExpanded.has(taskId)) {
			newExpanded.delete(taskId);
		} else {
			newExpanded.add(taskId);
		}
		setExpandedTasks(newExpanded);
	};

	// Loading state
	if (isLoading) {
		return (
			<div className={cn("space-y-4", className)}>
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-64 w-full" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}

	// Error state
	if (error || !data) {
		return (
			<Alert variant="destructive" className={className}>
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>
					Failed to load project details. Please try again.
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						className="ml-2"
					>
						<RefreshCw className="h-3 w-3 mr-1" />
						Retry
					</Button>
				</AlertDescription>
			</Alert>
		);
	}

	const projectTitle = data.parentTask.text.replace(/^\[Project\]\s*/i, "");

	return (
		<div className={cn("space-y-6", className)}>
			{/* Header */}
			<div className="flex items-start justify-between gap-4">
				<div className="flex items-start gap-3 flex-1">
					{onBack && (
						<Button variant="ghost" size="icon" onClick={onBack}>
							<ArrowLeft className="h-4 w-4" />
						</Button>
					)}
					<Folder className="h-6 w-6 text-muted-foreground mt-1" />
					<div className="flex-1">
						<h1 className="text-2xl font-bold mb-2">{projectTitle}</h1>
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline" className="gap-1">
								{getStatusIcon(data.parentTask.status)}
								<span className="capitalize">{data.parentTask.status.replace("_", " ")}</span>
							</Badge>
							<Badge
								variant="outline"
								className={cn("gap-1", getPriorityColor(data.parentTask.priority))}
							>
								<Target className="h-3 w-3" />
								Priority {data.parentTask.priority}
							</Badge>
							<Badge variant="outline" className="gap-1">
								<Calendar className="h-3 w-3" />
								{formatDistanceToNow(new Date(data.parentTask.createdAt), { addSuffix: true })}
							</Badge>
							{data.projectMetadata.estimatedMinutes && (
								<Badge variant="outline" className="gap-1">
									<Clock className="h-3 w-3" />
									{data.projectMetadata.estimatedMinutes} min
								</Badge>
							)}
						</div>
					</div>
				</div>
				<Button onClick={() => refetch()} variant="outline" size="icon">
					<RefreshCw className="h-4 w-4" />
				</Button>
			</div>

			{/* Progress Overview */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Project Progress</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="space-y-2">
						<div className="flex items-center justify-between text-sm">
							<span className="font-medium">Overall Completion</span>
							<span className="text-muted-foreground">{Math.round(progress)}%</span>
						</div>
						<Progress value={progress} className="h-3" />
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
						<div className="text-center">
							<div className="text-2xl font-bold">{data.stats.totalTasks}</div>
							<div className="text-xs text-muted-foreground">Total Tasks</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold text-gray-500">{data.stats.pendingTasks}</div>
							<div className="text-xs text-muted-foreground">Pending</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold text-blue-500">{data.stats.inProgressTasks}</div>
							<div className="text-xs text-muted-foreground">In Progress</div>
						</div>
						<div className="text-center">
							<div className="text-2xl font-bold text-green-500">{data.stats.completedTasks}</div>
							<div className="text-xs text-muted-foreground">Completed</div>
						</div>
						{data.stats.failedTasks > 0 && (
							<div className="text-center">
								<div className="text-2xl font-bold text-red-500">{data.stats.failedTasks}</div>
								<div className="text-xs text-muted-foreground">Failed</div>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Main Content Tabs */}
			<Tabs value={selectedTab} onValueChange={setSelectedTab}>
				<TabsList className="grid grid-cols-4 w-full max-w-lg">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="tasks">
						Tasks ({data.subtasks.length})
					</TabsTrigger>
					<TabsTrigger value="specialists">Specialists</TabsTrigger>
					<TabsTrigger value="attachments">
						Attachments ({data.parentTask.attachments?.length || 0})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="overview" className="space-y-4 mt-4">
					{/* Project Metadata */}
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Project Details</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{data.projectMetadata.description && (
								<div>
									<div className="text-sm font-medium mb-1">Description</div>
									<p className="text-sm text-muted-foreground">{data.projectMetadata.description}</p>
								</div>
							)}
							
							{data.projectMetadata.constraints && data.projectMetadata.constraints.length > 0 && (
								<div>
									<div className="text-sm font-medium mb-2">Constraints</div>
									<div className="flex flex-wrap gap-1">
										{data.projectMetadata.constraints.map((constraint: string, idx: number) => (
											<Badge key={idx} variant="secondary" className="text-xs">
												{constraint}
											</Badge>
										))}
									</div>
								</div>
							)}

							{data.projectMetadata.requirements && data.projectMetadata.requirements.length > 0 && (
								<div>
									<div className="text-sm font-medium mb-2">Requirements</div>
									<div className="flex flex-wrap gap-1">
										{data.projectMetadata.requirements.map((req: string, idx: number) => (
											<Badge key={idx} variant="outline" className="text-xs">
												{req}
											</Badge>
										))}
									</div>
								</div>
							)}

							<div className="grid grid-cols-2 gap-4 pt-2">
								<div>
									<div className="text-sm font-medium mb-1">Strategy</div>
									<Badge variant="outline" className="gap-1">
										<GitBranch className="h-3 w-3" />
										{data.projectMetadata.strategy || "mixed"}
									</Badge>
								</div>
								{data.projectMetadata.totalComplexity && (
									<div>
										<div className="text-sm font-medium mb-1">Complexity</div>
										<Badge variant="outline" className="gap-1">
											<Zap className="h-3 w-3" />
											{data.projectMetadata.totalComplexity} points
										</Badge>
									</div>
								)}
							</div>
						</CardContent>
					</Card>

					{/* Dependencies Graph (simplified) */}
					{data.subtasks.some((t: any) => t.dependencies?.length > 0) && (
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Task Dependencies</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									{data.subtasks
										.filter((task: any) => task.dependencies?.length > 0)
										.map((task: any) => (
											<div key={task.id} className="flex items-center gap-2 text-sm">
												<Badge variant="outline" className="text-xs">
													{task.text.slice(0, 30)}...
												</Badge>
												<ChevronRight className="h-3 w-3 text-muted-foreground" />
												<div className="flex gap-1">
													{task.dependencies.map((depId: string) => {
														const depTask = data.subtasks.find((t: any) => t.id === depId);
														return depTask ? (
															<Badge key={depId} variant="secondary" className="text-xs">
																{depTask.text.slice(0, 20)}...
															</Badge>
														) : null;
													})}
												</div>
											</div>
										))}
								</div>
							</CardContent>
						</Card>
					)}
				</TabsContent>

				<TabsContent value="tasks" className="mt-4">
					<ScrollArea className="h-[600px] pr-4">
						<div className="space-y-3">
							{data.subtasks.map((task: any) => (
								<Card key={task.id} className="relative">
									<CardHeader
										className="pb-3 cursor-pointer"
										onClick={() => toggleTaskExpanded(task.id)}
									>
										<div className="flex items-start justify-between gap-2">
											<div className="flex-1">
												<div className="font-medium text-sm line-clamp-2">{task.text}</div>
												<div className="flex items-center gap-2 mt-1">
													<Badge variant="outline" className="text-xs gap-1">
														{getStatusIcon(task.status)}
														<span className="capitalize">{task.status.replace("_", " ")}</span>
													</Badge>
													{task.specialist && (
														<Badge variant="secondary" className="text-xs gap-1">
															<Users className="h-3 w-3" />
															{task.specialist}
														</Badge>
													)}
													{task.complexity && (
														<Badge variant="outline" className="text-xs gap-1">
															<Zap className="h-3 w-3" />
															{task.complexity}
														</Badge>
													)}
													{task.attachments && task.attachments.length > 0 && (
														<Badge variant="outline" className="text-xs gap-1">
															<Paperclip className="h-3 w-3" />
															{task.attachments.length}
														</Badge>
													)}
												</div>
											</div>
											<div className="flex gap-1">
												{task.status === "pending" && (
													<Button
														size="sm"
														variant="outline"
														onClick={(e) => {
															e.stopPropagation();
															handleTaskClaim(task.id);
														}}
													>
														Claim
													</Button>
												)}
												{task.status === "in_progress" && (
													<Button
														size="sm"
														variant="outline"
														onClick={(e) => {
															e.stopPropagation();
															handleTaskComplete(task.id);
														}}
													>
														Complete
													</Button>
												)}
												<Button
													size="sm"
													variant="ghost"
													onClick={(e) => {
														e.stopPropagation();
														setSelectedTaskForContext(task.id);
													}}
												>
													<Brain className="h-3 w-3" />
												</Button>
											</div>
										</div>
									</CardHeader>
									{expandedTasks.has(task.id) && (
										<CardContent className="pt-0">
											<Separator className="mb-3" />
											<div className="space-y-3 text-sm">
												{task.estimatedMinutes && (
													<div>
														<span className="font-medium">Estimated Time:</span>{" "}
														<span className="text-muted-foreground">{task.estimatedMinutes} minutes</span>
													</div>
												)}
												{task.dependencies && task.dependencies.length > 0 && (
													<div>
														<span className="font-medium">Dependencies:</span>{" "}
														<span className="text-muted-foreground">{task.dependencies.length} tasks</span>
													</div>
												)}
												{task.attachments && task.attachments.length > 0 && (
													<div>
														<span className="font-medium">Attachments:</span>
														<div className="flex flex-wrap gap-1 mt-1">
															{task.attachments.map((attachment: any) => (
																<Button
																	key={attachment.key}
																	variant="outline"
																	size="sm"
																	className="text-xs h-7"
																	onClick={() => setViewAttachments({ taskId: task.id, key: attachment.key })}
																>
																	<FileText className="h-3 w-3 mr-1" />
																	{attachment.key}
																</Button>
															))}
														</div>
													</div>
												)}
												<div className="text-xs text-muted-foreground">
													Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
												</div>
											</div>
										</CardContent>
									)}
								</Card>
							))}
						</div>
					</ScrollArea>
				</TabsContent>

				<TabsContent value="specialists" className="mt-4">
					<div className="space-y-4">
						{Object.entries(tasksBySpecialist).map(([specialist, tasks]) => (
							<Card key={specialist}>
								<CardHeader>
									<CardTitle className="text-base flex items-center gap-2">
										<Users className="h-4 w-4" />
										{specialist.charAt(0).toUpperCase() + specialist.slice(1)} Specialist
										<Badge variant="secondary" className="ml-auto">
											{tasks.length} {tasks.length === 1 ? "task" : "tasks"}
										</Badge>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2">
										{tasks.map((task: any) => (
											<div key={task.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
												<div className="flex-1">
													<div className="text-sm line-clamp-1">{task.text}</div>
													<div className="flex items-center gap-2 mt-1">
														<Badge variant="outline" className="text-xs">
															{task.status.replace("_", " ")}
														</Badge>
														{task.complexity && (
															<span className="text-xs text-muted-foreground">
																Complexity: {task.complexity}
															</span>
														)}
													</div>
												</div>
												{task.estimatedMinutes && (
													<Badge variant="outline" className="text-xs">
														{task.estimatedMinutes}m
													</Badge>
												)}
											</div>
										))}
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</TabsContent>

				<TabsContent value="attachments" className="mt-4">
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Project Attachments</CardTitle>
						</CardHeader>
						<CardContent>
							{data.parentTask.attachments && data.parentTask.attachments.length > 0 ? (
								<div className="grid gap-2">
									{data.parentTask.attachments.map((attachment: any) => (
										<Button
											key={attachment.key}
											variant="outline"
											className="justify-start h-auto p-3"
											onClick={() => setViewAttachments({ taskId: data.parentTask.id, key: attachment.key })}
										>
											<div className="flex items-start gap-3 w-full">
												<FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
												<div className="flex-1 text-left">
													<div className="font-medium text-sm">{attachment.key}</div>
													<div className="text-xs text-muted-foreground">
														Type: {attachment.type} • Created {formatDistanceToNow(new Date(attachment.createdAt), { addSuffix: true })}
													</div>
												</div>
												<Badge variant="secondary" className="text-xs">
													{attachment.type}
												</Badge>
											</div>
										</Button>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">No attachments available</p>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Modals */}
			{selectedTaskForContext && (
				<ContextGenerationDialog
					task={project?.subtasks.find(t => t.id === selectedTaskForContext) || null}
					open={!!selectedTaskForContext}
					onOpenChange={(open) => !open && setSelectedTaskForContext(null)}
				/>
			)}

			{viewAttachments && (
				<AttachmentViewer
					taskId={viewAttachments.taskId}
					key={viewAttachments.key}
					onClose={() => setViewAttachments(null)}
				/>
			)}
		</div>
	);
}