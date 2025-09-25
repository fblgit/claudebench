import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	ComposedChart,
	Bar,
	Line,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	Cell,
	ReferenceLine,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	GitBranch,
	Clock,
	CheckCircle2,
	XCircle,
	PlayCircle,
	AlertCircle,
	ArrowDown,
	Calendar,
	User,
	Flag,
	Paperclip,
} from "lucide-react";
import { format, parseISO, differenceInDays, differenceInHours, addDays } from "date-fns";
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

interface TaskWaterfallProps {
	tasks: Task[];
	onTaskClick?: (task: Task) => void;
	className?: string;
}

interface WaterfallData {
	phase: string;
	taskId: string;
	taskName: string;
	status: string;
	priority: number;
	assignee: string;
	duration: number;
	cumulativeDuration: number;
	startOffset: number;
	dependencies: string[];
	blockedBy: string[];
	task: Task;
}

// Custom dot for milestone markers
const MilestoneDot = (props: any) => {
	const { cx, cy, payload } = props;
	
	const getColor = () => {
		switch (payload.status) {
			case "completed": return "#10b981";
			case "failed": return "#ef4444";
			case "in_progress": return "#3b82f6";
			default: return "#9ca3af";
		}
	};
	
	return (
		<g transform={`translate(${cx},${cy})`}>
			<circle r="6" fill={getColor()} fillOpacity="0.8" stroke="#fff" strokeWidth="2" />
			{payload.priority >= 80 && (
				<circle r="8" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="2 2" />
			)}
		</g>
	);
};

// Custom tooltip
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
							Duration: {data.duration} days
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
					{data.dependencies && data.dependencies.length > 0 && (
						<div className="flex items-center gap-1">
							<GitBranch className="h-3 w-3" />
							Dependencies: {data.dependencies.join(", ")}
						</div>
					)}
					{data.blockedBy && data.blockedBy.length > 0 && (
						<div className="flex items-center gap-1">
							<AlertCircle className="h-3 w-3 text-orange-500" />
							Blocked by: {data.blockedBy.join(", ")}
						</div>
					)}
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
				</div>
			</div>
		);
	}
	return null;
};

export function TaskWaterfall({ tasks, onTaskClick, className }: TaskWaterfallProps) {
	// Process tasks into waterfall data
	const { waterfallData, phases, chartConfig } = useMemo(() => {
		if (!tasks || tasks.length === 0) {
			return { waterfallData: [], phases: [], chartConfig: {} };
		}

		// Sort tasks by priority (highest first) to establish waterfall flow
		const sortedTasks = [...tasks].sort((a, b) => 
			b.priority - a.priority
		);

		// Group tasks into phases based on status and timing
		const phaseGroups = new Map<string, Task[]>();
		
		// Analyze task relationships
		const taskMap = new Map(tasks.map(t => [t.id, t]));
		
		sortedTasks.forEach(task => {
			// Determine phase based on status and timing (recent tasks = early phases)
			let phase = "Phase 4: Deployment";
			
			// Check if task has dependencies in metadata
			const deps = task.metadata?.dependencies as string[] || [];
			const blockedBy = task.metadata?.blockedBy as string[] || [];
			
			// Determine phase based on task characteristics
			if (task.status === "failed") {
				// Failed tasks always in issues phase
				phase = "Phase X: Issues";
			} else if (task.status === "in_progress") {
				// In progress tasks are in active development
				phase = "Phase 1: Active Development";
			} else if (task.status === "pending") {
				// Pending tasks
				if (blockedBy.length > 0) {
					phase = "Phase 2: Blocked/Waiting";
				} else {
					phase = "Phase 1: Active Development";
				}
			} else if (task.status === "completed") {
				// Completed tasks - recent ones in testing, older in deployment
				const completedDate = parseISO(task.completedAt!);
				const daysSinceCompletion = differenceInDays(new Date(), completedDate);
				
				if (daysSinceCompletion < 2) {
					phase = "Phase 3: Recently Completed";
				} else if (daysSinceCompletion < 7) {
					phase = "Phase 4: Deployed";
				} else {
					phase = "Phase 5: Archive";
				}
			}
			
			if (!phaseGroups.has(phase)) {
				phaseGroups.set(phase, []);
			}
			phaseGroups.get(phase)?.push(task);
		});

		// Convert to waterfall data format
		const data: WaterfallData[] = [];
		let cumulativeDuration = 0;
		const phaseOrder = [
			"Phase X: Issues",
			"Phase 1: Active Development",
			"Phase 2: Blocked/Waiting", 
			"Phase 3: Recently Completed",
			"Phase 4: Deployed",
			"Phase 5: Archive"
		];
		
		phaseOrder.forEach((phaseName) => {
			const phaseTasks = phaseGroups.get(phaseName) || [];
			
			// Sort tasks within phase by priority (highest first)
			phaseTasks.sort((a, b) => 
				b.priority - a.priority
			);
			
			phaseTasks.forEach(task => {
				const startDate = parseISO(task.createdAt);
				let endDate = new Date();
				
				if (task.completedAt) {
					endDate = parseISO(task.completedAt);
				} else if (task.metadata?.dueDate) {
					endDate = parseISO(task.metadata.dueDate);
				} else if (task.updatedAt) {
					endDate = parseISO(task.updatedAt);
				} else {
					// Estimate based on priority
					const estimatedDays = Math.ceil((100 - task.priority) / 20);
					endDate = addDays(startDate, estimatedDays);
				}
				
				const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
				const deps = task.metadata?.dependencies as string[] || [];
				const blockedBy = task.metadata?.blockedBy as string[] || [];
				
				data.push({
					phase: phaseName,
					taskId: task.id,
					taskName: task.text.length > 40 ? task.text.substring(0, 40) + "..." : task.text,
					status: task.status,
					priority: task.priority,
					assignee: task.assignedTo || "Unassigned",
					duration,
					cumulativeDuration: cumulativeDuration + duration,
					startOffset: cumulativeDuration,
					dependencies: deps,
					blockedBy,
					task,
				});
				
				// Only add to cumulative for sequential flow
				if (phaseTasks.indexOf(task) === phaseTasks.length - 1) {
					cumulativeDuration += duration;
				}
			});
		});

		// Chart configuration
		const config = {
			duration: {
				label: "Duration (days)",
				color: "hsl(var(--chart-1))",
			},
			cumulativeDuration: {
				label: "Cumulative Duration",
				color: "hsl(var(--chart-2))",
			},
		};

		return { 
			waterfallData: data,
			phases: phaseOrder.filter(p => phaseGroups.has(p)),
			chartConfig: config
		};
	}, [tasks]);

	// Get status icon
	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle2 className="h-4 w-4 text-green-500" />;
			case "failed":
				return <XCircle className="h-4 w-4 text-red-500" />;
			case "in_progress":
				return <PlayCircle className="h-4 w-4 text-blue-500" />;
			default:
				return <Clock className="h-4 w-4 text-gray-500" />;
		}
	};

	// Get status color
	const getStatusColor = (status: string) => {
		switch (status) {
			case "completed": return "#10b981";
			case "failed": return "#ef4444";
			case "in_progress": return "#3b82f6";
			default: return "#9ca3af";
		}
	};

	if (tasks.length === 0) {
		return (
			<div className={cn("flex items-center justify-center h-64 text-muted-foreground", className)}>
				No tasks to display in waterfall view
			</div>
		);
	}

	return (
		<TooltipProvider>
			<Card className={cn("h-full flex flex-col", className)}>
				<CardHeader className="pb-3">
					<CardTitle className="text-sm flex items-center gap-2">
						<GitBranch className="h-4 w-4" />
						Waterfall View
						<Badge variant="outline" className="ml-auto">
							{tasks.length} tasks
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 p-4">
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
						{/* Phase Swimlanes */}
						<div className="lg:col-span-2">
							<ScrollArea className="h-full">
								<div className="space-y-4">
									{phases.map((phase, phaseIndex) => {
										const phaseTasks = waterfallData.filter(d => d.phase === phase);
										const isIssuePhase = phase.includes("Issues");
										
										return (
											<div key={phase} className="space-y-2">
												<div className="flex items-center gap-2 mb-2">
													<div className={cn(
														"w-2 h-2 rounded-full",
														isIssuePhase ? "bg-red-500" : "bg-blue-500"
													)} />
													<h3 className="font-medium text-sm">{phase}</h3>
													<Badge variant="outline" className="text-xs">
														{phaseTasks.length} tasks
													</Badge>
												</div>
												
												<div className="pl-4 space-y-2">
													{phaseTasks.map((data, index) => (
														<div
															key={data.taskId}
															className="relative"
														>
															{/* Connection line to next task */}
															{index < phaseTasks.length - 1 && (
																<div className="absolute left-3 top-8 bottom-0 w-0.5 bg-border" />
															)}
															
															{/* Task Card */}
															<div
																className={cn(
																	"flex items-start gap-3 p-3 rounded-lg border",
																	"hover:bg-muted/50 cursor-pointer transition-colors",
																	data.status === "failed" && "border-red-500/50 bg-red-50/5"
																)}
																onClick={() => onTaskClick?.(data.task)}
															>
																{/* Status Icon */}
																<div className="mt-0.5">
																	{getStatusIcon(data.status)}
																</div>
																
																{/* Task Content */}
																<div className="flex-1 min-w-0">
																	<div className="flex items-start justify-between gap-2">
																		<div className="flex-1">
																			<p className="text-sm font-medium truncate">
																				{data.taskName}
																			</p>
																			<p className="text-xs text-muted-foreground mt-1">
																				{data.assignee} • {data.duration} days
																			</p>
																		</div>
																		<Badge
																			variant="outline"
																			className={cn(
																				"text-xs",
																				data.priority >= 80 && "border-red-500 text-red-500"
																			)}
																		>
																			P{data.priority}
																		</Badge>
																	</div>
																	
																	{/* Dependencies/Blockers */}
																	{(data.dependencies.length > 0 || data.blockedBy.length > 0) && (
																		<div className="mt-2 flex flex-wrap gap-1">
																			{data.dependencies.length > 0 && (
																				<Badge variant="secondary" className="text-xs">
																					<GitBranch className="h-3 w-3 mr-1" />
																					{data.dependencies.length} deps
																				</Badge>
																			)}
																			{data.blockedBy.length > 0 && (
																				<Badge variant="destructive" className="text-xs">
																					<AlertCircle className="h-3 w-3 mr-1" />
																					Blocked
																				</Badge>
																			)}
																		</div>
																	)}
																</div>
																
																{/* Attachments */}
																{data.task.attachmentCount ? (
																	<Badge variant="outline" className="text-xs">
																		<Paperclip className="h-3 w-3" />
																		{data.task.attachmentCount}
																	</Badge>
																) : null}
															</div>
															
															{/* Connection to next phase */}
															{phaseIndex < phases.length - 1 && 
															 index === phaseTasks.length - 1 && (
																<div className="flex justify-center mt-2 mb-2">
																	<ArrowDown className="h-4 w-4 text-muted-foreground" />
																</div>
															)}
														</div>
													))}
												</div>
											</div>
										);
									})}
								</div>
							</ScrollArea>
						</div>

						{/* Cumulative Chart */}
						<div className="space-y-4">
							<div className="text-sm font-medium">Cumulative Progress</div>
							<ChartContainer config={chartConfig} className="h-[300px]">
								<ResponsiveContainer width="100%" height="100%">
									<ComposedChart
										data={waterfallData}
										margin={{ top: 20, right: 20, bottom: 60, left: 20 }}
									>
										<CartesianGrid strokeDasharray="3 3" opacity={0.3} />
										<XAxis
											dataKey="taskId"
											angle={-45}
											textAnchor="end"
											height={100}
											fontSize={10}
											tick={false}
										/>
										<YAxis
											fontSize={11}
											label={{ value: 'Days', angle: -90, position: 'insideLeft' }}
										/>
										<RechartsTooltip content={<CustomTooltip />} />
										<Area
											type="stepAfter"
											dataKey="cumulativeDuration"
											stroke="#3b82f6"
											fill="#3b82f6"
											fillOpacity={0.2}
											strokeWidth={2}
										/>
										<Bar
											dataKey="duration"
											barSize={20}
											radius={[4, 4, 0, 0]}
										>
											{waterfallData.map((entry, index) => (
												<Cell 
													key={`cell-${index}`} 
													fill={getStatusColor(entry.status)}
													fillOpacity={0.8}
												/>
											))}
										</Bar>
										<Line
											type="monotone"
											dataKey="cumulativeDuration"
											stroke="#10b981"
											strokeWidth={2}
											dot={<MilestoneDot />}
										/>
									</ComposedChart>
								</ResponsiveContainer>
							</ChartContainer>

							{/* Statistics */}
							<div className="space-y-2 text-xs">
								<div className="flex justify-between">
									<span className="text-muted-foreground">Total Duration</span>
									<span className="font-medium">
										{Math.max(...waterfallData.map(d => d.cumulativeDuration))} days
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Active Phases</span>
									<span className="font-medium">{phases.length}</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Blocked Tasks</span>
									<span className="font-medium text-orange-500">
										{waterfallData.filter(d => d.blockedBy.length > 0).length}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">Critical Tasks</span>
									<span className="font-medium text-red-500">
										{waterfallData.filter(d => d.priority >= 80).length}
									</span>
								</div>
							</div>
						</div>
					</div>

					{/* Legend */}
					<div className="mt-4 pt-4 border-t flex items-center justify-center gap-4 text-xs">
						<div className="flex items-center gap-1">
							<Clock className="h-3 w-3 text-gray-500" />
							<span>Pending</span>
						</div>
						<div className="flex items-center gap-1">
							<PlayCircle className="h-3 w-3 text-blue-500" />
							<span>In Progress</span>
						</div>
						<div className="flex items-center gap-1">
							<CheckCircle2 className="h-3 w-3 text-green-500" />
							<span>Completed</span>
						</div>
						<div className="flex items-center gap-1">
							<XCircle className="h-3 w-3 text-red-500" />
							<span>Failed</span>
						</div>
						<div className="ml-4 flex items-center gap-1">
							<AlertCircle className="h-3 w-3 text-orange-500" />
							<span>Blocked</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</TooltipProvider>
	);
}