import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { 
	getEventClient,
	useEventQuery,
	useCreateTask,
	useUpdateTask,
	useCompleteTask,
	useEventMutation
} from "@/services/event-client";
import { 
	ListTodo,
	Plus,
	Check,
	X,
	Clock,
	AlertCircle,
	ChevronRight,
	Filter,
	ArrowUpDown,
	Play,
	Pause,
	RefreshCw,
	User,
	Hash,
	Calendar,
	Flag
} from "lucide-react";

// Task type based on the schema
interface Task {
	id: string;
	text: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority: number;
	createdAt: string;
	updatedAt?: string;
	metadata?: Record<string, any>;
	assignedTo?: string;
}

interface TaskQueueProps {
	maxTasks?: number;
	autoRefresh?: boolean;
	showFilters?: boolean;
	className?: string;
}

export function TaskQueue({ 
	maxTasks = 100,
	autoRefresh = true,
	showFilters = true,
	className
}: TaskQueueProps) {
	// State
	const [tasks, setTasks] = useState<Task[]>([]);
	const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
	const [selectedTask, setSelectedTask] = useState<Task | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	
	// Filters
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [priorityRange, setPriorityRange] = useState<number[]>([0, 100]);
	const [searchTerm, setSearchTerm] = useState("");
	const [sortBy, setSortBy] = useState<"priority" | "created" | "status">("priority");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
	
	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newTaskText, setNewTaskText] = useState("");
	const [newTaskPriority, setNewTaskPriority] = useState(50);
	
	// Refs
	const connectionRef = useRef<{ ws: WebSocket; subscriptions: Set<string>; close: () => void } | null>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	
	// Queries and Mutations
	// Use new task.list handler for comprehensive task data
	const { data: taskListData, isLoading, refetch } = useEventQuery(
		"task.list", 
		{
			limit: 1000, // Get all tasks for now
			orderBy: "createdAt",
			order: "desc"
		},
		{ 
			refetchInterval: 30000, // Poll every 30 seconds
		}
	);
	const createTaskMutation = useCreateTask();
	const updateTaskMutation = useUpdateTask();
	const completeTaskMutation = useCompleteTask();
	const assignTaskMutation = useEventMutation("task.assign");
	const claimTaskMutation = useEventMutation("task.claim");
	
	// Connect to WebSocket for real-time updates
	const connectWebSocket = useCallback(() => {
		const client = getEventClient();
		
		connectionRef.current = client.subscribeToEvents(
			["task.*"],
			(message: any) => {
				try {
					if (message.type === "event") {
						const eventType = message.event;
						// Backend sends events with {type, payload, metadata} structure
						const eventPayload = message.data.payload;
						const eventMetadata = message.data.metadata;
						
						// Handle different task events
						if (eventType === "task.created") {
							// Backend sends: {id, text, status, priority, createdAt}
							setTasks(prev => {
								const newTask: Task = {
									id: eventPayload.id,
									text: eventPayload.text,
									status: eventPayload.status,
									priority: eventPayload.priority,
									createdAt: eventPayload.createdAt,
									metadata: eventMetadata
								};
								return [newTask, ...prev].slice(0, maxTasks);
							});
						} else if (eventType === "task.updated") {
							// Backend sends full task object: {id, text, status, priority, createdAt, updatedAt}
							setTasks(prev => prev.map(task => 
								task.id === eventPayload.id 
									? { ...task, ...eventPayload, metadata: { ...task.metadata, ...eventMetadata } }
									: task
							));
						} else if (eventType === "task.completed") {
							// Backend sends: {id, status, duration}
							setTasks(prev => prev.map(task => 
								task.id === eventPayload.id 
									? { ...task, status: eventPayload.status, updatedAt: new Date().toISOString() }
									: task
							));
						} else if (eventType === "task.assigned") {
							// Backend sends: {taskId, instanceId, previousAssignment}
							// Status remains "pending" per backend logic
							setTasks(prev => prev.map(task => 
								task.id === eventPayload.taskId 
									? { ...task, assignedTo: eventPayload.instanceId }
									: task
							));
						} else if (eventType === "task.claimed") {
							// Backend sends: {taskId, workerId}
							setTasks(prev => prev.map(task => 
								task.id === eventPayload.taskId 
									? { ...task, status: "in_progress", assignedTo: eventPayload.workerId }
									: task
							));
						}
					}
				} catch (error) {
					console.error("Failed to process task event:", error);
				}
			},
			(error: Error) => {
				console.error("WebSocket error:", error);
				setIsConnected(false);
			},
			() => {
				setIsConnected(true);
			},
			() => {
				setIsConnected(false);
			}
		);
	}, [maxTasks]);
	
	// Disconnect WebSocket
	const disconnectWebSocket = useCallback(() => {
		if (connectionRef.current) {
			connectionRef.current.close();
			connectionRef.current = null;
		}
		setIsConnected(false);
	}, []);
	
	// Initialize tasks from task list data
	useEffect(() => {
		if (taskListData?.tasks) {
			setTasks(taskListData.tasks as Task[]);
		}
	}, [taskListData]);
	
	// Connect to WebSocket on mount
	useEffect(() => {
		connectWebSocket();
		return disconnectWebSocket;
	}, [connectWebSocket, disconnectWebSocket]);
	
	// Filter and sort tasks
	useEffect(() => {
		let filtered = [...tasks];
		
		// Status filter
		if (statusFilter !== "all") {
			filtered = filtered.filter(t => t.status === statusFilter);
		}
		
		// Priority filter
		filtered = filtered.filter(t => 
			t.priority >= priorityRange[0] && t.priority <= priorityRange[1]
		);
		
		// Search filter
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(t => 
				t.text.toLowerCase().includes(term) ||
				t.id.toLowerCase().includes(term) ||
				(t.metadata && JSON.stringify(t.metadata).toLowerCase().includes(term))
			);
		}
		
		// Sorting
		filtered.sort((a, b) => {
			let comparison = 0;
			switch (sortBy) {
				case "priority":
					comparison = a.priority - b.priority;
					break;
				case "created":
					comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
				case "status":
					const statusOrder = { pending: 0, in_progress: 1, completed: 2, failed: 3 };
					comparison = statusOrder[a.status] - statusOrder[b.status];
					break;
			}
			return sortOrder === "asc" ? comparison : -comparison;
		});
		
		setFilteredTasks(filtered);
	}, [tasks, statusFilter, priorityRange, searchTerm, sortBy, sortOrder]);
	
	// Get status color
	const getStatusColor = (status: Task["status"]): string => {
		switch (status) {
			case "pending": return "yellow";
			case "in_progress": return "blue";
			case "completed": return "green";
			case "failed": return "red";
			default: return "gray";
		}
	};
	
	// Get status icon
	const getStatusIcon = (status: Task["status"]) => {
		switch (status) {
			case "pending": return <Clock className="h-4 w-4" />;
			case "in_progress": return <Play className="h-4 w-4" />;
			case "completed": return <Check className="h-4 w-4" />;
			case "failed": return <X className="h-4 w-4" />;
		}
	};
	
	// Get priority badge variant
	const getPriorityVariant = (priority: number): "destructive" | "secondary" | "outline" => {
		if (priority >= 80) return "destructive";
		if (priority >= 50) return "secondary";
		return "outline";
	};
	
	// Format date
	const formatDate = (dateStr: string): string => {
		return new Date(dateStr).toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		});
	};
	
	// Create new task
	const handleCreateTask = async () => {
		if (!newTaskText.trim()) return;
		
		await createTaskMutation.mutateAsync({
			text: newTaskText,
			priority: newTaskPriority,
			metadata: {
				createdFrom: "TaskQueue"
			}
		});
		
		setNewTaskText("");
		setNewTaskPriority(50);
		setCreateDialogOpen(false);
	};
	
	// Update task status
	const handleUpdateStatus = async (taskId: string, status: Task["status"]) => {
		await updateTaskMutation.mutateAsync({
			id: taskId,
			updates: { status }
		});
	};
	
	// Complete task
	const handleCompleteTask = async (taskId: string) => {
		await completeTaskMutation.mutateAsync({ id: taskId });
	};
	
	// Claim task (for workers)
	const handleClaimTask = async () => {
		await claimTaskMutation.mutateAsync({
			workerId: `worker-${Date.now()}`,
			maxTasks: 1
		});
	};
	
	// Task stats
	const taskStats = useMemo(() => {
		return {
			total: tasks.length,
			pending: tasks.filter(t => t.status === "pending").length,
			inProgress: tasks.filter(t => t.status === "in_progress").length,
			completed: tasks.filter(t => t.status === "completed").length,
			failed: tasks.filter(t => t.status === "failed").length,
		};
	}, [tasks]);
	
	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<ListTodo className="h-5 w-5" />
							Task Queue
						</CardTitle>
						<CardDescription>
							Manage and monitor system tasks
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant={isConnected ? "default" : "secondary"}>
							{isConnected ? "Connected" : "Disconnected"}
						</Badge>
						<Badge variant="outline">
							{taskStats.total} tasks
						</Badge>
						{taskStats.inProgress > 0 && (
							<Badge variant="default">
								{taskStats.inProgress} active
							</Badge>
						)}
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* Controls */}
				{showFilters && (
					<div className="flex flex-wrap gap-2">
						{/* Status Filter */}
						<Select value={statusFilter} onValueChange={setStatusFilter}>
							<SelectTrigger className="w-[150px]">
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								<SelectItem value="pending">Pending</SelectItem>
								<SelectItem value="in_progress">In Progress</SelectItem>
								<SelectItem value="completed">Completed</SelectItem>
								<SelectItem value="failed">Failed</SelectItem>
							</SelectContent>
						</Select>
						
						{/* Sort Options */}
						<Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
							<SelectTrigger className="w-[150px]">
								<SelectValue placeholder="Sort by" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="priority">Priority</SelectItem>
								<SelectItem value="created">Created</SelectItem>
								<SelectItem value="status">Status</SelectItem>
							</SelectContent>
						</Select>
						
						<Button
							variant="outline"
							size="sm"
							onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
						>
							<ArrowUpDown className="h-4 w-4" />
						</Button>
						
						{/* Search */}
						<div className="flex-1">
							<Input
								placeholder="Search tasks..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
							/>
						</div>
						
						{/* Actions */}
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetch()}
						>
							<RefreshCw className="h-4 w-4" />
						</Button>
						
						<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
							<DialogTrigger asChild>
								<Button size="sm">
									<Plus className="h-4 w-4 mr-1" />
									New Task
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Create New Task</DialogTitle>
									<DialogDescription>
										Add a new task to the queue
									</DialogDescription>
								</DialogHeader>
								<div className="grid gap-4 py-4">
									<div className="grid gap-2">
										<Label htmlFor="task-text">Task Description</Label>
										<Textarea
											id="task-text"
											placeholder="Enter task description..."
											value={newTaskText}
											onChange={(e) => setNewTaskText(e.target.value)}
											maxLength={500}
										/>
										<span className="text-xs text-muted-foreground">
											{newTaskText.length}/500 characters
										</span>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="task-priority">
											Priority: {newTaskPriority}
										</Label>
										<Slider
											id="task-priority"
											min={0}
											max={100}
											step={1}
											value={[newTaskPriority]}
											onValueChange={(v) => setNewTaskPriority(v[0])}
										/>
										<div className="flex justify-between text-xs text-muted-foreground">
											<span>Low (0)</span>
											<span>Medium (50)</span>
											<span>High (100)</span>
										</div>
									</div>
								</div>
								<DialogFooter>
									<Button
										onClick={handleCreateTask}
										disabled={!newTaskText.trim() || createTaskMutation.isPending}
									>
										Create Task
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
						
						<Button
							variant="outline"
							size="sm"
							onClick={handleClaimTask}
							disabled={claimTaskMutation.isPending}
						>
							<User className="h-4 w-4 mr-1" />
							Claim Task
						</Button>
					</div>
				)}
				
				{/* Priority Range Filter */}
				{showFilters && (
					<div className="flex items-center gap-4">
						<Label className="text-sm">Priority Range:</Label>
						<div className="flex items-center gap-2 flex-1">
							<span className="text-sm">{priorityRange[0]}</span>
							<Slider
								min={0}
								max={100}
								step={1}
								value={priorityRange}
								onValueChange={setPriorityRange}
								className="flex-1"
							/>
							<span className="text-sm">{priorityRange[1]}</span>
						</div>
					</div>
				)}
				
				{/* Task Statistics */}
				<div className="grid grid-cols-5 gap-2">
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold">{taskStats.total}</div>
							<p className="text-xs text-muted-foreground">Total</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-yellow-600">{taskStats.pending}</div>
							<p className="text-xs text-muted-foreground">Pending</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-blue-600">{taskStats.inProgress}</div>
							<p className="text-xs text-muted-foreground">Active</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-green-600">{taskStats.completed}</div>
							<p className="text-xs text-muted-foreground">Done</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-red-600">{taskStats.failed}</div>
							<p className="text-xs text-muted-foreground">Failed</p>
						</CardContent>
					</Card>
				</div>
				
				{/* Task List */}
				<div className="flex-1 flex gap-4 min-h-0">
					<ScrollArea className="flex-1 border rounded-md" ref={scrollAreaRef}>
						<div className="p-4 space-y-2">
							{isLoading ? (
								<div className="text-center text-muted-foreground py-8">
									Loading tasks...
								</div>
							) : filteredTasks.length === 0 ? (
								<div className="text-center text-muted-foreground py-8">
									{tasks.length === 0 ? "No tasks in queue" : "No tasks match filters"}
								</div>
							) : (
								filteredTasks.map((task) => (
									<Card
										key={task.id}
										className={`cursor-pointer transition-colors hover:bg-accent ${
											selectedTask?.id === task.id ? "bg-accent" : ""
										}`}
										onClick={() => setSelectedTask(task)}
									>
										<CardContent className="p-3">
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2 mb-1">
														<Badge
															variant={getStatusColor(task.status) as any}
															className="gap-1"
														>
															{getStatusIcon(task.status)}
															{task.status.replace("_", " ")}
														</Badge>
														<Badge variant={getPriorityVariant(task.priority)}>
															<Flag className="h-3 w-3 mr-1" />
															{task.priority}
														</Badge>
														<span className="text-xs text-muted-foreground">
															{task.id}
														</span>
													</div>
													<p className="text-sm font-medium line-clamp-2">
														{task.text}
													</p>
													<div className="flex items-center gap-3 mt-1">
														<span className="text-xs text-muted-foreground flex items-center gap-1">
															<Calendar className="h-3 w-3" />
															{formatDate(task.createdAt)}
														</span>
														{task.assignedTo && (
															<span className="text-xs text-muted-foreground flex items-center gap-1">
																<User className="h-3 w-3" />
																{task.assignedTo}
															</span>
														)}
													</div>
												</div>
												<div className="flex items-center gap-1">
													{task.status === "pending" && (
														<Button
															size="sm"
															variant="ghost"
															onClick={(e) => {
																e.stopPropagation();
																handleUpdateStatus(task.id, "in_progress");
															}}
														>
															<Play className="h-4 w-4" />
														</Button>
													)}
													{task.status === "in_progress" && (
														<Button
															size="sm"
															variant="ghost"
															onClick={(e) => {
																e.stopPropagation();
																handleCompleteTask(task.id);
															}}
														>
															<Check className="h-4 w-4" />
														</Button>
													)}
													<ChevronRight className="h-4 w-4 text-muted-foreground" />
												</div>
											</div>
										</CardContent>
									</Card>
								))
							)}
						</div>
					</ScrollArea>
					
					{/* Task Detail */}
					{selectedTask && (
						<Card className="w-[400px] flex flex-col">
							<CardHeader className="pb-3">
								<CardTitle className="text-base">Task Details</CardTitle>
								<CardDescription className="text-xs">
									{selectedTask.id}
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 overflow-auto">
								<div className="space-y-4">
									<div>
										<Label className="text-xs">Description</Label>
										<p className="text-sm mt-1">{selectedTask.text}</p>
									</div>
									
									<Separator />
									
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="text-xs">Status</Label>
											<div className="mt-1">
												<Badge
													variant={getStatusColor(selectedTask.status) as any}
													className="gap-1"
												>
													{getStatusIcon(selectedTask.status)}
													{selectedTask.status.replace("_", " ")}
												</Badge>
											</div>
										</div>
										<div>
											<Label className="text-xs">Priority</Label>
											<div className="mt-1">
												<Badge variant={getPriorityVariant(selectedTask.priority)}>
													<Flag className="h-3 w-3 mr-1" />
													{selectedTask.priority}
												</Badge>
											</div>
										</div>
									</div>
									
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="text-xs">Created</Label>
											<p className="text-sm mt-1">
												{formatDate(selectedTask.createdAt)}
											</p>
										</div>
										{selectedTask.updatedAt && (
											<div>
												<Label className="text-xs">Updated</Label>
												<p className="text-sm mt-1">
													{formatDate(selectedTask.updatedAt)}
												</p>
											</div>
										)}
									</div>
									
									{selectedTask.assignedTo && (
										<div>
											<Label className="text-xs">Assigned To</Label>
											<p className="text-sm mt-1">{selectedTask.assignedTo}</p>
										</div>
									)}
									
									{selectedTask.metadata && Object.keys(selectedTask.metadata).length > 0 && (
										<div>
											<Label className="text-xs">Metadata</Label>
											<pre className="text-xs bg-muted p-2 rounded-md mt-1 overflow-auto">
												{JSON.stringify(selectedTask.metadata, null, 2)}
											</pre>
										</div>
									)}
									
									<Separator />
									
									<div className="flex gap-2">
										{selectedTask.status === "pending" && (
											<Button
												size="sm"
												onClick={() => handleUpdateStatus(selectedTask.id, "in_progress")}
											>
												<Play className="h-4 w-4 mr-1" />
												Start
											</Button>
										)}
										{selectedTask.status === "in_progress" && (
											<>
												<Button
													size="sm"
													onClick={() => handleCompleteTask(selectedTask.id)}
												>
													<Check className="h-4 w-4 mr-1" />
													Complete
												</Button>
												<Button
													size="sm"
													variant="destructive"
													onClick={() => handleUpdateStatus(selectedTask.id, "failed")}
												>
													<X className="h-4 w-4 mr-1" />
													Fail
												</Button>
											</>
										)}
										{(selectedTask.status === "completed" || selectedTask.status === "failed") && (
											<Button
												size="sm"
												variant="outline"
												onClick={() => handleUpdateStatus(selectedTask.id, "pending")}
											>
												<RefreshCw className="h-4 w-4 mr-1" />
												Retry
											</Button>
										)}
									</div>
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			</CardContent>
		</Card>
	);
}