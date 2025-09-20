import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	Cell,
	Rectangle,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	Calendar,
	Clock,
	CheckCircle2,
	XCircle,
	PlayCircle,
	Flag,
	User,
	Paperclip,
} from "lucide-react";
import { format, parseISO, differenceInDays, startOfDay, endOfDay, addDays, subDays } from "date-fns";
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

interface GanttData {
	taskName: string;
	taskId: string;
	assignee: string;
	start: number;
	duration: number;
	progress: number;
	status: string;
	priority: number;
	task: Task;
}

// Custom bar shape for Gantt bars with progress indicator
const GanttBar = (props: any) => {
	const { fill, x, y, width, height, payload } = props;
	const progressWidth = width * (payload.progress / 100);
	
	// Status colors
	const getStatusColor = (status: string) => {
		switch (status) {
			case "completed":
				return { base: "#10b981", progress: "#059669" }; // green
			case "failed":
				return { base: "#ef4444", progress: "#dc2626" }; // red
			case "in_progress":
				return { base: "#3b82f6", progress: "#2563eb" }; // blue
			default:
				return { base: "#9ca3af", progress: "#6b7280" }; // gray
		}
	};
	
	const colors = getStatusColor(payload.status);
	
	return (
		<g>
			{/* Base bar */}
			<Rectangle
				{...props}
				fill={colors.base}
				fillOpacity={0.3}
				stroke={colors.base}
				strokeWidth={1}
			/>
			{/* Progress bar */}
			{payload.progress > 0 && (
				<Rectangle
					{...props}
					width={progressWidth}
					fill={colors.progress}
					fillOpacity={0.8}
				/>
			)}
			{/* Priority indicator */}
			{payload.priority >= 80 && (
				<rect
					x={x + width - 4}
					y={y}
					width={4}
					height={height}
					fill="#ef4444"
					fillOpacity={0.8}
				/>
			)}
		</g>
	);
};

// Custom tooltip content
const CustomTooltip = ({ active, payload }: any) => {
	if (active && payload && payload[0]) {
		const data = payload[0].payload;
		const task = data.task as Task;
		
		return (
			<div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
				<div className="font-medium mb-2">{task.text}</div>
				<div className="space-y-1 text-xs">
					<div className="flex items-center gap-2">
						<Badge variant="outline" className="text-xs">
							{task.status.replace('_', ' ')}
						</Badge>
						<span className="text-muted-foreground">
							{data.progress}% complete
						</span>
					</div>
					{task.assignedTo && (
						<div className="flex items-center gap-1">
							<User className="h-3 w-3" />
							{task.assignedTo}
						</div>
					)}
					<div className="flex items-center gap-1">
						<Flag className="h-3 w-3" />
						Priority: {task.priority}
					</div>
					<div className="flex items-center gap-1">
						<Calendar className="h-3 w-3" />
						Created: {format(parseISO(task.createdAt), 'MMM d, yyyy')}
					</div>
					{task.completedAt && (
						<div className="flex items-center gap-1">
							<CheckCircle2 className="h-3 w-3 text-green-500" />
							Completed: {format(parseISO(task.completedAt), 'MMM d, yyyy')}
						</div>
					)}
					{task.metadata?.dueDate && (
						<div className="flex items-center gap-1">
							<Clock className="h-3 w-3" />
							Due: {format(parseISO(task.metadata.dueDate), 'MMM d, yyyy')}
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
		);
	}
	return null;
};

export function TaskGantt({ tasks, onTaskClick, className }: TaskGanttProps) {
	// Process tasks into Gantt chart data
	const { ganttData, dateRange, chartConfig } = useMemo(() => {
		if (!tasks || tasks.length === 0) {
			return { 
				ganttData: [], 
				dateRange: { start: new Date(), end: new Date(), days: 1 },
				chartConfig: {} 
			};
		}

		// Find date boundaries
		let earliestDate = new Date();
		let latestDate = new Date();
		
		tasks.forEach(task => {
			const createdDate = parseISO(task.createdAt);
			if (createdDate < earliestDate || earliestDate.getTime() === new Date().getTime()) {
				earliestDate = createdDate;
			}
			
			// Calculate end date
			let endDate = new Date();
			if (task.completedAt) {
				endDate = parseISO(task.completedAt);
			} else if (task.metadata?.dueDate) {
				endDate = parseISO(task.metadata.dueDate);
			} else if (task.updatedAt) {
				endDate = parseISO(task.updatedAt);
			} else {
				// For pending/in-progress tasks without dates, estimate based on priority
				const estimatedDays = Math.ceil((100 - task.priority) / 20); // Higher priority = shorter estimate
				endDate = addDays(createdDate, estimatedDays);
			}
			
			if (endDate > latestDate || latestDate.getTime() === new Date().getTime()) {
				latestDate = endDate;
			}
		});

		// Add padding
		const projectStart = subDays(earliestDate, 2);
		const projectEnd = addDays(latestDate, 2);
		const totalDays = differenceInDays(projectEnd, projectStart) + 1;

		// Convert tasks to Gantt data format
		const data: GanttData[] = tasks.map(task => {
			const startDate = parseISO(task.createdAt);
			let endDate = new Date();
			
			if (task.completedAt) {
				endDate = parseISO(task.completedAt);
			} else if (task.metadata?.dueDate) {
				endDate = parseISO(task.metadata.dueDate);
			} else if (task.updatedAt) {
				endDate = parseISO(task.updatedAt);
			} else {
				const estimatedDays = Math.ceil((100 - task.priority) / 20);
				endDate = addDays(startDate, estimatedDays);
			}

			const startOffset = differenceInDays(startDate, projectStart);
			const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
			
			// Calculate progress based on status
			let progress = 0;
			if (task.status === "completed") {
				progress = 100;
			} else if (task.status === "failed") {
				progress = 0;
			} else if (task.status === "in_progress") {
				// Estimate progress based on time elapsed
				const elapsed = differenceInDays(new Date(), startDate);
				const expectedDuration = differenceInDays(endDate, startDate) || 1;
				progress = Math.min(95, Math.max(10, (elapsed / expectedDuration) * 100));
			}

			return {
				taskName: task.text.length > 30 ? task.text.substring(0, 30) + "..." : task.text,
				taskId: task.id,
				assignee: task.assignedTo || "Unassigned",
				start: startOffset,
				duration,
				progress: Math.round(progress),
				status: task.status,
				priority: task.priority,
				task,
			};
		});

		// Sort by start date and priority
		data.sort((a, b) => {
			if (a.start === b.start) {
				return b.priority - a.priority;
			}
			return a.start - b.start;
		});

		// Chart configuration
		const config = {
			duration: {
				label: "Duration",
				color: "hsl(var(--chart-1))",
			},
		};

		return { 
			ganttData: data, 
			dateRange: { 
				start: projectStart, 
				end: projectEnd, 
				days: totalDays 
			},
			chartConfig: config
		};
	}, [tasks]);

	// Generate X-axis labels
	const xAxisTicks = useMemo(() => {
		const ticks = [];
		const { start, days } = dateRange;
		
		// Show weekly ticks for longer timelines, daily for shorter
		const interval = days > 30 ? 7 : days > 14 ? 3 : 1;
		
		for (let i = 0; i < days; i += interval) {
			const date = addDays(start, i);
			ticks.push({
				value: i,
				label: format(date, days > 30 ? 'MMM d' : 'MMM d'),
			});
		}
		
		return ticks;
	}, [dateRange]);

	if (tasks.length === 0) {
		return (
			<div className={cn("flex items-center justify-center h-64 text-muted-foreground", className)}>
				No tasks to display in Gantt chart
			</div>
		);
	}

	return (
		<Card className={cn("h-full flex flex-col", className)}>
			<CardHeader className="pb-3">
				<CardTitle className="text-sm flex items-center gap-2">
					<Calendar className="h-4 w-4" />
					Gantt Chart
					<Badge variant="outline" className="ml-auto">
						{tasks.length} tasks
					</Badge>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 p-4">
				<ScrollArea className="h-full">
					<ChartContainer config={chartConfig} className="min-h-[400px] w-full">
						<ResponsiveContainer width="100%" height={Math.max(400, ganttData.length * 50)}>
							<BarChart
								data={ganttData}
								layout="horizontal"
								margin={{ top: 20, right: 30, left: 150, bottom: 40 }}
								onClick={(data) => {
									if (data && 'activePayload' in data && data.activePayload) {
										const payload = data.activePayload as any[];
										if (payload.length > 0) {
											const task = payload[0].payload.task;
											onTaskClick?.(task);
										}
									}
								}}
							>
								<CartesianGrid 
									strokeDasharray="3 3" 
									horizontal={true}
									vertical={true}
									stroke="hsl(var(--border))"
									opacity={0.3}
								/>
								<XAxis
									type="number"
									domain={[0, dateRange.days]}
									ticks={xAxisTicks.map(t => t.value)}
									tickFormatter={(value) => {
										const tick = xAxisTicks.find(t => t.value === value);
										return tick?.label || '';
									}}
									stroke="hsl(var(--muted-foreground))"
									fontSize={11}
								/>
								<YAxis
									type="category"
									dataKey="taskName"
									width={140}
									tick={{ fontSize: 11 }}
									stroke="hsl(var(--muted-foreground))"
								/>
								<RechartsTooltip
									content={<CustomTooltip />}
									cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }}
								/>
								<Bar
									dataKey="duration"
									shape={GanttBar}
									radius={4}
									maxBarSize={30}
								/>
							</BarChart>
						</ResponsiveContainer>
					</ChartContainer>
				</ScrollArea>

				{/* Legend */}
				<div className="mt-4 flex items-center justify-center gap-4 text-xs">
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
					<div className="ml-4 flex items-center gap-1">
						<div className="w-8 h-3 bg-gray-400 rounded opacity-30 relative">
							<div className="absolute inset-y-0 left-0 w-1/2 bg-gray-600 rounded-l" />
						</div>
						<span>Progress</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}