import { useState, useEffect, useRef, useMemo } from "react";
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	useSensor,
	useSensors,
	closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
	arrayMove,
} from "@dnd-kit/sortable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	LayoutGrid,
	Plus,
	RefreshCw,
	Filter,
	User,
	Clock,
	CheckCircle2,
	XCircle,
	PlayCircle,
	AlertCircle,
	Calendar,
	Tag,
	ListTodo,
	Zap,
	Paperclip,
	GitBranch,
	BarChart3,
	Activity,
	FolderOpen,
	Layers,
} from "lucide-react";
import { TaskCard } from "./TaskCard";
import { TaskDetailModal } from "./TaskDetailModal";
import { InstanceManager } from "./InstanceManager";
import { RoleSelector } from "./RoleSelector";
import { ContextGenerationDialog } from "./ContextGenerationDialog";
import { TaskTimeline } from "./TaskTimeline";
import { TaskGantt } from "./TaskGantt";
import { TaskWaterfall } from "./TaskWaterfall";
import {
	getEventClient,
	useEventQuery,
	useCreateTask,
	useUpdateTask,
	useCompleteTask,
	useDeleteTask,
	useGenerateContext,
	useEventMutation,
} from "@/services/event-client";
import { format } from "date-fns";

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
	result?: any;
	error?: any;
	attachmentCount?: number;
}

interface Instance {
	id: string;
	roles: string[];
	status?: string;
	health?: string;
}

interface Column {
	id: string;
	title: string;
	status: Task["status"];
	icon: React.ReactNode;
	color: string;
	tasks: Task[];
}

interface TaskKanbanProps {
	className?: string;
}

export function TaskKanban({ className }: TaskKanbanProps) {
	// State
	const [tasks, setTasks] = useState<Task[]>([]);
	const [instances, setInstances] = useState<Instance[]>([]);
	const [selectedTask, setSelectedTask] = useState<Task | null>(null);
	const [detailModalOpen, setDetailModalOpen] = useState(false);
	const [contextTask, setContextTask] = useState<Task | null>(null);
	const [contextDialogOpen, setContextDialogOpen] = useState(false);
	const [columns, setColumns] = useState<Column[]>([
		{
			id: "pending",
			title: "Pending",
			status: "pending",
			icon: <Clock className="h-4 w-4" />,
			color: "text-gray-500",
			tasks: [],
		},
		{
			id: "in_progress",
			title: "In Progress",
			status: "in_progress",
			icon: <PlayCircle className="h-4 w-4" />,
			color: "text-blue-500",
			tasks: [],
		},
		{
			id: "completed",
			title: "Completed",
			status: "completed",
			icon: <CheckCircle2 className="h-4 w-4" />,
			color: "text-green-500",
			tasks: [],
		},
		{
			id: "failed",
			title: "Failed",
			status: "failed",
			icon: <XCircle className="h-4 w-4" />,
			color: "text-red-500",
			tasks: [],
		},
	]);

	// Dialog states
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newTaskText, setNewTaskText] = useState("");
	const [newTaskPriority, setNewTaskPriority] = useState([50]);
	const [newTaskAssignTo, setNewTaskAssignTo] = useState<string>("none");
	const [newTaskRoles, setNewTaskRoles] = useState<string[]>([]);
	const [newTaskTags, setNewTaskTags] = useState("");
	const [newTaskDueDate, setNewTaskDueDate] = useState("");
	
	// Filters
	const [filterAssignee, setFilterAssignee] = useState<string>("all");
	const [filterProject, setFilterProject] = useState<string>("all");
	const [filterPriority, setFilterPriority] = useState<[number, number]>([0, 100]);
	const [searchTerm, setSearchTerm] = useState("");
	const [viewMode, setViewMode] = useState<"board" | "swimlanes">("board");
	const [groupByProject, setGroupByProject] = useState<boolean>(false);
	
	// Drag state
	const [activeId, setActiveId] = useState<string | null>(null);
	const [overId, setOverId] = useState<string | null>(null);
	
	// WebSocket connection
	const connectionRef = useRef<{ ws: WebSocket; subscriptions: Set<string>; close: () => void } | null>(null);
	
	// Sensors for drag and drop
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8, // Require 8px drag before activation
			},
		})
	);

	// Queries and Mutations
	const { 
		data: taskListData, 
		isLoading, 
		refetch: refetchState 
	} = useEventQuery(
		"task.list",
		{
			limit: 1000, // Get all tasks for kanban
			orderBy: "createdAt",
			order: "desc"
		},
		{ refetchInterval: 10000 }
	);
	
	// Get instances separately using system.get_state (instances are less critical)
	const { data: systemState } = useEventQuery(
		"system.get_state",
		{},
		{ refetchInterval: 30000 } // Less frequent polling for instances
	);
	
	const createTaskMutation = useCreateTask();
	const updateTaskMutation = useUpdateTask();
	const completeTaskMutation = useCompleteTask();
	const deleteTaskMutation = useDeleteTask();
	const assignTaskMutation = useEventMutation("task.assign");
	const generateContextMutation = useGenerateContext();

	// WebSocket connection for real-time updates
	useEffect(() => {
		const taskEvents = [
			"task.create",
			"task.update",
			"task.assign",
			"task.complete",
		];

		const connection = getEventClient().subscribeToEvents(
			taskEvents,
			(data: any) => {
				// Refresh state on any task event
				console.log("Task event received:", data);
				refetchState();
			},
			(error) => {
				console.error("WebSocket error:", error);
			},
			() => {
				console.log("WebSocket connected");
			},
			() => {
				console.log("WebSocket disconnected");
			}
		);

		connectionRef.current = connection;

		return () => {
			if (connectionRef.current) {
				connectionRef.current.close();
			}
		};
	}, [refetchState]);

	// Update tasks from task list data
	useEffect(() => {
		if (taskListData?.tasks) {
			const taskList = taskListData.tasks.map((task: any) => ({
				id: task.id,
				text: task.text || task.title || "Untitled Task",
				status: task.status || "pending",
				priority: task.priority || 50,
				createdAt: task.createdAt || new Date().toISOString(),
				updatedAt: task.updatedAt,
				completedAt: task.completedAt,
				metadata: task.metadata || {},
				assignedTo: task.assignedTo || task.assignee,
				result: task.result,
				error: task.error,
				attachmentCount: task.attachmentCount || 0,
			}));
			setTasks(taskList);
		}
		
		if (systemState?.instances) {
			const instanceList = systemState.instances.map((inst: any) => {
				let roles: string[] = [];
				if (inst.roles) {
					if (Array.isArray(inst.roles)) {
						roles = inst.roles;
					} else if (typeof inst.roles === 'string') {
						try {
							const parsed = JSON.parse(inst.roles);
							roles = Array.isArray(parsed) ? parsed : [parsed];
						} catch {
							roles = [inst.roles];
						}
					}
				}
				return {
					id: inst.id || inst.instanceId,
					roles,
					status: inst.status,
					health: inst.health,
				};
			});
			setInstances(instanceList);
		}
	}, [taskListData]);

	// Organize tasks into columns
	useEffect(() => {
		const newColumns = columns.map((column) => ({
			...column,
			tasks: tasks.filter((task) => task.status === column.status),
		}));
		setColumns(newColumns);
	}, [tasks]);

	// Get unique projects from tasks
	const projects = useMemo(() => {
		const projectMap = new Map<string, { id: string; name: string }>();
		tasks.forEach((task) => {
			const projectId = task.metadata?.projectId;
			const projectName = task.metadata?.projectName || task.metadata?.projectText;
			if (projectId && !projectMap.has(projectId)) {
				projectMap.set(projectId, {
					id: projectId,
					name: projectName || projectId,
				});
			}
		});
		return Array.from(projectMap.values());
	}, [tasks]);

	// Filter tasks
	const filteredTasks = useMemo(() => {
		return tasks.filter((task) => {
			// Search filter
			if (searchTerm && !task.text.toLowerCase().includes(searchTerm.toLowerCase())) {
				return false;
			}
			
			// Assignee filter
			if (filterAssignee !== "all") {
				if (filterAssignee === "unassigned" && task.assignedTo) return false;
				if (filterAssignee !== "unassigned" && task.assignedTo !== filterAssignee) return false;
			}
			
			// Project filter
			if (filterProject !== "all") {
				const taskProjectId = task.metadata?.projectId;
				if (filterProject === "unassigned" && taskProjectId) return false;
				if (filterProject !== "unassigned" && taskProjectId !== filterProject) return false;
			}
			
			// Priority filter
			if (task.priority < filterPriority[0] || task.priority > filterPriority[1]) {
				return false;
			}
			
			return true;
		});
	}, [tasks, searchTerm, filterAssignee, filterProject, filterPriority]);

	// Get filtered columns
	const filteredColumns = useMemo(() => {
		if (groupByProject) {
			// Group by project
			const projectColumns: Column[] = [];
			
			// Add column for tasks without project
			const unassignedTasks = filteredTasks.filter((task) => !task.metadata?.projectId);
			if (unassignedTasks.length > 0) {
				projectColumns.push({
					id: "no-project",
					title: "No Project",
					status: "pending", // Default status for drag-drop compatibility
					icon: <FolderOpen className="h-4 w-4" />,
					color: "text-gray-500",
					tasks: unassignedTasks,
				});
			}
			
			// Add column for each project
			projects.forEach((project) => {
				const projectTasks = filteredTasks.filter((task) => task.metadata?.projectId === project.id);
				if (projectTasks.length > 0) {
					projectColumns.push({
						id: project.id,
						title: project.name,
						status: "pending", // Default status for drag-drop compatibility
						icon: <FolderOpen className="h-4 w-4" />,
						color: "text-blue-500",
						tasks: projectTasks,
					});
				}
			});
			
			return projectColumns;
		} else {
			// Group by status (default)
			return columns.map((column) => ({
				...column,
				tasks: filteredTasks.filter((task) => task.status === column.status),
			}));
		}
	}, [columns, filteredTasks, groupByProject, projects]);

	// Handle drag start
	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	// Handle drag over
	const handleDragOver = (event: DragOverEvent) => {
		setOverId(event.over?.id as string | null);
	};

	// Handle drag end
	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		
		if (!over) {
			setActiveId(null);
			setOverId(null);
			return;
		}

		const activeTask = tasks.find((t) => t.id === active.id);
		if (!activeTask) return;

		const overId = over.id as string;
		
		// Check if dropping on a column
		const overColumn = columns.find((col) => col.id === overId);
		if (overColumn && activeTask.status !== overColumn.status) {
			// Update task status
			try {
				await updateTaskMutation.mutateAsync({
					id: activeTask.id,
					updates: {
						status: overColumn.status,
					},
				});
				await refetchState();
			} catch (error) {
				console.error("Failed to update task status:", error);
			}
		}
		
		// Check if dropping on another task (for reordering)
		const overTask = tasks.find((t) => t.id === overId);
		if (overTask && activeTask.id !== overTask.id) {
			// Handle reordering within the same column
			const activeColumn = columns.find((col) => col.status === activeTask.status);
			const overColumn = columns.find((col) => col.status === overTask.status);
			
			if (activeColumn && overColumn && activeColumn.id === overColumn.id) {
				// Reorder tasks within the same column
				const columnTasks = activeColumn.tasks;
				const oldIndex = columnTasks.findIndex((t) => t.id === activeTask.id);
				const newIndex = columnTasks.findIndex((t) => t.id === overTask.id);
				
				if (oldIndex !== -1 && newIndex !== -1) {
					const reorderedTasks = arrayMove(columnTasks, oldIndex, newIndex);
					// Update column tasks
					setColumns((prev) =>
						prev.map((col) =>
							col.id === activeColumn.id
								? { ...col, tasks: reorderedTasks }
								: col
						)
					);
				}
			} else if (activeColumn && overColumn && activeColumn.id !== overColumn.id) {
				// Moving to a different column
				try {
					await updateTaskMutation.mutateAsync({
						id: activeTask.id,
						updates: {
							status: overColumn.status,
						},
					});
					await refetchState();
				} catch (error) {
					console.error("Failed to update task status:", error);
				}
			}
		}
		
		setActiveId(null);
		setOverId(null);
	};

	// Create new task
	const handleCreateTask = async () => {
		if (!newTaskText) return;

		try {
			const metadata: Record<string, any> = {};
			
			// Add role assignment to metadata
			if (newTaskRoles.length > 0) {
				metadata.roles = newTaskRoles;
			}
			
			// Add tags to metadata
			if (newTaskTags) {
				metadata.tags = newTaskTags.split(",").map((t) => t.trim()).filter(Boolean);
			}
			
			// Add due date to metadata
			if (newTaskDueDate) {
				metadata.dueDate = newTaskDueDate;
			}

			// Create the task
			const result = await createTaskMutation.mutateAsync({
				text: newTaskText,
				priority: newTaskPriority[0],
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			});

			// Assign to instance if specified
			if (newTaskAssignTo && newTaskAssignTo !== "none" && result.id) {
				await assignTaskMutation.mutateAsync({
					taskId: result.id,
					instanceId: newTaskAssignTo,
				});
			}

			// Reset form
			setNewTaskText("");
			setNewTaskPriority([50]);
			setNewTaskAssignTo("none");
			setNewTaskRoles([]);
			setNewTaskTags("");
			setNewTaskDueDate("");
			setCreateDialogOpen(false);

			// Refresh state
			await refetchState();
		} catch (error) {
			console.error("Failed to create task:", error);
		}
	};

	// Handle task actions
	const handleTaskUpdate = async (taskId: string, updates: any) => {
		try {
			await updateTaskMutation.mutateAsync({
				id: taskId,
				updates,
			});
			await refetchState();
		} catch (error) {
			console.error("Failed to update task:", error);
		}
	};

	const handleTaskComplete = async (taskId: string) => {
		try {
			await completeTaskMutation.mutateAsync({ id: taskId });
			await refetchState();
		} catch (error) {
			console.error("Failed to complete task:", error);
		}
	};

	const handleTaskDelete = async (taskId: string) => {
		console.log("handleTaskDelete called with taskId:", taskId);
		try {
			await deleteTaskMutation.mutateAsync({ id: taskId });
			await refetchState();
		} catch (error) {
			console.error("Failed to delete task:", error);
		}
	};

	const handleTaskAssign = async (taskId: string, instanceId: string) => {
		try {
			await assignTaskMutation.mutateAsync({
				taskId,
				instanceId,
			});
			await refetchState();
		} catch (error) {
			console.error("Failed to assign task:", error);
		}
	};

	const handleGenerateContext = (taskId: string) => {
		const task = tasks.find(t => t.id === taskId);
		if (task) {
			setContextTask(task);
			setContextDialogOpen(true);
		}
	};

	// Handle task click
	const handleTaskClick = (task: Task) => {
		setSelectedTask(task);
		setDetailModalOpen(true);
	};

	// Get active task for drag overlay
	const activeTask = useMemo(() => {
		return tasks.find((t) => t.id === activeId);
	}, [activeId, tasks]);

	// Calculate statistics
	const statistics = useMemo(() => {
		const total = tasks.length;
		const pending = tasks.filter((t) => t.status === "pending").length;
		const inProgress = tasks.filter((t) => t.status === "in_progress").length;
		const completed = tasks.filter((t) => t.status === "completed").length;
		const failed = tasks.filter((t) => t.status === "failed").length;
		const assigned = tasks.filter((t) => t.assignedTo).length;
		const avgPriority = tasks.length > 0
			? Math.round(tasks.reduce((sum, t) => sum + t.priority, 0) / tasks.length)
			: 0;
		const totalAttachments = tasks.reduce((sum, t) => sum + (t.attachmentCount || 0), 0);

		return {
			total,
			pending,
			inProgress,
			completed,
			failed,
			assigned,
			avgPriority,
			totalAttachments,
		};
	}, [tasks]);

	return (
		<div className={className}>
			<Tabs defaultValue="kanban" className="h-full flex flex-col">
				<div className="flex items-center justify-between mb-4">
					<TabsList>
						<TabsTrigger value="kanban">
							<LayoutGrid className="h-4 w-4 mr-2" />
							Kanban
						</TabsTrigger>
						<TabsTrigger value="timeline">
							<Activity className="h-4 w-4 mr-2" />
							Timeline
						</TabsTrigger>
						<TabsTrigger value="gantt">
							<BarChart3 className="h-4 w-4 mr-2" />
							Gantt
						</TabsTrigger>
						<TabsTrigger value="waterfall">
							<GitBranch className="h-4 w-4 mr-2" />
							Waterfall
						</TabsTrigger>
						<TabsTrigger value="instances">
							<User className="h-4 w-4 mr-2" />
							Instances
						</TabsTrigger>
					</TabsList>

					<div className="flex items-center gap-2">
						{/* Statistics */}
						<div className="flex items-center gap-4 mr-4">
							<Badge variant="outline">
								<ListTodo className="h-3 w-3 mr-1" />
								{statistics.total} tasks
							</Badge>
							<Badge variant="outline" className="text-blue-500 border-blue-500">
								<PlayCircle className="h-3 w-3 mr-1" />
								{statistics.inProgress} active
							</Badge>
							<Badge variant="outline" className="text-green-500 border-green-500">
								<CheckCircle2 className="h-3 w-3 mr-1" />
								{statistics.completed} done
							</Badge>
							<Badge variant="outline" className="text-purple-500 border-purple-500">
								<Paperclip className="h-3 w-3 mr-1" />
								{statistics.totalAttachments} attachments
							</Badge>
						</div>

						{/* Actions */}
						<Button onClick={() => refetchState()} variant="outline" size="sm">
							<RefreshCw className="h-4 w-4 mr-2" />
							Refresh
						</Button>
						<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
							<DialogTrigger asChild>
								<Button size="sm">
									<Plus className="h-4 w-4 mr-2" />
									New Task
								</Button>
							</DialogTrigger>
							<DialogContent className="sm:max-w-[600px]">
								<DialogHeader>
									<DialogTitle>Create New Task</DialogTitle>
									<DialogDescription>
										Add a new task to the kanban board
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
											rows={3}
										/>
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="grid gap-2">
											<Label htmlFor="task-priority">
												Priority: {newTaskPriority[0]}
											</Label>
											<Slider
												id="task-priority"
												value={newTaskPriority}
												onValueChange={setNewTaskPriority}
												min={0}
												max={100}
												step={10}
											/>
										</div>
										<div className="grid gap-2">
											<Label htmlFor="task-due">Due Date</Label>
											<Input
												id="task-due"
												type="date"
												value={newTaskDueDate}
												onChange={(e) => setNewTaskDueDate(e.target.value)}
											/>
										</div>
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="grid gap-2">
											<Label htmlFor="task-assign">Assign To Instance</Label>
											<Select value={newTaskAssignTo} onValueChange={setNewTaskAssignTo}>
												<SelectTrigger id="task-assign">
													<SelectValue placeholder="Select instance..." />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="none">None</SelectItem>
													{instances.map((instance) => (
														<SelectItem key={instance.id} value={instance.id}>
															{instance.id} ({instance.roles.length > 0 ? instance.roles.join(", ") : "no roles"})
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="grid gap-2">
											<Label>Assign To Role(s)</Label>
											<RoleSelector
												selectedRoles={newTaskRoles}
												onRolesChange={setNewTaskRoles}
												placeholder="Select roles..."
											/>
										</div>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="task-tags">Tags (comma-separated)</Label>
										<Input
											id="task-tags"
											placeholder="bug, feature, urgent"
											value={newTaskTags}
											onChange={(e) => setNewTaskTags(e.target.value)}
										/>
									</div>
								</div>
								<DialogFooter>
									<Button onClick={handleCreateTask} disabled={!newTaskText}>
										<Plus className="h-4 w-4 mr-2" />
										Create Task
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>
				</div>

				<TabsContent value="kanban" className="flex-1 min-h-0">
					{/* Filters */}
					<div className="flex flex-col gap-3 mb-4">
						<div className="flex items-center gap-4">
							<div className="flex-1">
								<Input
									placeholder="Search tasks..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="max-w-sm"
								/>
							</div>
							<Select value={filterAssignee} onValueChange={setFilterAssignee}>
								<SelectTrigger className="w-[200px]">
									<User className="h-4 w-4 mr-2" />
									<SelectValue placeholder="Filter by assignee" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Assignees</SelectItem>
									<SelectItem value="unassigned">Unassigned</SelectItem>
									{instances.map((instance) => (
										<SelectItem key={instance.id} value={instance.id}>
											{instance.id}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={filterProject} onValueChange={setFilterProject}>
								<SelectTrigger className="w-[200px]">
									<FolderOpen className="h-4 w-4 mr-2" />
									<SelectValue placeholder="Filter by project" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Projects</SelectItem>
									<SelectItem value="unassigned">No Project</SelectItem>
									{projects.map((project) => (
										<SelectItem key={project.id} value={project.id}>
											{project.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="text-sm text-muted-foreground">View Mode:</span>
								<ToggleGroup type="single" value={groupByProject ? "project" : "status"} onValueChange={(value) => setGroupByProject(value === "project")}>
									<ToggleGroupItem value="status" aria-label="Group by status">
										<Layers className="h-4 w-4 mr-2" />
										By Status
									</ToggleGroupItem>
									<ToggleGroupItem value="project" aria-label="Group by project">
										<FolderOpen className="h-4 w-4 mr-2" />
										By Project
									</ToggleGroupItem>
								</ToggleGroup>
							</div>
							{groupByProject && projects.length === 0 && (
								<Alert className="py-2 px-3">
									<AlertCircle className="h-4 w-4" />
									<AlertDescription className="text-xs">
										No projects found. Create projects to use project view.
									</AlertDescription>
								</Alert>
							)}
						</div>
					</div>

					{/* Kanban Board */}
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragStart={handleDragStart}
						onDragOver={handleDragOver}
						onDragEnd={handleDragEnd}
					>
						<div 
							className="grid gap-6 h-full"
							style={{
								gridTemplateColumns: groupByProject
									? `repeat(${Math.min(filteredColumns.length, 4)}, minmax(320px, 1fr))`
									: "repeat(4, minmax(320px, 1fr))"
							}}>
							{filteredColumns.map((column) => (
								<div key={column.id} className="flex flex-col h-full">
									<Card className="flex-1 flex flex-col min-w-[320px]">
										<CardHeader className="pb-3">
											<CardTitle className="text-sm flex items-center justify-between">
												<div className={`flex items-center gap-2 ${column.color}`}>
													{column.icon}
													{column.title}
												</div>
												<Badge variant="outline" className="text-xs">
													{column.tasks.length}
												</Badge>
											</CardTitle>
										</CardHeader>
										<CardContent className="flex-1 min-h-0 pb-2">
											<ScrollArea className="h-full pr-2">
												<SortableContext
													items={column.tasks.map((t) => t.id)}
													strategy={verticalListSortingStrategy}
													id={column.id}
												>
													<div
														className={`min-h-[100px] ${
															overId === column.id
																? "bg-muted/50 rounded-md"
																: ""
														}`}
													>
														{column.tasks.map((task) => (
															<TaskCard
																key={task.id}
																task={task}
																onUpdate={handleTaskUpdate}
																onComplete={handleTaskComplete}
																onDelete={handleTaskDelete}
																onGenerateContext={handleGenerateContext}
																onAssign={handleTaskAssign}
																onClick={handleTaskClick}
																instances={instances}
															/>
														))}
														{column.tasks.length === 0 && (
															<div className="text-center text-muted-foreground text-sm py-8">
																Drop tasks here
															</div>
														)}
													</div>
												</SortableContext>
											</ScrollArea>
										</CardContent>
									</Card>
								</div>
							))}
						</div>
						<DragOverlay>
							{activeTask && (
								<TaskCard
									task={activeTask}
									isDragging
									instances={instances}
								/>
							)}
						</DragOverlay>
					</DndContext>
				</TabsContent>

				<TabsContent value="timeline" className="flex-1 min-h-0">
					<TaskTimeline
						tasks={filteredTasks}
						onTaskClick={handleTaskClick}
						className="h-full"
					/>
				</TabsContent>

				<TabsContent value="gantt" className="flex-1 min-h-0">
					<TaskGantt
						tasks={filteredTasks}
						onTaskClick={handleTaskClick}
						className="h-full"
					/>
				</TabsContent>

				<TabsContent value="waterfall" className="flex-1 min-h-0">
					<TaskWaterfall
						tasks={filteredTasks}
						onTaskClick={handleTaskClick}
						className="h-full"
					/>
				</TabsContent>

				<TabsContent value="instances" className="flex-1 min-h-0">
					<InstanceManager
						onInstancesChange={setInstances}
						className="h-full"
					/>
				</TabsContent>
			</Tabs>

			{/* Task Detail Modal */}
			<TaskDetailModal
				task={selectedTask}
				open={detailModalOpen}
				onOpenChange={(open) => {
					setDetailModalOpen(open);
					if (!open) {
						// Refresh tasks when closing in case of changes
						refetchState();
					}
				}}
				onUpdate={handleTaskUpdate}
				onComplete={handleTaskComplete}
				onDelete={handleTaskDelete}
				onAssign={handleTaskAssign}
				instances={instances}
			/>
			
			{/* Context Generation Dialog */}
			<ContextGenerationDialog
				task={contextTask}
				open={contextDialogOpen}
				onOpenChange={(open) => {
					setContextDialogOpen(open);
					if (!open) {
						setContextTask(null);
						// Refresh to show any attachments
						refetchState();
					}
				}}
				onSuccess={(context) => {
					console.log("Context generated successfully:", context);
					// Could show a toast notification here
				}}
			/>
		</div>
	);
}