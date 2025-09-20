import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Clock,
	CheckCircle2,
	XCircle,
	PlayCircle,
	Calendar,
	User,
	Flag,
	Paperclip,
} from "lucide-react";
import { format, parseISO, differenceInDays, startOfDay, endOfDay, isWithinInterval, addDays } from "date-fns";
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

interface TaskTimelineProps {
	tasks: Task[];
	onTaskClick?: (task: Task) => void;
	className?: string;
}

export function TaskTimeline({ tasks, onTaskClick, className }: TaskTimelineProps) {
	// Calculate timeline boundaries and prepare data
	const timelineData = useMemo(() => {
		if (!tasks || tasks.length === 0) {
			return { startDate: new Date(), endDate: new Date(), days: 1, tasksByDay: new Map() };
		}

		// Find earliest and latest dates
		let earliestDate = new Date();
		let latestDate = new Date();
		
		tasks.forEach(task => {
			const createdDate = parseISO(task.createdAt);
			if (createdDate < earliestDate) earliestDate = createdDate;
			
			// Use completedAt if available, otherwise use updatedAt or current date for in-progress
			let endDate = new Date();
			if (task.completedAt) {
				endDate = parseISO(task.completedAt);
			} else if (task.updatedAt) {
				endDate = parseISO(task.updatedAt);
			}
			if (endDate > latestDate) latestDate = endDate;
		});

		// Add padding days
		earliestDate = addDays(earliestDate, -1);
		latestDate = addDays(latestDate, 1);

		const days = differenceInDays(latestDate, earliestDate) + 1;
		
		// Group tasks by their timeline position
		const tasksByDay = new Map<string, Task[]>();
		
		tasks.forEach(task => {
			const startDate = parseISO(task.createdAt);
			const dateKey = format(startDate, 'yyyy-MM-dd');
			
			if (!tasksByDay.has(dateKey)) {
				tasksByDay.set(dateKey, []);
			}
			tasksByDay.get(dateKey)?.push(task);
		});

		return {
			startDate: earliestDate,
			endDate: latestDate,
			days,
			tasksByDay,
		};
	}, [tasks]);

	// Generate date labels for the timeline
	const dateLabels = useMemo(() => {
		const labels = [];
		let currentDate = timelineData.startDate;
		
		for (let i = 0; i < timelineData.days; i++) {
			labels.push({
				date: new Date(currentDate),
				label: format(currentDate, 'MMM d'),
				dayLabel: format(currentDate, 'EEE'),
				fullDate: format(currentDate, 'yyyy-MM-dd'),
			});
			currentDate = addDays(currentDate, 1);
		}
		
		return labels;
	}, [timelineData]);

	// Get status icon
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

	// Get priority color
	const getPriorityColor = (priority: number) => {
		if (priority >= 80) return "bg-red-500";
		if (priority >= 60) return "bg-orange-500";
		if (priority >= 40) return "bg-yellow-500";
		if (priority >= 20) return "bg-blue-500";
		return "bg-gray-500";
	};

	// Get status color for timeline bar
	const getStatusColor = (status: string) => {
		switch (status) {
			case "completed":
				return "bg-green-500 hover:bg-green-600";
			case "failed":
				return "bg-red-500 hover:bg-red-600";
			case "in_progress":
				return "bg-blue-500 hover:bg-blue-600";
			default:
				return "bg-gray-400 hover:bg-gray-500";
		}
	};

	// Calculate task position and width on timeline
	const getTaskPosition = (task: Task) => {
		const startDate = parseISO(task.createdAt);
		const endDate = task.completedAt 
			? parseISO(task.completedAt)
			: task.updatedAt 
				? parseISO(task.updatedAt)
				: new Date();
		
		const startOffset = differenceInDays(startDate, timelineData.startDate);
		const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
		
		return {
			left: `${(startOffset / timelineData.days) * 100}%`,
			width: `${(duration / timelineData.days) * 100}%`,
		};
	};

	// Group tasks by assignee for swimlanes
	const tasksByAssignee = useMemo(() => {
		const grouped = new Map<string, Task[]>();
		
		tasks.forEach(task => {
			const assignee = task.assignedTo || "Unassigned";
			if (!grouped.has(assignee)) {
				grouped.set(assignee, []);
			}
			grouped.get(assignee)?.push(task);
		});
		
		// Sort tasks within each group by creation date
		grouped.forEach((taskList) => {
			taskList.sort((a, b) => 
				new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
			);
		});
		
		return grouped;
	}, [tasks]);

	if (tasks.length === 0) {
		return (
			<div className={cn("flex items-center justify-center h-64 text-muted-foreground", className)}>
				No tasks to display in timeline
			</div>
		);
	}

	return (
		<TooltipProvider>
			<Card className={cn("h-full flex flex-col", className)}>
				<CardHeader className="pb-3">
					<CardTitle className="text-sm flex items-center gap-2">
						<Calendar className="h-4 w-4" />
						Timeline View
						<Badge variant="outline" className="ml-auto">
							{tasks.length} tasks
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 p-0">
					<ScrollArea className="h-full">
						<div className="p-4 min-w-[800px]">
							{/* Timeline Header with Dates */}
							<div className="mb-4 relative h-12 border-b">
								<div className="absolute inset-0 flex">
									{dateLabels.map((dateInfo, index) => (
										<div
											key={index}
											className="flex-1 text-center border-r last:border-r-0 px-1"
											style={{ minWidth: `${100 / timelineData.days}%` }}
										>
											<div className="text-xs font-medium text-muted-foreground">
												{dateInfo.dayLabel}
											</div>
											<div className="text-xs">
												{dateInfo.label}
											</div>
										</div>
									))}
								</div>
							</div>

							{/* Swimlanes by Assignee */}
							<div className="space-y-6">
								{Array.from(tasksByAssignee.entries()).map(([assignee, assigneeTasks]) => (
									<div key={assignee} className="space-y-2">
										{/* Swimlane Header */}
										<div className="flex items-center gap-2 mb-2">
											<User className="h-4 w-4 text-muted-foreground" />
											<span className="text-sm font-medium">{assignee}</span>
											<Badge variant="outline" className="text-xs">
												{assigneeTasks.length} tasks
											</Badge>
										</div>
										
										{/* Timeline Track */}
										<div className="relative h-20 bg-muted/20 rounded-md border">
											{/* Grid lines */}
											<div className="absolute inset-0 flex">
												{dateLabels.map((_, index) => (
													<div
														key={index}
														className="flex-1 border-r border-dashed border-muted-foreground/20 last:border-r-0"
													/>
												))}
											</div>
											
											{/* Task Bars */}
											{assigneeTasks.map((task, taskIndex) => {
												const position = getTaskPosition(task);
												const yOffset = (taskIndex % 2) * 30; // Stagger overlapping tasks
												
												return (
													<Tooltip key={task.id}>
														<TooltipTrigger asChild>
															<div
																className={cn(
																	"absolute h-6 rounded-md cursor-pointer transition-all",
																	"flex items-center gap-1 px-1 overflow-hidden",
																	getStatusColor(task.status)
																)}
																style={{
																	...position,
																	top: `${20 + yOffset}px`,
																	minWidth: "60px",
																	zIndex: taskIndex,
																}}
																onClick={() => onTaskClick?.(task)}
															>
																{getStatusIcon(task.status)}
																<span className="text-xs text-white truncate">
																	{task.text}
																</span>
																{/* Priority indicator */}
																<div 
																	className={cn(
																		"absolute top-0 right-0 w-1 h-full",
																		getPriorityColor(task.priority)
																	)} 
																	style={{ opacity: 0.6 }}
																/>
															</div>
														</TooltipTrigger>
														<TooltipContent side="top" className="max-w-xs">
															<div className="space-y-2">
																<div className="font-medium">{task.text}</div>
																<div className="text-xs space-y-1">
																	<div className="flex items-center gap-1">
																		{getStatusIcon(task.status)}
																		<span className="capitalize">{task.status.replace('_', ' ')}</span>
																	</div>
																	<div className="flex items-center gap-1">
																		<Flag className="h-3 w-3" />
																		Priority: {task.priority}
																	</div>
																	<div className="flex items-center gap-1">
																		<Calendar className="h-3 w-3" />
																		Created: {format(parseISO(task.createdAt), 'PPp')}
																	</div>
																	{task.completedAt && (
																		<div className="flex items-center gap-1">
																			<CheckCircle2 className="h-3 w-3" />
																			Completed: {format(parseISO(task.completedAt), 'PPp')}
																		</div>
																	)}
																	{task.attachmentCount ? (
																		<div className="flex items-center gap-1">
																			<Paperclip className="h-3 w-3" />
																			{task.attachmentCount} attachments
																		</div>
																	) : null}
																</div>
															</div>
														</TooltipContent>
													</Tooltip>
												);
											})}
										</div>
									</div>
								))}
							</div>

							{/* Legend */}
							<div className="mt-6 flex items-center justify-center gap-4 text-xs">
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
						</div>
						<ScrollBar orientation="horizontal" />
					</ScrollArea>
				</CardContent>
			</Card>
		</TooltipProvider>
	);
}