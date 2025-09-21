import { useEventQuery, useEventMutation } from "@/hooks/use-event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Types matching backend schemas
export interface ProjectData {
	id: string;
	text: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority: number;
	createdAt: string;
	updatedAt?: string;
	metadata?: {
		type?: string;
		projectId?: string;
		constraints?: string[];
		requirements?: string[];
		estimatedMinutes?: number;
		sessionId?: string;
		isParentTask?: boolean;
		stats?: {
			totalTasks: number;
			pendingTasks: number;
			inProgressTasks: number;
			completedTasks: number;
			failedTasks: number;
		};
	};
	attachmentCount?: number;
}

export interface ProjectDetailData {
	projectId: string;
	parentTask: {
		id: string;
		text: string;
		status: string;
		priority: number;
		createdAt: string;
		updatedAt: string;
		metadata?: Record<string, any>;
		attachments?: Array<{
			key: string;
			type: string;
			value?: any;
			createdAt: string;
		}>;
	};
	subtasks: Array<{
		id: string;
		text: string;
		status: string;
		priority: number;
		specialist?: string;
		complexity?: number;
		estimatedMinutes?: number;
		dependencies?: string[];
		createdAt: string;
		updatedAt: string;
		attachments?: Array<{
			key: string;
			type: string;
			value?: any;
			createdAt: string;
		}>;
	}>;
	projectMetadata: {
		description: string;
		status: string;
		constraints?: string[];
		requirements?: string[];
		estimatedMinutes?: number;
		strategy?: "parallel" | "sequential" | "mixed";
		totalComplexity?: number;
		createdAt: string;
		createdBy?: string;
	};
	stats: {
		totalTasks: number;
		pendingTasks: number;
		inProgressTasks: number;
		completedTasks: number;
		failedTasks: number;
	};
}

interface UseProjectsOptions {
	status?: string;
	limit?: number;
	refetchInterval?: number;
}

/**
 * Hook to fetch all projects (tasks with type="project")
 */
export function useProjects(options: UseProjectsOptions = {}) {
	const { status, limit = 100, refetchInterval = 10000 } = options;

	const query = useEventQuery<{ tasks: any[]; totalCount: number }>(
		"task.list",
		{
			status,
			limit,
			orderBy: "priority",
			order: "desc",
		},
		{
			refetchInterval,
			select: (data: { tasks: any[], totalCount: number }) => {
				// Filter for project tasks only
				const projects = data.tasks.filter(
					(task: any) => 
						task.metadata?.type === "project" || 
						task.text.toLowerCase().includes("[project]")
				);
				
				// Map to ProjectData format
				return {
					projects: projects.map((task: any): ProjectData => ({
						id: task.id,
						text: task.text,
						status: task.status,
						priority: task.priority,
						createdAt: task.createdAt,
						updatedAt: task.updatedAt,
						metadata: task.metadata,
						attachmentCount: task.attachmentCount,
					})),
					totalCount: projects.length,
				};
			},
		}
	);

	return {
		projects: (query.data as any)?.projects || [],
		totalCount: (query.data as any)?.totalCount || 0,
		isLoading: query.isLoading,
		error: query.error,
		refetch: query.refetch,
	};
}

/**
 * Hook to fetch a single project with full details
 */
export function useProjectDetails(projectId?: string, taskId?: string) {
	const enabled = !!(projectId || taskId);

	const query = useEventQuery<ProjectDetailData>(
		"task.get_project",
		projectId ? { projectId } : { taskId },
		{
			enabled,
			refetchInterval: 10000,
			retry: 3,
			staleTime: 5000,
		}
	);

	return {
		project: query.data,
		isLoading: query.isLoading,
		error: query.error,
		refetch: query.refetch,
	};
}

interface CreateProjectInput {
	project: string;
	priority?: number;
	constraints?: string[];
	requirements?: string[];
	sessionId?: string;
	metadata?: Record<string, any>;
}

interface CreateProjectOutput {
	projectId: string;
	taskId: string;
	status: "created" | "decomposing" | "ready" | "failed";
	estimatedMinutes?: number;
	message: string;
	attachmentKey: string;
}

/**
 * Hook to create a new project
 */
export function useCreateProject() {
	const queryClient = useQueryClient();
	
	const mutation = useEventMutation<CreateProjectInput, CreateProjectOutput>(
		"task.create_project",
		{
			onSuccess: (data) => {
				// Invalidate projects list
				queryClient.invalidateQueries({ queryKey: ["projects"] });
				// Invalidate task list
				queryClient.invalidateQueries({ queryKey: ["tasks"] });
				
				toast.success(`Project created: ${data.projectId}`, {
					description: data.message,
				});
			},
			onError: (error) => {
				toast.error("Failed to create project", {
					description: error.message,
				});
			},
		}
	);

	return {
		createProject: mutation.mutate,
		createProjectAsync: mutation.mutateAsync,
		isLoading: mutation.isPending,
		error: mutation.error,
		data: mutation.data,
		reset: mutation.reset,
	};
}

interface DecomposeProjectInput {
	taskId: string;
	task: string;
	priority?: number;
	constraints?: string[];
	sessionId?: string;
	metadata?: Record<string, any>;
}

/**
 * Hook to decompose a project into subtasks
 */
export function useDecomposeProject() {
	const queryClient = useQueryClient();
	
	const mutation = useEventMutation<DecomposeProjectInput, any>(
		"task.decompose",
		{
			onSuccess: (data: any) => {
				// Invalidate the specific project
				// queryClient.invalidateQueries({ queryKey: ["project", data.taskId] });
				// Invalidate projects list
				queryClient.invalidateQueries({ queryKey: ["projects"] });
				
				toast.success("Project decomposed successfully", {
					description: `Created ${data.subtaskCount} subtasks`,
				});
			},
			onError: (error) => {
				toast.error("Failed to decompose project", {
					description: error.message,
				});
			},
		}
	);

	return {
		decomposeProject: mutation.mutate,
		decomposeProjectAsync: mutation.mutateAsync,
		isLoading: mutation.isPending,
		error: mutation.error,
		data: mutation.data,
	};
}

/**
 * Hook to update a project task
 */
export function useUpdateProject() {
	const queryClient = useQueryClient();
	
	const mutation = useEventMutation<
		{ id: string; updates: Partial<ProjectData> },
		any
	>("task.update", {
		onSuccess: (data: any) => {
			// Invalidate the specific project
			// queryClient.invalidateQueries({ queryKey: ["project", data.id] });
			// Invalidate projects list
			queryClient.invalidateQueries({ queryKey: ["projects"] });
			
			toast.success("Project updated");
		},
		onError: (error) => {
			toast.error("Failed to update project", {
				description: error.message,
			});
		},
	});

	return {
		updateProject: mutation.mutate,
		updateProjectAsync: mutation.mutateAsync,
		isLoading: mutation.isPending,
		error: mutation.error,
	};
}

/**
 * Hook to subscribe to project events for real-time updates
 */
export function useProjectEventSubscription(projectId?: string) {
	const queryClient = useQueryClient();

	// This would typically connect to a WebSocket or EventSource
	// For now, we rely on polling via refetchInterval in useEventQuery
	// In a real implementation, you'd use:
	// - WebSocket connection to subscribe to project events
	// - Update cache when events are received
	// - Handle connection lifecycle

	// Placeholder for WebSocket subscription logic
	// useEffect(() => {
	//   if (!projectId) return;
	//   
	//   const ws = new WebSocket(`ws://localhost:3000/events/project/${projectId}`);
	//   
	//   ws.onmessage = (event) => {
	//     const data = JSON.parse(event.data);
	//     
	//     // Update cache based on event type
	//     switch (data.type) {
	//       case 'task.updated':
	//       case 'task.completed':
	//         queryClient.invalidateQueries({ queryKey: ["project", projectId] });
	//         break;
	//     }
	//   };
	//   
	//   return () => ws.close();
	// }, [projectId, queryClient]);

	// For now, return a placeholder
	return {
		isConnected: true,
		subscribe: (callback: (event: any) => void) => {
			// Placeholder
		},
		unsubscribe: () => {
			// Placeholder
		},
	};
}