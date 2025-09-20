import { useMemo, useState } from "react";
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
	Sparkles,
	Activity,
	Timer,
} from "lucide-react";
import { format, parseISO, differenceInDays, startOfDay, endOfDay, isWithinInterval, addDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
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
	const [hoveredTask, setHoveredTask] = useState<string | null>(null);
	const [hoveredSwimlane, setHoveredSwimlane] = useState<string | null>(null);
	
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

	// Get status icon with enhanced styling
	const getStatusIcon = (status: string, size: "sm" | "md" = "sm") => {
		const sizeClass = size === "sm" ? "h-3 w-3" : "h-4 w-4";
		switch (status) {
			case "completed":
				return <CheckCircle2 className={cn(sizeClass, "text-green-500 dark:text-green-400")} />;
			case "failed":
				return <XCircle className={cn(sizeClass, "text-red-500 dark:text-red-400")} />;
			case "in_progress":
				return <PlayCircle className={cn(sizeClass, "text-blue-500 dark:text-blue-400 animate-pulse")} />;
			default:
				return <Clock className={cn(sizeClass, "text-gray-500 dark:text-gray-400")} />;
		}
	};

	// Get priority color with gradient support
	const getPriorityColor = (priority: number) => {
		if (priority >= 80) return "from-red-600 to-red-500";
		if (priority >= 60) return "from-orange-600 to-orange-500";
		if (priority >= 40) return "from-yellow-600 to-yellow-500";
		if (priority >= 20) return "from-blue-600 to-blue-500";
		return "from-gray-600 to-gray-500";
	};

	// Get status color for timeline bar with enhanced gradients
	const getStatusColor = (status: string, isHovered: boolean = false) => {
		const baseClasses = "transition-all duration-300 shadow-sm";
		const hoverScale = isHovered ? "scale-105 shadow-lg z-20" : "";
		
		switch (status) {
			case "completed":
				return cn(
					baseClasses,
					"bg-gradient-to-r from-green-500 to-emerald-500",
					"dark:from-green-600 dark:to-emerald-600",
					hoverScale
				);
			case "failed":
				return cn(
					baseClasses,
					"bg-gradient-to-r from-red-500 to-rose-500",
					"dark:from-red-600 dark:to-rose-600",
					hoverScale
				);
			case "in_progress":
				return cn(
					baseClasses,
					"bg-gradient-to-r from-blue-500 to-indigo-500",
					"dark:from-blue-600 dark:to-indigo-600",
					"animate-pulse",
					hoverScale
				);
			default:
				return cn(
					baseClasses,
					"bg-gradient-to-r from-gray-400 to-gray-500",
					"dark:from-gray-600 dark:to-gray-700",
					hoverScale
				);
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
			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5 }}
			>
				<Card className={cn("h-full flex flex-col overflow-hidden backdrop-blur-sm bg-card/95", className)}>
					<CardHeader className="pb-3 border-b bg-gradient-to-r from-primary/5 to-accent/5">
						<CardTitle className="text-sm flex items-center gap-2">
							<motion.div
								animate={{ rotate: 360 }}
								transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
							>
								<Activity className="h-4 w-4 text-primary" />
							</motion.div>
							<span className="font-semibold">Timeline View</span>
							<Sparkles className="h-3 w-3 text-yellow-500" />
							<Badge 
								variant="outline" 
								className="ml-auto bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20"
							>
								<Timer className="h-3 w-3 mr-1" />
								{tasks.length} tasks
							</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent className="flex-1 p-0">
						<ScrollArea className="h-full">
							<div className="p-6 min-w-[900px]">
								{/* Enhanced Timeline Header with Dates */}
								<motion.div 
									className="mb-6 relative h-16 rounded-lg bg-gradient-to-b from-muted/30 to-muted/10 border-b-2 border-border/50"
									initial={{ scaleX: 0 }}
									animate={{ scaleX: 1 }}
									transition={{ duration: 0.7, ease: "easeOut" }}
								>
									<div className="absolute inset-0 flex items-center">
										{dateLabels.map((dateInfo, index) => (
											<motion.div
												key={index}
												className="flex-1 text-center border-r border-dashed border-muted-foreground/20 last:border-r-0 px-2 py-2"
												style={{ minWidth: `${100 / timelineData.days}%` }}
												initial={{ opacity: 0, y: -10 }}
												animate={{ opacity: 1, y: 0 }}
												transition={{ delay: index * 0.05, duration: 0.3 }}
											>
												<div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
													{dateInfo.dayLabel}
												</div>
												<div className="text-sm font-medium">
													{dateInfo.label}
												</div>
											</motion.div>
										))}
									</div>
								</motion.div>

							{/* Enhanced Swimlanes by Assignee */}
							<div className="space-y-8">
								<AnimatePresence mode="wait">
									{Array.from(tasksByAssignee.entries()).map(([assignee, assigneeTasks], swimlaneIndex) => (
										<motion.div
											key={assignee}
											className="space-y-3"
											initial={{ opacity: 0, x: -50 }}
											animate={{ opacity: 1, x: 0 }}
											transition={{ delay: swimlaneIndex * 0.1, duration: 0.5 }}
											onMouseEnter={() => setHoveredSwimlane(assignee)}
											onMouseLeave={() => setHoveredSwimlane(null)}
										>
											{/* Enhanced Swimlane Header */}
											<div className="flex items-center gap-3 mb-3">
												<motion.div
													className={cn(
														"p-2 rounded-full",
														"bg-gradient-to-br from-primary/20 to-accent/20",
														"border border-primary/30",
														hoveredSwimlane === assignee && "scale-110"
													)}
													whileHover={{ scale: 1.1 }}
													transition={{ type: "spring", stiffness: 300 }}
												>
													<User className="h-4 w-4 text-primary" />
												</motion.div>
												<span className="text-sm font-semibold text-foreground">
													{assignee}
												</span>
												<Badge 
													variant="outline" 
													className={cn(
														"text-xs transition-all",
														"bg-gradient-to-r from-primary/5 to-accent/5",
														hoveredSwimlane === assignee && "scale-105 shadow-sm"
													)}
												>
													<Activity className="h-3 w-3 mr-1" />
													{assigneeTasks.length} {assigneeTasks.length === 1 ? "task" : "tasks"}
												</Badge>
											</div>
											
											{/* Enhanced Timeline Track with Depth */}
											<motion.div 
												className={cn(
													"relative h-24 rounded-lg transition-all duration-300",
													"bg-gradient-to-b from-muted/10 to-muted/30",
													"border border-border/50 shadow-sm",
													hoveredSwimlane === assignee && "shadow-md border-primary/30 bg-gradient-to-b from-primary/5 to-accent/5"
												)}
												layout
											>
												{/* Enhanced Grid lines with depth */}
												<div className="absolute inset-0 flex rounded-lg overflow-hidden">
													{dateLabels.map((_, index) => (
														<div
															key={index}
															className={cn(
																"flex-1 border-r border-dashed",
																"border-muted-foreground/10 last:border-r-0",
																"hover:bg-muted/5 transition-colors"
															)}
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
											</motion.div>
										</motion.div>
									))}
								</AnimatePresence>
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
			</motion.div>
		</TooltipProvider>
	);
}