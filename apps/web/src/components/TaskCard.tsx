import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Clock,
	User,
	Flag,
	MoreVertical,
	CheckCircle,
	XCircle,
	PlayCircle,
	AlertCircle,
	Calendar,
	Tag,
	Hash,
	Paperclip,
	Brain,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

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

interface TaskCardProps {
	task: Task;
	isDragging?: boolean;
	onUpdate?: (taskId: string, updates: any) => void;
	onComplete?: (taskId: string) => void;
	onAssign?: (taskId: string, instanceId: string) => void;
	onDelete?: (taskId: string) => void;
	onGenerateContext?: (taskId: string) => void;
	onClick?: (task: Task) => void;
	instances?: Array<{ id: string; roles: string[] }>;
}

export function TaskCard({
	task,
	isDragging = false,
	onUpdate,
	onComplete,
	onAssign,
	onDelete,
	onClick,
	instances = [],
}: TaskCardProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable({ 
		id: task.id,
		data: {
			type: "task",
			task,
		},
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
		cursor: isDragging ? "grabbing" : "grab",
	};

	// Priority color mapping
	const getPriorityColor = (priority: number) => {
		if (priority >= 80) return "text-red-500 border-red-500";
		if (priority >= 60) return "text-orange-500 border-orange-500";
		if (priority >= 40) return "text-yellow-500 border-yellow-500";
		if (priority >= 20) return "text-blue-500 border-blue-500";
		return "text-gray-500 border-gray-500";
	};

	// Status icon mapping
	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle className="h-4 w-4 text-green-500" />;
			case "failed":
				return <XCircle className="h-4 w-4 text-red-500" />;
			case "in_progress":
				return <PlayCircle className="h-4 w-4 text-blue-500" />;
			default:
				return <Clock className="h-4 w-4 text-gray-500" />;
		}
	};

	// Extract metadata
	const tags = task.metadata?.tags as string[] || [];
	const dueDate = task.metadata?.dueDate as string;
	const role = task.metadata?.role as string;
	const dependencies = task.metadata?.dependencies as string[] || [];

	return (
		<TooltipProvider>
			<Card
				ref={setNodeRef}
				style={style}
				className={cn(
					"mb-2 cursor-grab transition-all hover:shadow-md",
					isDragging && "shadow-lg ring-2 ring-primary",
					task.status === "completed" && "opacity-75",
					task.status === "failed" && "border-red-500"
				)}
				onClick={(e) => {
					// Only trigger onClick if not dragging and not clicking on interactive elements
					if (!isDragging && onClick && !e.defaultPrevented) {
						const target = e.target as HTMLElement;
						// Don't trigger if clicking on buttons or dropdown
						if (!target.closest('button') && !target.closest('[role="menu"]')) {
							onClick(task);
						}
					}
				}}
				{...attributes}
				{...listeners}
			>
				<CardHeader className="px-3 py-2">
					<div className="flex items-start justify-between gap-2">
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-1">
								{getStatusIcon(task.status)}
								<span className="text-xs text-muted-foreground">
									#{task.id}
								</span>
								{task.assignedTo && (
									<Tooltip>
										<TooltipTrigger>
											<Badge variant="outline" className="text-xs">
												<User className="h-3 w-3 mr-1" />
												{task.assignedTo}
											</Badge>
										</TooltipTrigger>
										<TooltipContent>
											Assigned to {task.assignedTo}
										</TooltipContent>
									</Tooltip>
								)}
							</div>
							<p className="text-sm font-medium line-clamp-2">
								{task.text}
							</p>
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									className="h-8 w-8 p-0"
									onClick={(e) => e.stopPropagation()}
								>
									<MoreVertical className="h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>Actions</DropdownMenuLabel>
								<DropdownMenuSeparator />
								{task.status !== "completed" && onComplete && (
									<DropdownMenuItem onClick={() => onComplete(task.id)}>
										<CheckCircle className="h-4 w-4 mr-2" />
										Mark Complete
									</DropdownMenuItem>
								)}
								{instances.length > 0 && onAssign && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuLabel>Assign To</DropdownMenuLabel>
										{instances.map((instance) => (
											<DropdownMenuItem
												key={instance.id}
												onClick={() => onAssign(task.id, instance.id)}
											>
												<User className="h-4 w-4 mr-2" />
												{instance.id}
												<span className="ml-auto text-xs text-muted-foreground">
													{instance.roles.join(", ")}
												</span>
											</DropdownMenuItem>
										))}
									</>
								)}
								{onDelete && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											onClick={(e) => {
												e.stopPropagation();
												console.log("Deleting task with ID:", task.id);
												onDelete(task.id);
											}}
											className="text-red-600"
										>
											<XCircle className="h-4 w-4 mr-2" />
											Delete
										</DropdownMenuItem>
									</>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</CardHeader>
				<CardContent className="px-3 pb-2 pt-0">
					<div className="flex flex-wrap items-center gap-2">
						{/* Priority Badge */}
						<Tooltip>
							<TooltipTrigger>
								<Badge
									variant="outline"
									className={cn("text-xs", getPriorityColor(task.priority))}
								>
									<Flag className="h-3 w-3 mr-1" />
									{task.priority}
								</Badge>
							</TooltipTrigger>
							<TooltipContent>Priority: {task.priority}/100</TooltipContent>
						</Tooltip>

						{/* Role Badge */}
						{role && (
							<Badge variant="secondary" className="text-xs">
								<Hash className="h-3 w-3 mr-1" />
								{role}
							</Badge>
						)}

						{/* Due Date */}
						{dueDate && (
							<Tooltip>
								<TooltipTrigger>
									<Badge variant="outline" className="text-xs">
										<Calendar className="h-3 w-3 mr-1" />
										{format(new Date(dueDate), "MMM d")}
									</Badge>
								</TooltipTrigger>
								<TooltipContent>
									Due: {format(new Date(dueDate), "PPP")}
								</TooltipContent>
							</Tooltip>
						)}

						{/* Tags */}
						{tags.length > 0 && (
							<div className="flex gap-1">
								{tags.slice(0, 2).map((tag) => (
									<Badge key={tag} variant="outline" className="text-xs">
										<Tag className="h-3 w-3 mr-1" />
										{tag}
									</Badge>
								))}
								{tags.length > 2 && (
									<Badge variant="outline" className="text-xs">
										+{tags.length - 2}
									</Badge>
								)}
							</div>
						)}

						{/* Dependencies Indicator */}
						{dependencies.length > 0 && (
							<Tooltip>
								<TooltipTrigger>
									<Badge variant="outline" className="text-xs">
										<AlertCircle className="h-3 w-3 mr-1" />
										{dependencies.length}
									</Badge>
								</TooltipTrigger>
								<TooltipContent>
									{dependencies.length} dependencies
								</TooltipContent>
							</Tooltip>
						)}

						{/* Attachments Indicator */}
						{task.attachmentCount && task.attachmentCount > 0 && (
							<Tooltip>
								<TooltipTrigger>
									<Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">
										<Paperclip className="h-3 w-3 mr-1" />
										{task.attachmentCount}
									</Badge>
								</TooltipTrigger>
								<TooltipContent>
									{task.attachmentCount} attachment{task.attachmentCount > 1 ? 's' : ''}
								</TooltipContent>
							</Tooltip>
						)}
					</div>

					{/* Timestamps */}
					<div className="mt-2 text-xs text-muted-foreground">
						{task.createdAt && !isNaN(Date.parse(task.createdAt)) ? (
							<>
								Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
								{task.updatedAt && 
								 task.updatedAt !== task.createdAt && 
								 !isNaN(Date.parse(task.updatedAt)) && (
									<span className="ml-2">
										• Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
									</span>
								)}
							</>
						) : (
							<span className="text-muted-foreground/50">No timestamp available</span>
						)}
					</div>
				</CardContent>
			</Card>
		</TooltipProvider>
	);
}