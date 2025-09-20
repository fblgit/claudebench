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
											
											{/* Enhanced Task Bars with Animations */}
											{assigneeTasks.map((task, taskIndex) => {
												const position = getTaskPosition(task);
												const yOffset = (taskIndex % 3) * 25; // Better stacking with 3 levels
												const isHovered = hoveredTask === task.id;
												
												return (
													<Tooltip key={task.id}>
														<TooltipTrigger asChild>
															<motion.div
																className={cn(
																	"absolute rounded-lg cursor-pointer",
																	"flex items-center gap-1 px-2 overflow-hidden",
																	"border border-white/20",
																	getStatusColor(task.status, isHovered)
																)}
																style={{
																	...position,
																	top: `${16 + yOffset}px`,
																	height: "28px",
																	minWidth: "80px",
																	zIndex: isHovered ? 30 : taskIndex + 10,
																}}
																initial={{ opacity: 0, scale: 0.8 }}
																animate={{ 
																	opacity: 1, 
																	scale: isHovered ? 1.05 : 1,
																}}
																whileHover={{ 
																	y: -2,
																	transition: { duration: 0.2 }
																}}
																transition={{ 
																	delay: taskIndex * 0.05,
																	duration: 0.3
																}}
																onClick={() => onTaskClick?.(task)}
																onMouseEnter={() => setHoveredTask(task.id)}
																onMouseLeave={() => setHoveredTask(null)}
															>
																{/* Priority gradient overlay */}
																<div 
																	className={cn(
																		"absolute inset-0 opacity-30",
																		"bg-gradient-to-r",
																		getPriorityColor(task.priority)
																	)} 
																/>
																
																{/* Content */}
																<div className="relative flex items-center gap-1 z-10">
																	{getStatusIcon(task.status)}
																	<span className="text-xs text-white font-medium truncate">
																		{task.text}
																	</span>
																</div>
																
																{/* Attachment indicator */}
																{task.attachmentCount && task.attachmentCount > 0 && (
																	<motion.div 
																		className="absolute top-1 right-1"
																		initial={{ scale: 0 }}
																		animate={{ scale: 1 }}
																		transition={{ delay: 0.2 }}
																	>
																		<Badge className="h-4 px-1 bg-white/20 text-white text-[10px] border-0">
																			<Paperclip className="h-2 w-2" />
																			{task.attachmentCount}
																		</Badge>
																	</motion.div>
																)}
															</motion.div>
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

							{/* Enhanced Legend */}
							<motion.div 
								className="mt-8 p-4 rounded-lg bg-gradient-to-r from-muted/20 to-muted/10 border border-border/50"
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: 0.5 }}
							>
								<div className="flex items-center justify-center gap-6 text-xs">
									<motion.div 
										className="flex items-center gap-2"
										whileHover={{ scale: 1.05 }}
									>
										<div className="w-4 h-4 rounded bg-gradient-to-r from-gray-400 to-gray-500 shadow-sm" />
										<span className="font-medium">Pending</span>
									</motion.div>
									<motion.div 
										className="flex items-center gap-2"
										whileHover={{ scale: 1.05 }}
									>
										<div className="w-4 h-4 rounded bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm animate-pulse" />
										<span className="font-medium">In Progress</span>
									</motion.div>
									<motion.div 
										className="flex items-center gap-2"
										whileHover={{ scale: 1.05 }}
									>
										<div className="w-4 h-4 rounded bg-gradient-to-r from-green-500 to-emerald-500 shadow-sm" />
										<span className="font-medium">Completed</span>
									</motion.div>
									<motion.div 
										className="flex items-center gap-2"
										whileHover={{ scale: 1.05 }}
									>
										<div className="w-4 h-4 rounded bg-gradient-to-r from-red-500 to-rose-500 shadow-sm" />
										<span className="font-medium">Failed</span>
									</motion.div>
								</div>
							</motion.div>
						</div>
						<ScrollBar orientation="horizontal" />
					</ScrollArea>
				</CardContent>
			</Card>
			</motion.div>
		</TooltipProvider>
	);
}