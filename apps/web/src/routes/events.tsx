import { createFileRoute } from "@tanstack/react-router";
import { EventStream } from "@/components/EventStream";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
	Activity, 
	Clock, 
	Layers, 
	TrendingUp,
	AlertCircle,
	CheckCircle,
	XCircle,
	Info
} from "lucide-react";
import { useEffect, useState } from "react";
import { getEventClient } from "@/services/event-client";

export const Route = createFileRoute("/events")({
	component: EventsComponent,
});

interface EventStats {
	total: number;
	byDomain: Record<string, number>;
	byType: Record<string, number>;
	recentRate: number;
	errors: number;
	successes: number;
}

function EventsComponent() {
	const [stats, setStats] = useState<EventStats>({
		total: 0,
		byDomain: {},
		byType: {},
		recentRate: 0,
		errors: 0,
		successes: 0,
	});
	const [recentEvents, setRecentEvents] = useState<Array<{ type: string; timestamp: number; status: "success" | "error" | "info" }>>([]);

	// Connect to event stream for statistics
	useEffect(() => {
		const client = getEventClient();
		const connection = client.subscribeToEvents(
			undefined, // Subscribe to all events
			(message: any) => {
				if (message.type === "event") {
					const eventType = message.event;
					const domain = eventType.split(".")[0];
					
					// Update statistics
					setStats((prev) => {
						const newStats = { ...prev };
						newStats.total++;
						newStats.byDomain[domain] = (newStats.byDomain[domain] || 0) + 1;
						newStats.byType[eventType] = (newStats.byType[eventType] || 0) + 1;
						
						// Track errors and successes
						if (eventType.includes("error") || eventType.includes("failed")) {
							newStats.errors++;
						} else if (eventType.includes("complete") || eventType.includes("success")) {
							newStats.successes++;
						}
						
						return newStats;
					});
					
					// Add to recent events
					setRecentEvents((prev) => {
						const status: "error" | "success" | "info" = eventType.includes("error") || eventType.includes("failed") 
							? "error" 
							: eventType.includes("complete") || eventType.includes("success")
							? "success"
							: "info";
						
						const newEvents = [
							{ type: eventType, timestamp: Date.now(), status },
							...prev,
						].slice(0, 10);
						
						return newEvents;
					});
				}
			}
		);

		// Calculate event rate every second
		const rateInterval = setInterval(() => {
			setStats((prev) => {
				const now = Date.now();
				const recentCount = recentEvents.filter(e => now - e.timestamp < 10000).length;
				return { ...prev, recentRate: recentCount / 10 };
			});
		}, 1000);

		return () => {
			connection.close();
			clearInterval(rateInterval);
		};
	}, []);

	// Get top event types
	const topEventTypes = Object.entries(stats.byType)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 5);

	// Get domain distribution
	const domainDistribution = Object.entries(stats.byDomain)
		.sort(([, a], [, b]) => b - a);

	return (
		<div className="container mx-auto px-4 py-4 h-full flex flex-col">
			<div className="mb-6 flex-shrink-0">
				<h1 className="text-2xl font-bold">Event System</h1>
				<p className="text-muted-foreground">
					Monitor and analyze ClaudeBench event flow in real-time
				</p>
			</div>

			<Tabs defaultValue="stream" className="flex-1 flex flex-col min-h-0">
				<TabsList className="grid w-full grid-cols-3 flex-shrink-0">
					<TabsTrigger value="stream">Live Stream</TabsTrigger>
					<TabsTrigger value="statistics">Statistics</TabsTrigger>
					<TabsTrigger value="patterns">Event Patterns</TabsTrigger>
				</TabsList>

				<TabsContent value="stream" className="mt-4 flex-1 min-h-0">
					<EventStream 
						className="h-full" 
						maxEvents={200}
						autoScroll={true}
						showFilters={true}
					/>
				</TabsContent>

				<TabsContent value="statistics" className="mt-4 flex-1 overflow-auto">
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						{/* Total Events Card */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Total Events
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{stats.total.toLocaleString()}</div>
								<p className="text-xs text-muted-foreground">
									Since connection started
								</p>
							</CardContent>
						</Card>

						{/* Event Rate Card */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Event Rate
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{stats.recentRate.toFixed(1)}/s</div>
								<p className="text-xs text-muted-foreground">
									10-second average
								</p>
							</CardContent>
						</Card>

						{/* Success Rate Card */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Success Rate
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold text-green-600">
									{stats.total > 0 
										? ((stats.successes / stats.total) * 100).toFixed(1)
										: 0}%
								</div>
								<p className="text-xs text-muted-foreground">
									{stats.successes} successful events
								</p>
							</CardContent>
						</Card>

						{/* Error Count Card */}
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Errors
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold text-red-600">{stats.errors}</div>
								<p className="text-xs text-muted-foreground">
									Total error events
								</p>
							</CardContent>
						</Card>
					</div>

					<div className="grid gap-4 md:grid-cols-2 mt-4">
						{/* Domain Distribution */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Events by Domain</CardTitle>
								<CardDescription>Distribution across event domains</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									{domainDistribution.length === 0 ? (
										<p className="text-sm text-muted-foreground">No events yet</p>
									) : (
										domainDistribution.map(([domain, count]) => (
											<div key={domain} className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													<Layers className="h-4 w-4 text-muted-foreground" />
													<span className="text-sm font-medium">{domain}</span>
												</div>
												<div className="flex items-center gap-2">
													<Badge variant="secondary">{count}</Badge>
													<span className="text-xs text-muted-foreground">
														{((count / stats.total) * 100).toFixed(1)}%
													</span>
												</div>
											</div>
										))
									)}
								</div>
							</CardContent>
						</Card>

						{/* Top Event Types */}
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Top Event Types</CardTitle>
								<CardDescription>Most frequent event types</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									{topEventTypes.length === 0 ? (
										<p className="text-sm text-muted-foreground">No events yet</p>
									) : (
										topEventTypes.map(([type, count]) => (
											<div key={type} className="flex items-center justify-between">
												<span className="text-sm font-mono truncate flex-1 mr-2">{type}</span>
												<Badge variant="outline">{count}</Badge>
											</div>
										))
									)}
								</div>
							</CardContent>
						</Card>
					</div>

					{/* Recent Events Timeline */}
					<Card className="mt-4">
						<CardHeader>
							<CardTitle className="text-base">Recent Events Timeline</CardTitle>
							<CardDescription>Last 10 events with status indicators</CardDescription>
						</CardHeader>
						<CardContent>
							<ScrollArea className="h-[200px]">
								<div className="space-y-2">
									{recentEvents.length === 0 ? (
										<p className="text-sm text-muted-foreground">No recent events</p>
									) : (
										recentEvents.map((event, index) => (
											<div key={index} className="flex items-center gap-2 p-2 rounded-md border">
												{event.status === "error" ? (
													<XCircle className="h-4 w-4 text-red-600" />
												) : event.status === "success" ? (
													<CheckCircle className="h-4 w-4 text-green-600" />
												) : (
													<Info className="h-4 w-4 text-blue-600" />
												)}
												<span className="text-sm font-mono flex-1">{event.type}</span>
												<span className="text-xs text-muted-foreground">
													{new Date(event.timestamp).toLocaleTimeString()}
												</span>
											</div>
										))
									)}
								</div>
							</ScrollArea>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="patterns" className="mt-4 flex-1 overflow-auto">
					<div className="grid gap-4">
						<Card>
							<CardHeader>
								<CardTitle>Common Event Patterns</CardTitle>
								<CardDescription>
									Frequently occurring event sequences and correlations
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="rounded-lg border p-4">
									<h3 className="font-medium mb-2 flex items-center gap-2">
										<Activity className="h-4 w-4" />
										Task Lifecycle Pattern
									</h3>
									<div className="text-sm text-muted-foreground space-y-1">
										<div>1. task.create → Creates new task</div>
										<div>2. task.assign → Assigns to worker instance</div>
										<div>3. task.update → Updates status to in_progress</div>
										<div>4. task.complete → Marks as completed</div>
									</div>
								</div>

								<div className="rounded-lg border p-4">
									<h3 className="font-medium mb-2 flex items-center gap-2">
										<AlertCircle className="h-4 w-4" />
										Hook Validation Pattern
									</h3>
									<div className="text-sm text-muted-foreground space-y-1">
										<div>1. hook.pre_tool → Validates before execution</div>
										<div>2. tool.execute → Runs if validation passes</div>
										<div>3. hook.post_tool → Processes results</div>
									</div>
								</div>

								<div className="rounded-lg border p-4">
									<h3 className="font-medium mb-2 flex items-center gap-2">
										<TrendingUp className="h-4 w-4" />
										System Health Pattern
									</h3>
									<div className="text-sm text-muted-foreground space-y-1">
										<div>1. system.register → Instance joins</div>
										<div>2. system.heartbeat → Keep-alive signals (30s)</div>
										<div>3. system.health → Health checks</div>
										<div>4. system.metrics → Performance monitoring</div>
									</div>
								</div>

								<div className="rounded-lg border p-4">
									<h3 className="font-medium mb-2 flex items-center gap-2">
										<Clock className="h-4 w-4" />
										TodoWrite Integration Pattern
									</h3>
									<div className="text-sm text-muted-foreground space-y-1">
										<div>1. hook.todo_write → Captures todo updates</div>
										<div>2. task.create → Creates tasks for new todos</div>
										<div>3. task.assign → Auto-assigns in_progress items</div>
										<div>4. task.complete → Syncs with completed todos</div>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>Event Domains</CardTitle>
								<CardDescription>
									Understanding the different event domains in ClaudeBench
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-3">
									<div>
										<Badge className="mb-2">task.*</Badge>
										<p className="text-sm text-muted-foreground">
											Task management events including creation, assignment, updates, and completion
										</p>
									</div>
									<div>
										<Badge className="mb-2" variant="secondary">hook.*</Badge>
										<p className="text-sm text-muted-foreground">
											Interception points for tool execution, user prompts, and todo updates
										</p>
									</div>
									<div>
										<Badge className="mb-2" variant="outline">system.*</Badge>
										<p className="text-sm text-muted-foreground">
											System-level events for health, registration, metrics, and instance management
										</p>
									</div>
									<div>
										<Badge className="mb-2" variant="destructive">error.*</Badge>
										<p className="text-sm text-muted-foreground">
											Error events from various system components and failed operations
										</p>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}