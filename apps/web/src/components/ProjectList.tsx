import { useState, useMemo } from "react";
import { useEventQuery, useEventMutation } from "@/hooks/use-event";
import { ProjectCard, type ProjectData } from "./ProjectCard";
import { TaskDetailModal } from "./TaskDetailModal";
import { ContextGenerationDialog } from "./ContextGenerationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Grid3x3,
	List,
	Search,
	Filter,
	Plus,
	RefreshCw,
	AlertCircle,
	FolderOpen,
	SortAsc,
	SortDesc,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProjectListProps {
	className?: string;
	onCreateProject?: () => void;
}

export function ProjectList({ className, onCreateProject }: ProjectListProps) {
	// State
	const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [sortBy, setSortBy] = useState<"priority" | "created" | "updated" | "progress">("priority");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
	const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null);
	const [contextTaskId, setContextTaskId] = useState<string | null>(null);

	// Fetch projects using task.list with project filter
	const { data, isLoading, error, refetch } = useEventQuery(
		"task.list",
		{
			status: statusFilter === "all" ? undefined : statusFilter,
			limit: 100,
			orderBy: sortBy === "progress" ? "updatedAt" : sortBy === "created" ? "createdAt" : sortBy === "updated" ? "updatedAt" : "priority",
			order: sortOrder,
		},
		{
			refetchInterval: 10000, // Refetch every 10 seconds
		}
	);

	// Mutations
	const decomposeMutation = useEventMutation("task.decompose");
	const generateContextMutation = useEventMutation("task.context");

	// Filter for project tasks only and transform to ProjectData
	const projects = useMemo(() => {
		if (!data?.tasks) return [];

		const projectTasks = data.tasks.filter(
			(task: any) => task.metadata?.type === "project" || task.text.toLowerCase().includes("[project]")
		);

		// Transform tasks to ProjectData format
		return projectTasks.map((task: any): ProjectData => ({
			id: task.id,
			text: task.text,
			status: task.status,
			priority: task.priority,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
			metadata: task.metadata,
			attachmentCount: task.attachmentCount,
			// We'll need to fetch stats separately or include in the task data
			stats: task.metadata?.stats,
		}));
	}, [data]);

	// Apply search filter
	const filteredProjects = useMemo(() => {
		let filtered = [...projects];

		// Search filter
		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(project) =>
					project.text.toLowerCase().includes(query) ||
					project.metadata?.projectId?.toLowerCase().includes(query) ||
					project.metadata?.constraints?.some((c) => c.toLowerCase().includes(query)) ||
					project.metadata?.requirements?.some((r) => r.toLowerCase().includes(query))
			);
		}

		// Sort by progress if selected
		if (sortBy === "progress" && sortOrder) {
			filtered.sort((a, b) => {
				const progressA = a.stats ? (a.stats.completedTasks / a.stats.totalTasks) * 100 : 0;
				const progressB = b.stats ? (b.stats.completedTasks / b.stats.totalTasks) * 100 : 0;
				return sortOrder === "asc" ? progressA - progressB : progressB - progressA;
			});
		}

		return filtered;
	}, [projects, searchQuery, sortBy, sortOrder]);

	// Handlers
	const handleProjectClick = (project: ProjectData) => {
		setSelectedProject(project);
	};

	const handleDecompose = async (projectId: string) => {
		const project = projects.find((p) => p.id === projectId);
		if (!project) return;

		try {
			await decomposeMutation.mutateAsync({
				taskId: projectId,
				task: project.text,
				priority: project.priority,
				constraints: project.metadata?.constraints,
			});
			toast.success("Project decomposition started");
			refetch();
		} catch (error) {
			toast.error("Failed to decompose project");
			console.error("Decompose error:", error);
		}
	};

	const handleGenerateContext = (projectId: string) => {
		setContextTaskId(projectId);
	};

	const handleViewDetails = (projectId: string) => {
		const project = projects.find((p) => p.metadata?.projectId === projectId || p.id === projectId);
		if (project) {
			setSelectedProject(project);
		}
	};

	// Loading state
	if (isLoading) {
		return (
			<div className={cn("space-y-4", className)}>
				<div className="flex items-center justify-between">
					<Skeleton className="h-10 w-64" />
					<Skeleton className="h-10 w-32" />
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{[1, 2, 3, 4, 5, 6].map((i) => (
						<Skeleton key={i} className="h-48" />
					))}
				</div>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<Alert variant="destructive" className={className}>
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>
					Failed to load projects. Please try again.
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

	return (
		<div className={cn("space-y-4", className)}>
			{/* Header Controls */}
			<div className="flex flex-col sm:flex-row gap-4">
				{/* Search and Filter */}
				<div className="flex-1 flex gap-2">
					<div className="relative flex-1 max-w-md">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search projects..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-9"
						/>
					</div>
					<Select value={statusFilter} onValueChange={setStatusFilter}>
						<SelectTrigger className="w-[140px]">
							<Filter className="h-4 w-4 mr-2" />
							<SelectValue placeholder="Filter" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Status</SelectItem>
							<SelectItem value="pending">Pending</SelectItem>
							<SelectItem value="in_progress">In Progress</SelectItem>
							<SelectItem value="completed">Completed</SelectItem>
							<SelectItem value="failed">Failed</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* View Controls */}
				<div className="flex items-center gap-2">
					<Select value={`${sortBy}-${sortOrder}`} onValueChange={(value) => {
						const [newSortBy, newSortOrder] = value.split("-") as any;
						setSortBy(newSortBy);
						setSortOrder(newSortOrder);
					}}>
						<SelectTrigger className="w-[160px]">
							{sortOrder === "asc" ? (
								<SortAsc className="h-4 w-4 mr-2" />
							) : (
								<SortDesc className="h-4 w-4 mr-2" />
							)}
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="priority-desc">Priority (High)</SelectItem>
							<SelectItem value="priority-asc">Priority (Low)</SelectItem>
							<SelectItem value="created-desc">Newest First</SelectItem>
							<SelectItem value="created-asc">Oldest First</SelectItem>
							<SelectItem value="updated-desc">Recently Updated</SelectItem>
							<SelectItem value="progress-desc">Most Progress</SelectItem>
							<SelectItem value="progress-asc">Least Progress</SelectItem>
						</SelectContent>
					</Select>

					<ToggleGroup value={viewMode} onValueChange={(value) => value && setViewMode(value as any)}>
						<ToggleGroupItem value="grid" aria-label="Grid view">
							<Grid3x3 className="h-4 w-4" />
						</ToggleGroupItem>
						<ToggleGroupItem value="list" aria-label="List view">
							<List className="h-4 w-4" />
						</ToggleGroupItem>
					</ToggleGroup>

					<Button onClick={() => refetch()} variant="outline" size="icon">
						<RefreshCw className="h-4 w-4" />
					</Button>

					{onCreateProject && (
						<Button onClick={onCreateProject}>
							<Plus className="h-4 w-4 mr-2" />
							New Project
						</Button>
					)}
				</div>
			</div>

			{/* Stats Bar */}
			<div className="flex items-center gap-4 text-sm">
				<Badge variant="secondary" className="gap-1">
					<FolderOpen className="h-3 w-3" />
					{filteredProjects.length} {filteredProjects.length === 1 ? "Project" : "Projects"}
				</Badge>
				{filteredProjects.length > 0 && (
					<>
						<Badge variant="outline" className="gap-1">
							{filteredProjects.filter((p) => p.status === "in_progress").length} Active
						</Badge>
						<Badge variant="outline" className="gap-1 text-green-600">
							{filteredProjects.filter((p) => p.status === "completed").length} Completed
						</Badge>
						{filteredProjects.filter((p) => p.status === "failed").length > 0 && (
							<Badge variant="outline" className="gap-1 text-red-600">
								{filteredProjects.filter((p) => p.status === "failed").length} Failed
							</Badge>
						)}
					</>
				)}
			</div>

			{/* Project Grid/List */}
			{filteredProjects.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-medium mb-1">No projects found</h3>
					<p className="text-sm text-muted-foreground mb-4">
						{searchQuery || statusFilter !== "all"
							? "Try adjusting your filters"
							: "Create your first project to get started"}
					</p>
					{onCreateProject && (
						<Button onClick={onCreateProject}>
							<Plus className="h-4 w-4 mr-2" />
							Create Project
						</Button>
					)}
				</div>
			) : (
				<div
					className={cn(
						viewMode === "grid"
							? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
							: "space-y-4"
					)}
				>
					{filteredProjects.map((project) => (
						<ProjectCard
							key={project.id}
							project={project}
							onClick={handleProjectClick}
							onViewDetails={handleViewDetails}
							onDecompose={handleDecompose}
							onGenerateContext={handleGenerateContext}
							className={viewMode === "list" ? "max-w-none" : ""}
						/>
					))}
				</div>
			)}

			{/* Modals */}
			{selectedProject && (
				<TaskDetailModal
					isOpen={!!selectedProject}
					onClose={() => setSelectedProject(null)}
					task={selectedProject as any}
				/>
			)}

			{contextTaskId && (
				<ContextGenerationDialog
					isOpen={!!contextTaskId}
					onClose={() => setContextTaskId(null)}
					taskId={contextTaskId}
				/>
			)}
		</div>
	);
}