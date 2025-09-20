import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from "@tanstack/react-query";
import { getEventClient } from "@/services/event-client";
import { queryClient } from "@/services/query-client";

/**
 * Generic hook for querying event methods (GET-like operations)
 * Based on ClaudeBench's handler-first architecture
 */
export function useEventQuery<TResult = any>(
	method: string,
	params?: any,
	options?: {
		refetchInterval?: number;
		enabled?: boolean;
		staleTime?: number;
		gcTime?: number;
	}
) {
	const client = getEventClient();
	
	return useQuery<TResult>({
		queryKey: ["claudebench", method, params],
		queryFn: async () => {
			return await client.invoke(method, params || {});
		},
		refetchInterval: options?.refetchInterval,
		enabled: options?.enabled !== false,
		staleTime: options?.staleTime || 1000 * 60 * 5, // 5 minutes default
		gcTime: options?.gcTime || 1000 * 60 * 10, // 10 minutes default
	});
}

/**
 * Generic hook for mutation event methods (POST-like operations)
 * Handles cache invalidation automatically
 */
export function useEventMutation<TParams = any, TResult = any>(
	method: string,
	options?: {
		onSuccess?: (data: TResult) => void;
		onError?: (error: Error) => void;
		invalidateQueries?: string[][];
	}
) {
	const client = getEventClient();
	
	return useMutation<TResult, Error, TParams>({
		mutationFn: async (params: TParams) => {
			return await client.invoke(method, params);
		},
		onSuccess: (data) => {
			// Invalidate related queries
			if (options?.invalidateQueries) {
				options.invalidateQueries.forEach(queryKey => {
					queryClient.invalidateQueries({ queryKey });
				});
			}
			
			// Call custom success handler
			options?.onSuccess?.(data);
		},
		onError: options?.onError,
	});
}

/**
 * Convenience hooks for common ClaudeBench operations
 */

// System queries with auto-refresh
export const useSystemHealth = () => 
	useEventQuery("system.health", {}, { refetchInterval: 5000 });

export const useSystemMetrics = (detailed: boolean = false) => 
	useEventQuery("system.metrics", { detailed }, { refetchInterval: 3000 });

export const useSystemState = () => 
	useEventQuery("system.get_state", {}, { refetchInterval: 5000 });

export const useHandlerDiscovery = (domain?: string) =>
	useEventQuery("system.discover", domain ? { domain } : {}, { 
		staleTime: 1000 * 60 * 10, // Cache for 10 minutes
		refetchInterval: 30000 // Refresh every 30 seconds
	});

// Task mutations with cache invalidation
export const useCreateTask = () => 
	useEventMutation("task.create", { 
		invalidateQueries: [["claudebench", "tasks"], ["claudebench", "system.get_state"]] 
	});

export const useUpdateTask = () => 
	useEventMutation("task.update", { 
		invalidateQueries: [["claudebench", "tasks"], ["claudebench", "system.get_state"]] 
	});

export const useCompleteTask = () => 
	useEventMutation("task.complete", { 
		invalidateQueries: [["claudebench", "tasks"], ["claudebench", "system.get_state"]] 
	});

export const useClaimTask = () => 
	useEventMutation("task.claim", { 
		invalidateQueries: [["claudebench", "tasks"], ["claudebench", "system.get_state"]] 
	});

export const useDeleteTask = () => 
	useEventMutation("task.delete", { 
		invalidateQueries: [["claudebench", "tasks"], ["claudebench", "task.list"], ["claudebench", "system.get_state"]] 
	});

// Hook operations
export const usePreToolHook = () =>
	useEventMutation("hook.pre_tool", {
		invalidateQueries: [["claudebench", "system.metrics"]]
	});

export const usePostToolHook = () =>
	useEventMutation("hook.post_tool", {
		invalidateQueries: [["claudebench", "system.metrics"]]
	});

export const useTodoWriteHook = () =>
	useEventMutation("hook.todo_write", {
		invalidateQueries: [["claudebench", "tasks"]]
	});

// System operations
export const useRegisterInstance = () =>
	useEventMutation("system.register", {
		invalidateQueries: [["claudebench", "system.get_state"]]
	});

export const useHeartbeat = () =>
	useEventMutation("system.heartbeat");

// Batch operations
export const useBatchProcess = () =>
	useEventMutation("system.batch.process", {
		invalidateQueries: [["claudebench", "system.metrics"]]
	});

// Handler management (if these endpoints exist)
export const useToggleHandler = () =>
	useEventMutation("system.handler.toggle", {
		invalidateQueries: [["claudebench", "system.discover"], ["claudebench", "system.get_state"]]
	});