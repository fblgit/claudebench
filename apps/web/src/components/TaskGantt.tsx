import { useMemo, useState } from "react";
import { Gantt, ViewMode } from "gantt-task-react";
import type { Task as GanttTask, GanttProps } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Calendar,
	Clock,
	CheckCircle2,
	XCircle,
	PlayCircle,
	Flag,
	User,
	Paperclip,
	CalendarDays,
	CalendarRange,
	CalendarClock,
} from "lucide-react";
import { format, parseISO, startOfDay, endOfDay, addDays, differenceInDays } from "date-fns";
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
	attachmentCount?: number;
}

interface TaskGanttProps {
	tasks: Task[];
	onTaskClick?: (task: Task) => void;
	className?: string;
}

// Custom task list component for the left side
const CustomTaskList: React.FC<{
	tasks: GanttTask[];
	originalTasks: Map<string, Task>;
	onTaskClick?: (task: Task) => void;
}> = ({ tasks, originalTasks, onTaskClick }) => {
	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle2 className="h-3 w-3 text-green-500" />;
			case "failed":
				return <XCircle className="h-3 w-3 text-red-500" />;
			case "in_progress":
				return <PlayCircle className="h-3 w-3 text-blue-500" />;
			default:
				return <Clock className="h-3 w-3 text-gray-500" />;
		}
	};

	return (
		<div className="border-r bg-background">
			<div className="sticky top-0 bg-background border-b px-3 py-2 z-10">
				<div className="font-medium text-sm">Tasks</div>
			</div>
			<div>
				{tasks.map((ganttTask, index) => {
					const originalTask = originalTasks.get(ganttTask.id);
					if (!originalTask) return null;

					return (
						<div
							key={ganttTask.id}
							className={cn(
								"flex items-center gap-2 px-3 border-b hover:bg-muted/50 cursor-pointer",
								index % 2 === 0 ? "bg-background" : "bg-muted/10"
							)}
							style={{ height: "46px" }}
							onClick={() => onTaskClick?.(originalTask)}
						>
							{getStatusIcon(originalTask.status)}
							<div className="flex-1 min-w-0">
								<div className="text-xs font-medium truncate" title={originalTask.text}>
									{originalTask.text.length > 25 
										? originalTask.text.substring(0, 25) + "..." 
										: originalTask.text}
								</div>
								<div className="text-xs text-muted-foreground">
									{originalTask.assignedTo || "Unassigned"} • {format(parseISO(originalTask.createdAt), 'MMM d')}
								</div>
							</div>
							{originalTask.priority >= 80 && (
								<Flag className="h-3 w-3 text-red-500" />
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
};

export function TaskGantt({ tasks, onTaskClick, className }: TaskGanttProps) {
	const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);
	const [showTaskList, setShowTaskList] = useState(true);

	// Convert tasks to Gantt format
	const { ganttTasks, taskMap } = useMemo(() => {
		if (!tasks || tasks.length === 0) {
			return { ganttTasks: [], taskMap: new Map() };
		}

		const taskMap = new Map<string, Task>();
		
		const ganttTasks: GanttTask[] = tasks.map((task) => {
			taskMap.set(task.id, task);
			
			const startDate = parseISO(task.createdAt);
			let endDate = new Date();
			
			// Calculate end date based on task state
			if (task.completedAt) {
				endDate = parseISO(task.completedAt);
			} else if (task.metadata?.dueDate) {
				endDate = parseISO(task.metadata.dueDate);
			} else if (task.updatedAt) {
				endDate = parseISO(task.updatedAt);
			} else {
				// Estimate based on priority for pending tasks
				const estimatedDays = Math.ceil((100 - task.priority) / 20);
				endDate = addDays(startDate, Math.max(1, estimatedDays));
			}

			// Ensure end date is after start date
			if (endDate <= startDate) {
				endDate = addDays(startDate, 1);
			}

			// Calculate progress based on status
			let progress = 0;
			if (task.status === "completed") {
				progress = 100;
			} else if (task.status === "failed") {
				progress = 100; // Show as complete but with different styling
			} else if (task.status === "in_progress") {
				// Estimate progress based on time elapsed
				const totalDuration = differenceInDays(endDate, startDate) || 1;
				const elapsed = differenceInDays(new Date(), startDate);
				progress = Math.min(95, Math.max(10, (elapsed / totalDuration) * 100));
			}

			// Determine task type and color based on status
			let type: GanttTask["type"] = "task";
			let styles: Partial<GanttTask["styles"]> = {};
			
			switch (task.status) {
				case "completed":
					styles = {
						backgroundColor: "#10b981",
						backgroundSelectedColor: "#059669",
						progressColor: "#059669",
						progressSelectedColor: "#047857",
					};
					break;
				case "failed":
					styles = {
						backgroundColor: "#ef4444",
						backgroundSelectedColor: "#dc2626",
						progressColor: "#dc2626",
						progressSelectedColor: "#b91c1c",
					};
					break;
				case "in_progress":
					styles = {
						backgroundColor: "#3b82f6",
						backgroundSelectedColor: "#2563eb",
						progressColor: "#2563eb",
						progressSelectedColor: "#1d4ed8",
					};
					break;
				default:
					styles = {
						backgroundColor: "#9ca3af",
						backgroundSelectedColor: "#6b7280",
						progressColor: "#6b7280",
						progressSelectedColor: "#4b5563",
					};
			}

			// Add priority indicator for high priority tasks
			if (task.priority >= 80) {
				styles.backgroundColor = "#ef4444";
			}

			// Check for dependencies
			const dependencies: string[] = [];
			if (task.metadata?.dependencies && Array.isArray(task.metadata.dependencies)) {
				// Only add dependencies that exist in our task list
				task.metadata.dependencies.forEach((depId: string) => {
					if (tasks.find(t => t.id === depId)) {
						dependencies.push(depId);
					}
				});
			}

			return {
				start: startOfDay(startDate),
				end: endOfDay(endDate),
				name: task.text,
				id: task.id,
				type,
				progress,
				dependencies,
				styles,
				isDisabled: task.status === "completed" || task.status === "failed",
				project: task.assignedTo || "Unassigned",
				hideChildren: false,
			} as GanttTask;
		});

		// Sort by start date (oldest first - traditional Gantt order)
		ganttTasks.sort((a, b) => a.start.getTime() - b.start.getTime());

		return { ganttTasks, taskMap };
	}, [tasks]);

	// Handle task selection
	const handleTaskClick = (task: GanttTask) => {
		const originalTask = taskMap.get(task.id);
		if (originalTask && onTaskClick) {
			onTaskClick(originalTask);
		}
	};

	// Custom tooltip content
	const TooltipContent: React.FC<{
		task: GanttTask;
		fontSize: string;
		fontFamily: string;
	}> = ({ task }) => {
		const originalTask = taskMap.get(task.id);
		if (!originalTask) return null;

		return (
			<div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
				<div className="font-medium mb-2">{originalTask.text}</div>
				<div className="space-y-1 text-xs">
					<div className="flex items-center gap-2">
						<Badge variant="outline" className="text-xs">
							{originalTask.status.replace('_', ' ')}
						</Badge>
						<span className="text-muted-foreground">
							{Math.round(task.progress)}% complete
						</span>
					</div>
					{originalTask.assignedTo && (
						<div className="flex items-center gap-1">
							<User className="h-3 w-3" />
							{originalTask.assignedTo}
						</div>
					)}
					<div className="flex items-center gap-1">
						<Flag className="h-3 w-3" />
						Priority: {originalTask.priority}
					</div>
					<div className="flex items-center gap-1">
						<Calendar className="h-3 w-3" />
						Start: {format(task.start, 'MMM d, yyyy')}
					</div>
					<div className="flex items-center gap-1">
						<Calendar className="h-3 w-3" />
						End: {format(task.end, 'MMM d, yyyy')}
					</div>
					{originalTask.attachmentCount ? (
						<div className="flex items-center gap-1">
							<Paperclip className="h-3 w-3" />
							{originalTask.attachmentCount} attachments
						</div>
					) : null}
				</div>
			</div>
		);
	};

	if (tasks.length === 0) {
		return (
			<div className={cn("flex items-center justify-center h-64 text-muted-foreground", className)}>
				No tasks to display in Gantt chart
			</div>
		);
	}

	return (
		<TooltipProvider>
			<Card className={cn("h-full flex flex-col", className)}>
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<CardTitle className="text-sm flex items-center gap-2">
							<Calendar className="h-4 w-4" />
							Gantt Chart
							<Badge variant="outline" className="ml-2">
								{tasks.length} tasks
							</Badge>
						</CardTitle>
						<div className="flex items-center gap-2">
							<ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as ViewMode)}>
								<ToggleGroupItem value={ViewMode.Hour} size="sm">
									<CalendarClock className="h-4 w-4" />
								</ToggleGroupItem>
								<ToggleGroupItem value={ViewMode.Day} size="sm">
									<Calendar className="h-4 w-4" />
								</ToggleGroupItem>
								<ToggleGroupItem value={ViewMode.Week} size="sm">
									<CalendarDays className="h-4 w-4" />
								</ToggleGroupItem>
								<ToggleGroupItem value={ViewMode.Month} size="sm">
									<CalendarRange className="h-4 w-4" />
								</ToggleGroupItem>
							</ToggleGroup>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowTaskList(!showTaskList)}
							>
								{showTaskList ? "Hide" : "Show"} Task List
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent className="flex-1 p-0 overflow-hidden">
					<div className="h-full w-full">
						<Gantt
							tasks={ganttTasks}
							viewMode={viewMode}
							onClick={handleTaskClick}
							listCellWidth={showTaskList ? "155px" : ""}
							ganttHeight={Math.max(300, ganttTasks.length * 50)}
							columnWidth={
								viewMode === ViewMode.Hour ? 60 :
								viewMode === ViewMode.Day ? 65 :
								viewMode === ViewMode.Week ? 250 :
								350
							}
							todayColor="hsl(var(--primary) / 0.1)"
							barFill={60}
							barCornerRadius={3}
							arrowColor="hsl(var(--muted-foreground))"
							fontFamily="inherit"
							fontSize="12px"
							TooltipContent={TooltipContent}
							TaskListHeader={() => showTaskList ? (
								<div className="border-r">
									<div className="sticky top-0 bg-background border-b px-4 py-3">
										<div className="font-medium text-sm">Tasks</div>
									</div>
								</div>
							) : <></>}
							TaskListTable={(props) => showTaskList ? (
								<CustomTaskList 
									tasks={props.tasks} 
									originalTasks={taskMap}
									onTaskClick={onTaskClick}
								/>
							) : <></>}
						/>
					</div>
				</CardContent>

				{/* Legend */}
				<div className="border-t p-4 flex items-center justify-center gap-4 text-xs">
					<div className="flex items-center gap-1">
						<div className="w-3 h-3 bg-gray-400 rounded" />
						<span>Pending</span>
					</div>
					<div className="flex items-center gap-1">
						<div className="w-3 h-3 bg-blue-500 rounded" />
						<span>In Progress</span>
					</div>
					<div className="flex items-center gap-1">
						<div className="w-3 h-3 bg-green-500 rounded" />
						<span>Completed</span>
					</div>
					<div className="flex items-center gap-1">
						<div className="w-3 h-3 bg-red-500 rounded" />
						<span>Failed</span>
					</div>
				</div>
			</Card>
		</TooltipProvider>
	);
}