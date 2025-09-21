import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Folder,
	MoreVertical,
	CheckCircle,
	Clock,
	AlertCircle,
	Users,
	Layers,
	Calendar,
	Target,
	Paperclip,
	PlayCircle,
	Eye,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface ProjectData {
	id: string;
	text: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority: number;
	createdAt: string;
	updatedAt?: string;
	metadata?: {
		type?: string;
		projectId?: string;
		constraints?: string[];
		requirements?: string[];
		estimatedMinutes?: number;
		sessionId?: string;
	};
	stats?: {
		totalTasks: number;
		pendingTasks: number;
		inProgressTasks: number;
		completedTasks: number;
		failedTasks: number;
	};
	attachmentCount?: number;
}

interface ProjectCardProps {
	project: ProjectData;
	onClick?: (project: ProjectData) => void;
	onViewDetails?: (projectId: string) => void;
	onDecompose?: (projectId: string) => void;
	onGenerateContext?: (projectId: string) => void;
	className?: string;
}

export function ProjectCard({
	project,
	onClick,
	onViewDetails,
	onDecompose,
	onGenerateContext,
	className,
}: ProjectCardProps) {
	// Calculate progress percentage
	const progress = project.stats
		? ((project.stats.completedTasks / project.stats.totalTasks) * 100) || 0
		: 0;

	// Priority color mapping
	const getPriorityColor = (priority: number) => {
		if (priority >= 80) return "text-red-500 border-red-500";
		if (priority >= 60) return "text-orange-500 border-orange-500";
		if (priority >= 40) return "text-yellow-500 border-yellow-500";
		return "text-green-500 border-green-500";
	};

	// Status icon and color
	const getStatusIcon = () => {
		switch (project.status) {
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

	const getStatusColor = () => {
		switch (project.status) {
			case "completed":
				return "bg-green-500/10 text-green-700 border-green-200";
			case "in_progress":
				return "bg-blue-500/10 text-blue-700 border-blue-200";
			case "failed":
				return "bg-red-500/10 text-red-700 border-red-200";
			default:
				return "bg-gray-500/10 text-gray-700 border-gray-200";
		}
	};

	// Clean project text (remove [Project] prefix if present)
	const projectTitle = project.text.replace(/^\[Project\]\s*/i, "");

	return (
		<Card
			className={cn(
				"group hover:shadow-lg transition-all cursor-pointer",
				"border-l-4",
				getPriorityColor(project.priority).split(" ")[1],
				className
			)}
			onClick={() => onClick?.(project)}
		>
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between gap-2">
					<div className="flex items-start gap-2 flex-1">
						<Folder className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
						<div className="flex-1 min-w-0">
							<CardTitle className="text-base font-semibold line-clamp-2">
								{projectTitle}
							</CardTitle>
							<div className="flex items-center gap-2 mt-1">
								<Badge variant="outline" className={cn("gap-1", getStatusColor())}>
									{getStatusIcon()}
									<span className="text-xs capitalize">
										{project.status.replace("_", " ")}
									</span>
								</Badge>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<Badge
												variant="outline"
												className={cn("text-xs", getPriorityColor(project.priority))}
											>
												<Target className="h-3 w-3 mr-1" />
												{project.priority}
											</Badge>
										</TooltipTrigger>
										<TooltipContent>Priority Score</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							</div>
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
								onClick={(e) => e.stopPropagation()}
							>
								<MoreVertical className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>Project Actions</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={(e) => {
									e.stopPropagation();
									onViewDetails?.(project.metadata?.projectId || project.id);
								}}
							>
								<Eye className="h-4 w-4 mr-2" />
								View Details
							</DropdownMenuItem>
							{project.status === "pending" && (
								<DropdownMenuItem
									onClick={(e) => {
										e.stopPropagation();
										onDecompose?.(project.id);
									}}
								>
									<Layers className="h-4 w-4 mr-2" />
									Decompose Tasks
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								onClick={(e) => {
									e.stopPropagation();
									onGenerateContext?.(project.id);
								}}
							>
								<Users className="h-4 w-4 mr-2" />
								Generate Context
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Progress Section */}
				{project.stats && (
					<div className="space-y-2">
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							<span className="font-medium">Progress</span>
							<span>{Math.round(progress)}%</span>
						</div>
						<Progress value={progress} className="h-2" />
						<div className="flex items-center gap-3 text-xs">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1">
											<div className="h-2 w-2 rounded-full bg-green-500" />
											<span>{project.stats.completedTasks}</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>Completed Tasks</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1">
											<div className="h-2 w-2 rounded-full bg-blue-500" />
											<span>{project.stats.inProgressTasks}</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>In Progress</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex items-center gap-1">
											<div className="h-2 w-2 rounded-full bg-gray-400" />
											<span>{project.stats.pendingTasks}</span>
										</div>
									</TooltipTrigger>
									<TooltipContent>Pending Tasks</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							{project.stats.failedTasks > 0 && (
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<div className="flex items-center gap-1">
												<div className="h-2 w-2 rounded-full bg-red-500" />
												<span>{project.stats.failedTasks}</span>
											</div>
										</TooltipTrigger>
										<TooltipContent>Failed Tasks</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)}
						</div>
					</div>
				)}

				{/* Metadata Section */}
				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					{project.stats && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className="flex items-center gap-1">
										<Layers className="h-3 w-3" />
										<span>{project.stats.totalTasks}</span>
									</div>
								</TooltipTrigger>
								<TooltipContent>Total Tasks</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					{project.attachmentCount !== undefined && project.attachmentCount > 0 && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className="flex items-center gap-1">
										<Paperclip className="h-3 w-3" />
										<span>{project.attachmentCount}</span>
									</div>
								</TooltipTrigger>
								<TooltipContent>Attachments</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					{project.metadata?.estimatedMinutes && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<div className="flex items-center gap-1">
										<Clock className="h-3 w-3" />
										<span>{project.metadata.estimatedMinutes}m</span>
									</div>
								</TooltipTrigger>
								<TooltipContent>Estimated Time</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-1">
									<Calendar className="h-3 w-3" />
									<span>{formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}</span>
								</div>
							</TooltipTrigger>
							<TooltipContent>Created</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>

				{/* Constraints/Requirements Pills */}
				{(project.metadata?.constraints?.length || project.metadata?.requirements?.length) ? (
					<div className="flex flex-wrap gap-1">
						{project.metadata.constraints?.slice(0, 2).map((constraint, idx) => (
							<Badge key={idx} variant="secondary" className="text-xs px-1.5 py-0">
								{constraint.length > 20 ? `${constraint.slice(0, 20)}...` : constraint}
							</Badge>
						))}
						{((project.metadata.constraints?.length || 0) + (project.metadata.requirements?.length || 0)) > 2 && (
							<Badge variant="secondary" className="text-xs px-1.5 py-0">
								+{(project.metadata.constraints?.length || 0) + (project.metadata.requirements?.length || 0) - 2} more
							</Badge>
						)}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}