import { QueryClient } from "@tanstack/react-query";

/**
 * Configure TanStack Query client for server state management
 * This is separate from the event client to maintain separation of concerns
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Consider data fresh for 5 minutes
			staleTime: 1000 * 60 * 5,
			// Keep in cache for 10 minutes
			gcTime: 1000 * 60 * 10,
			// Retry failed requests 3 times with exponential backoff
			retry: (failureCount, error: any) => {
				// Don't retry on 4xx errors
				if (error?.status >= 400 && error?.status < 500) {
					return false;
				}
				return failureCount < 3;
			},
			// Don't refetch on window focus by default
			refetchOnWindowFocus: false,
			// Show previous data while fetching new data
			placeholderData: (previousData: any) => previousData,
		},
		mutations: {
			// Retry mutations twice
			retry: 2,
			// Optimistic updates can be configured per mutation
		},
	},
});

/**
 * Query key factory for consistent key generation
 * Helps prevent key collisions and makes invalidation easier
 */
export const queryKeys = {
	all: ["claudebench"] as const,
	system: {
		all: ["claudebench", "system"] as const,
		health: () => [...queryKeys.system.all, "health"] as const,
		state: () => [...queryKeys.system.all, "state"] as const,
		metrics: () => [...queryKeys.system.all, "metrics"] as const,
		instances: () => [...queryKeys.system.all, "instances"] as const,
	},
	tasks: {
		all: ["claudebench", "tasks"] as const,
		list: (filters?: any) => [...queryKeys.tasks.all, "list", filters] as const,
		detail: (id: string) => [...queryKeys.tasks.all, "detail", id] as const,
		queue: () => [...queryKeys.tasks.all, "queue"] as const,
	},
	events: {
		all: ["claudebench", "events"] as const,
		stream: (types?: string[]) => [...queryKeys.events.all, "stream", types] as const,
		recent: (count?: number) => [...queryKeys.events.all, "recent", count] as const,
	},
	handlers: {
		all: ["claudebench", "handlers"] as const,
		list: () => [...queryKeys.handlers.all, "list"] as const,
		discovery: () => [...queryKeys.handlers.all, "discovery"] as const,
	},
	hooks: {
		all: ["claudebench", "hooks"] as const,
		list: (type?: string) => [...queryKeys.hooks.all, "list", type] as const,
	},
} as const;

/**
 * Utility function to invalidate related queries
 */
export function invalidateRelatedQueries(
	queryClient: QueryClient,
	domain: keyof typeof queryKeys
) {
	// Handle the special case for 'all' which is a direct property
	if (domain === 'all') {
		return queryClient.invalidateQueries({
			queryKey: queryKeys.all,
		});
	}
	
	// For other domains, access their 'all' property
	const domainKeys = queryKeys[domain];
	if (domainKeys && typeof domainKeys === 'object' && 'all' in domainKeys) {
		return queryClient.invalidateQueries({
			queryKey: domainKeys.all,
		});
	}
	
	// Fallback to invalidating everything under claudebench
	return queryClient.invalidateQueries({
		queryKey: queryKeys.all,
	});
}

/**
 * Prefetch commonly used data
 */
export async function prefetchCommonData(queryClient: QueryClient) {
	// These would use the event client to prefetch
	// Implemented by components that need the data
	return Promise.all([
		// Prefetch system health
		queryClient.prefetchQuery({
			queryKey: queryKeys.system.health(),
			queryFn: () => Promise.resolve({ status: "pending" }),
		}),
		// Prefetch system state
		queryClient.prefetchQuery({
			queryKey: queryKeys.system.state(),
			queryFn: () => Promise.resolve({ tasks: [], instances: [] }),
		}),
	]);
}