import { createRouter } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import Loader from "./components/loader";

export interface RouterContext {
	queryClient: QueryClient;
	apiUrl: string;
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5,
			gcTime: 1000 * 60 * 10,
			retry: 3,
			refetchOnWindowFocus: false,
		},
		mutations: {
			retry: 2,
		},
	},
});

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	defaultPendingComponent: Loader,
	defaultErrorComponent: ({ error }) => (
		<div className="flex flex-col items-center justify-center h-full space-y-4">
			<h2 className="text-2xl font-bold text-red-600">Error</h2>
			<p className="text-gray-600">{error.message}</p>
			<button
				onClick={() => window.location.reload()}
				className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
			>
				Reload Page
			</button>
		</div>
	),
	defaultNotFoundComponent: () => (
		<div className="flex flex-col items-center justify-center h-full space-y-4">
			<h2 className="text-2xl font-bold">404 - Page Not Found</h2>
			<p className="text-gray-600">The page you're looking for doesn't exist.</p>
			<a href="/" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
				Go Home
			</a>
		</div>
	),
	context: {
		queryClient,
		apiUrl,
	},
	defaultPreloadStaleTime: 0,
	defaultViewTransition: true,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

export { queryClient };