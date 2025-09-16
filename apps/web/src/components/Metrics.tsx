import { useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
	ChartContainer, 
	ChartTooltip, 
	ChartTooltipContent,
	type ChartConfig 
} from "@/components/ui/chart";
import { 
	LineChart, 
	Line, 
	AreaChart, 
	Area, 
	BarChart, 
	Bar, 
	XAxis, 
	YAxis, 
	CartesianGrid, 
	ResponsiveContainer,
	RadialBarChart,
	RadialBar,
	PolarGrid,
	Cell,
	Pie,
	PieChart
} from "recharts";
import { 
	getEventClient,
	useSystemMetrics
} from "@/services/event-client";
import { 
	Activity,
	Zap,
	BarChart3,
	Timer,
	Database,
	Cpu,
	MemoryStick,
	Network,
	RefreshCw,
	CheckCircle,
	XCircle,
	AlertTriangle,
	Shield,
	Clock,
	TrendingUp,
	TrendingDown,
	Minus,
	Info,
	AlertCircle,
	CheckCircle2,
	Ban,
	ShieldOff,
	ShieldCheck,
	Gauge
} from "lucide-react";

// Enhanced metrics data interface
interface MetricsData {
	eventsProcessed?: number;
	tasksCompleted?: number;
	averageLatency?: number;
	memoryUsage?: number;
	circuitBreaker?: {
		totalSuccesses: number;
		totalFailures: number;
		totalTrips: number;
		successRate: number;
	};
	queue?: {
		depth: number;
		pending: number;
		throughput: number;
	};
	cache?: {
		hits: number;
		misses: number;
		sets: number;
		hitRate?: number;
	};
	counters?: {
		circuit?: Record<string, number>;
		ratelimit?: Record<string, number>;
		timeout?: Record<string, number>;
	};
	global?: {
		taskSuccess?: number;
		taskFailure?: number;
		systemSuccess?: number;
		totalEvents?: number;
		totalTasks?: number;
		avgLatency?: number;
		throughput?: number;
	};
	scaling?: {
		instanceCount?: number;
		loadBalance?: number;
		totalLoad?: number;
	};
	current?: {
		eventsTotal?: number;
		queueDepth?: number;
		instancesActive?: number;
		tasksPending?: number;
		tasksCompleted?: number;
		metricsStartTime?: number;
	};
	mcpCalls?: number;
	systemHealthCheck?: {
		lastCheck?: number;
	};
}

interface EventMetrics {
	name: string;
	domain: string;
	circuit: {
		success: number;
		failure: number;
		opened: number;
		rejected: number;
		fallback: number;
		total: number;
		rate: number;
	};
	rateLimit: {
		allowed: number;
		rejected: number;
		total: number;
		rate: number;
	};
	timeout: {
		completed: number;
		timedOut: number;
		total: number;
		rate: number;
	};
	health: number;
}

interface MetricsProps {
	className?: string;
}

// Helper function to parse event metrics from counters
function parseEventMetrics(counters: MetricsData['counters']): EventMetrics[] {
	if (!counters) return [];

	const eventMap = new Map<string, EventMetrics>();

	// Process circuit breaker metrics
	if (counters.circuit) {
		Object.entries(counters.circuit).forEach(([key, value]) => {
			const [eventName, metric] = key.split(':');
			if (!eventMap.has(eventName)) {
				const [domain] = eventName.split('.');
				eventMap.set(eventName, {
					name: eventName,
					domain,
					circuit: { success: 0, failure: 0, opened: 0, rejected: 0, fallback: 0, total: 0, rate: 0 },
					rateLimit: { allowed: 0, rejected: 0, total: 0, rate: 0 },
					timeout: { completed: 0, timedOut: 0, total: 0, rate: 0 },
					health: 0
				});
			}
			const event = eventMap.get(eventName)!;
			switch (metric) {
				case 'success': event.circuit.success = value; break;
				case 'failure': event.circuit.failure = value; break;
				case 'opened': event.circuit.opened = value; break;
				case 'rejected': event.circuit.rejected = value; break;
				case 'fallback': event.circuit.fallback = value; break;
			}
		});
	}

	// Process rate limit metrics
	if (counters.ratelimit) {
		Object.entries(counters.ratelimit).forEach(([key, value]) => {
			const [eventName, metric] = key.split(':');
			if (!eventMap.has(eventName)) {
				const [domain] = eventName.split('.');
				eventMap.set(eventName, {
					name: eventName,
					domain,
					circuit: { success: 0, failure: 0, opened: 0, rejected: 0, fallback: 0, total: 0, rate: 0 },
					rateLimit: { allowed: 0, rejected: 0, total: 0, rate: 0 },
					timeout: { completed: 0, timedOut: 0, total: 0, rate: 0 },
					health: 0
				});
			}
			const event = eventMap.get(eventName)!;
			if (metric === 'allowed') event.rateLimit.allowed = value;
			// Note: rejected count not in current data, would need to be added
		});
	}

	// Process timeout metrics
	if (counters.timeout) {
		Object.entries(counters.timeout).forEach(([key, value]) => {
			const [eventName, metric] = key.split(':');
			if (!eventMap.has(eventName)) {
				const [domain] = eventName.split('.');
				eventMap.set(eventName, {
					name: eventName,
					domain,
					circuit: { success: 0, failure: 0, opened: 0, rejected: 0, fallback: 0, total: 0, rate: 0 },
					rateLimit: { allowed: 0, rejected: 0, total: 0, rate: 0 },
					timeout: { completed: 0, timedOut: 0, total: 0, rate: 0 },
					health: 0
				});
			}
			const event = eventMap.get(eventName)!;
			if (metric === 'completed') event.timeout.completed = value;
			// Note: timedOut count not in current data
		});
	}

	// Calculate totals and health scores
	eventMap.forEach((event) => {
		// Circuit totals
		event.circuit.total = event.circuit.success + event.circuit.failure;
		event.circuit.rate = event.circuit.total > 0 
			? (event.circuit.success / event.circuit.total) * 100 
			: 100;

		// Rate limit totals
		event.rateLimit.total = event.rateLimit.allowed + event.rateLimit.rejected;
		event.rateLimit.rate = event.rateLimit.total > 0 
			? (event.rateLimit.allowed / event.rateLimit.total) * 100 
			: 100;

		// Timeout totals
		event.timeout.total = event.timeout.completed + event.timeout.timedOut;
		event.timeout.rate = event.timeout.total > 0 
			? (event.timeout.completed / event.timeout.total) * 100 
			: 100;

		// Calculate overall health (weighted average)
		const circuitHealth = event.circuit.rate;
		const rateLimitHealth = event.rateLimit.rate;
		const timeoutHealth = event.timeout.rate;
		
		// Penalize heavily for circuit breaker trips
		const tripPenalty = event.circuit.opened > 0 ? 20 : 0;
		
		event.health = Math.max(0, Math.min(100, 
			(circuitHealth * 0.5 + rateLimitHealth * 0.25 + timeoutHealth * 0.25) - tripPenalty
		));
	});

	return Array.from(eventMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Calculate overall system health score
function calculateSystemHealth(metrics: MetricsData): number {
	let score = 100;
	let weights = 0;

	// Circuit breaker health (40% weight)
	if (metrics.circuitBreaker) {
		const cbHealth = metrics.circuitBreaker.successRate;
		score = score * 0.6 + cbHealth * 0.4;
		weights += 0.4;
	}

	// Cache performance (20% weight)
	if (metrics.cache?.hitRate) {
		const cacheHealth = metrics.cache.hitRate;
		score = score * 0.8 + cacheHealth * 0.2;
		weights += 0.2;
	}

	// Queue health (20% weight)
	if (metrics.queue) {
		const queueHealth = metrics.queue.depth < 10 ? 100 : 
							metrics.queue.depth < 50 ? 80 : 
							metrics.queue.depth < 100 ? 60 : 40;
		score = score * 0.8 + queueHealth * 0.2;
		weights += 0.2;
	}

	// Memory usage (20% weight)
	if (metrics.memoryUsage) {
		const memHealth = metrics.memoryUsage < 100 ? 100 :
						  metrics.memoryUsage < 200 ? 80 :
						  metrics.memoryUsage < 500 ? 60 : 40;
		score = score * 0.8 + memHealth * 0.2;
		weights += 0.2;
	}

	return Math.round(score);
}

// Get health status color and icon
function getHealthStatus(health: number) {
	if (health >= 90) return { color: "text-green-600", icon: <CheckCircle2 className="h-4 w-4" />, label: "Excellent" };
	if (health >= 70) return { color: "text-blue-600", icon: <CheckCircle className="h-4 w-4" />, label: "Good" };
	if (health >= 50) return { color: "text-yellow-600", icon: <AlertTriangle className="h-4 w-4" />, label: "Warning" };
	return { color: "text-red-600", icon: <XCircle className="h-4 w-4" />, label: "Critical" };
}

export function Metrics({ className }: MetricsProps) {
	// State
	const [timeWindow, setTimeWindow] = useState<"1h" | "6h" | "24h" | "7d">("1h");
	const [selectedDomain, setSelectedDomain] = useState<string>("all");
	
	// Fetch metrics data with detailed flag
	const { data: metricsData, refetch: refetchMetrics, isLoading } = useSystemMetrics({ detailed: true });
	
	// Parse event metrics from counters
	const eventMetrics = useMemo(() => parseEventMetrics(metricsData?.counters), [metricsData?.counters]);
	
	// Get unique domains
	const domains = useMemo(() => {
		const domainSet = new Set(eventMetrics.map(e => e.domain));
		return ["all", ...Array.from(domainSet)];
	}, [eventMetrics]);
	
	// Filter events by domain
	const filteredEvents = useMemo(() => {
		if (selectedDomain === "all") return eventMetrics;
		return eventMetrics.filter(e => e.domain === selectedDomain);
	}, [eventMetrics, selectedDomain]);
	
	// Calculate system health
	const systemHealth = useMemo(() => calculateSystemHealth(metricsData || {}), [metricsData]);
	const healthStatus = getHealthStatus(systemHealth);

	// Prepare chart data for resilience metrics
	const resilienceData = useMemo(() => {
		if (!metricsData?.circuitBreaker) return [];
		return [
			{ name: "Success", value: metricsData.circuitBreaker.totalSuccesses, fill: "#10b981" },
			{ name: "Failures", value: metricsData.circuitBreaker.totalFailures, fill: "#ef4444" },
			{ name: "Trips", value: metricsData.circuitBreaker.totalTrips, fill: "#f59e0b" }
		];
	}, [metricsData]);

	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<BarChart3 className="h-5 w-5" />
							System Metrics Dashboard
						</CardTitle>
						<CardDescription>
							Comprehensive monitoring of system health and resilience
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant="outline" className={cn("gap-1", healthStatus.color)}>
							{healthStatus.icon}
							Health: {systemHealth}%
						</Badge>
						<Button
							variant="outline"
							size="sm"
							onClick={() => refetchMetrics()}
						>
							<RefreshCw className="h-4 w-4" />
						</Button>
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* Controls */}
				<div className="flex flex-wrap gap-2">
					<Select value={selectedDomain} onValueChange={setSelectedDomain}>
						<SelectTrigger className="w-[150px]">
							<SelectValue placeholder="Filter by domain" />
						</SelectTrigger>
						<SelectContent>
							{domains.map(domain => (
								<SelectItem key={domain} value={domain}>
									{domain === "all" ? "All Domains" : domain}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					
					<Select value={timeWindow} onValueChange={(v: any) => setTimeWindow(v)}>
						<SelectTrigger className="w-[150px]">
							<SelectValue placeholder="Time window" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1h">Last hour</SelectItem>
							<SelectItem value="6h">Last 6 hours</SelectItem>
							<SelectItem value="24h">Last 24 hours</SelectItem>
							<SelectItem value="7d">Last 7 days</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{/* Key Metrics Overview - Compact */}
				<div className="grid grid-cols-2 md:grid-cols-5 gap-2">
					<Card className="p-3">
						<div className="flex items-center justify-between">
							<Activity className="h-4 w-4 text-muted-foreground" />
							<span className="text-2xl font-bold">{metricsData?.eventsProcessed || 0}</span>
						</div>
						<p className="text-xs text-muted-foreground mt-1">Events</p>
					</Card>
					
					<Card className="p-3">
						<div className="flex items-center justify-between">
							<CheckCircle className="h-4 w-4 text-muted-foreground" />
							<span className="text-2xl font-bold">{metricsData?.tasksCompleted || 0}</span>
						</div>
						<p className="text-xs text-muted-foreground mt-1">Tasks</p>
					</Card>
					
					<Card className="p-3">
						<div className="flex items-center justify-between">
							<Timer className="h-4 w-4 text-muted-foreground" />
							<span className="text-2xl font-bold">{metricsData?.averageLatency?.toFixed(1) || 0}</span>
						</div>
						<p className="text-xs text-muted-foreground mt-1">Latency (ms)</p>
					</Card>
					
					<Card className="p-3">
						<div className="flex items-center justify-between">
							<MemoryStick className="h-4 w-4 text-muted-foreground" />
							<span className="text-2xl font-bold">{metricsData?.memoryUsage?.toFixed(0) || 0}</span>
						</div>
						<p className="text-xs text-muted-foreground mt-1">Memory (MB)</p>
					</Card>
					
					<Card className="p-3">
						<div className="flex items-center justify-between">
							<Gauge className="h-4 w-4 text-muted-foreground" />
							<span className="text-2xl font-bold">{metricsData?.global?.throughput?.toFixed(1) || 0}</span>
						</div>
						<p className="text-xs text-muted-foreground mt-1">Throughput</p>
					</Card>
				</div>

				{/* Event Metrics Table */}
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-sm font-medium flex items-center gap-2">
							<Shield className="h-4 w-4" />
							Event Resilience Metrics
						</CardTitle>
						<CardDescription className="text-xs">
							Per-event breakdown of circuit breakers, rate limits, and timeouts
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ScrollArea className="h-[400px] w-full">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-[250px]">Event</TableHead>
										<TableHead className="text-center min-w-[180px]">Circuit Breaker</TableHead>
										<TableHead className="text-center min-w-[150px]">Rate Limit</TableHead>
										<TableHead className="text-center min-w-[150px]">Timeout</TableHead>
										<TableHead className="text-center min-w-[120px]">Health</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredEvents.length === 0 ? (
										<TableRow>
											<TableCell colSpan={5} className="text-center text-muted-foreground">
												No event metrics available
											</TableCell>
										</TableRow>
									) : (
										<Accordion type="single" collapsible className="w-full">
											{filteredEvents.map((event) => {
												const eventHealth = getHealthStatus(event.health);
												return (
													<AccordionItem key={event.name} value={event.name} className="border-0">
														<TableRow className="border-b hover:bg-muted/50">
															<TableCell className="font-medium py-3">
																<AccordionTrigger className="py-0 hover:no-underline">
																	<div className="flex items-center gap-2">
																		<Badge variant="outline" className="text-xs">
																			{event.domain}
																		</Badge>
																		<span className="text-sm">{event.name}</span>
																	</div>
																</AccordionTrigger>
															</TableCell>
															<TableCell className="text-center py-3 px-4">
																<div className="flex items-center justify-center gap-1 flex-wrap min-h-[28px]">
																	{(event.circuit.success === 0 && event.circuit.failure === 0 && event.circuit.opened === 0) ? (
																		<span className="text-muted-foreground text-xs">—</span>
																	) : null}
																	{event.circuit.success > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="default" className="gap-0.5 text-xs px-2 py-0.5">
																					<CheckCircle className="h-3 w-3" />
																					{event.circuit.success}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Successful requests</TooltipContent>
																		</Tooltip>
																	)}
																	{event.circuit.failure > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="destructive" className="gap-0.5 text-xs px-2 py-0.5">
																					<XCircle className="h-3 w-3" />
																					{event.circuit.failure}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Failed requests</TooltipContent>
																		</Tooltip>
																	)}
																	{event.circuit.opened > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="outline" className="gap-0.5 text-xs px-2 py-0.5 text-yellow-600 border-yellow-600">
																					<AlertTriangle className="h-3 w-3" />
																					{event.circuit.opened}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Circuit opened (tripped)</TooltipContent>
																		</Tooltip>
																	)}
																</div>
															</TableCell>
															<TableCell className="text-center py-3 px-4">
																<div className="flex items-center justify-center gap-1 flex-wrap min-h-[28px]">
																	{(event.rateLimit.allowed === 0 && event.rateLimit.rejected === 0) ? (
																		<span className="text-muted-foreground text-xs">—</span>
																	) : null}
																	{event.rateLimit.allowed > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="default" className="gap-0.5 text-xs px-2 py-0.5">
																					<CheckCircle className="h-3 w-3" />
																					{event.rateLimit.allowed}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Requests allowed</TooltipContent>
																		</Tooltip>
																	)}
																	{event.rateLimit.rejected > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="destructive" className="gap-0.5 text-xs px-2 py-0.5">
																					<Ban className="h-3 w-3" />
																					{event.rateLimit.rejected}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Requests rate limited</TooltipContent>
																		</Tooltip>
																	)}
																</div>
															</TableCell>
															<TableCell className="text-center py-3 px-4">
																<div className="flex items-center justify-center gap-1 flex-wrap min-h-[28px]">
																	{(event.timeout.completed === 0 && event.timeout.timedOut === 0) ? (
																		<span className="text-muted-foreground text-xs">—</span>
																	) : null}
																	{event.timeout.completed > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="default" className="gap-0.5 text-xs px-2 py-0.5">
																					<Clock className="h-3 w-3" />
																					{event.timeout.completed}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Completed within timeout</TooltipContent>
																		</Tooltip>
																	)}
																	{event.timeout.timedOut > 0 && (
																		<Tooltip>
																			<TooltipTrigger>
																				<Badge variant="destructive" className="gap-0.5 text-xs px-2 py-0.5">
																					<AlertCircle className="h-3 w-3" />
																					{event.timeout.timedOut}
																				</Badge>
																			</TooltipTrigger>
																			<TooltipContent>Timed out</TooltipContent>
																		</Tooltip>
																	)}
																</div>
															</TableCell>
															<TableCell className="text-center py-3 px-4">
																<div className="flex items-center justify-center gap-1">
																	<span className={cn("flex items-center gap-1 text-sm", eventHealth.color)}>
																		{eventHealth.icon}
																		<span className="font-bold">{Math.round(event.health)}%</span>
																	</span>
																</div>
															</TableCell>
														</TableRow>
														<AccordionContent>
															<TableRow>
																<TableCell colSpan={5}>
																	<div className="p-4 space-y-3">
																		<div className="grid grid-cols-3 gap-4">
																			{/* Circuit Breaker Details */}
																			<div className="space-y-2">
																				<h4 className="text-sm font-medium flex items-center gap-1">
																					<Zap className="h-3 w-3" />
																					Circuit Breaker Details
																				</h4>
																				<div className="space-y-1 text-xs">
																					<div className="flex justify-between">
																						<span className="text-muted-foreground">Success Rate:</span>
																						<span className="font-mono">{event.circuit.rate.toFixed(1)}%</span>
																					</div>
																					<div className="flex justify-between">
																						<span className="text-muted-foreground">Total Requests:</span>
																						<span className="font-mono">{event.circuit.total}</span>
																					</div>
																					{event.circuit.rejected > 0 && (
																						<div className="flex justify-between">
																							<span className="text-muted-foreground">Rejected:</span>
																							<span className="font-mono text-yellow-600">{event.circuit.rejected}</span>
																						</div>
																					)}
																					{event.circuit.fallback > 0 && (
																						<div className="flex justify-between">
																							<span className="text-muted-foreground">Fallback Used:</span>
																							<span className="font-mono text-blue-600">{event.circuit.fallback}</span>
																						</div>
																					)}
																				</div>
																			</div>

																			{/* Rate Limit Details */}
																			<div className="space-y-2">
																				<h4 className="text-sm font-medium flex items-center gap-1">
																					<Shield className="h-3 w-3" />
																					Rate Limit Details
																				</h4>
																				<div className="space-y-1 text-xs">
																					<div className="flex justify-between">
																						<span className="text-muted-foreground">Allow Rate:</span>
																						<span className="font-mono">{event.rateLimit.rate.toFixed(1)}%</span>
																					</div>
																					<div className="flex justify-between">
																						<span className="text-muted-foreground">Total Requests:</span>
																						<span className="font-mono">{event.rateLimit.total}</span>
																					</div>
																				</div>
																			</div>

																			{/* Timeout Details */}
																			<div className="space-y-2">
																				<h4 className="text-sm font-medium flex items-center gap-1">
																					<Clock className="h-3 w-3" />
																					Timeout Details
																				</h4>
																				<div className="space-y-1 text-xs">
																					<div className="flex justify-between">
																						<span className="text-muted-foreground">Completion Rate:</span>
																						<span className="font-mono">{event.timeout.rate.toFixed(1)}%</span>
																					</div>
																					<div className="flex justify-between">
																						<span className="text-muted-foreground">Total Requests:</span>
																						<span className="font-mono">{event.timeout.total}</span>
																					</div>
																				</div>
																			</div>
																		</div>
																		
																		{/* Health Score Breakdown */}
																		<div className="border-t pt-3">
																			<h4 className="text-sm font-medium mb-2">Health Score Breakdown</h4>
																			<div className="flex items-center gap-2">
																				<Progress value={event.health} className="flex-1" />
																				<span className={cn("text-sm font-bold", eventHealth.color)}>
																					{eventHealth.label}
																				</span>
																			</div>
																		</div>
																	</div>
																</TableCell>
															</TableRow>
														</AccordionContent>
													</AccordionItem>
												);
											})}
										</Accordion>
									)}
								</TableBody>
							</Table>
						</ScrollArea>
					</CardContent>
				</Card>

				{/* Resilience Dashboard */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					{/* Circuit Breaker Overview */}
					{metricsData?.circuitBreaker && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium flex items-center gap-2">
									<Zap className="h-4 w-4" />
									Circuit Breaker Status
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ChartContainer 
									config={{
										success: { label: "Success", color: "hsl(var(--chart-1))" },
										failure: { label: "Failures", color: "hsl(var(--chart-2))" },
										trips: { label: "Trips", color: "hsl(var(--chart-3))" }
									}}
									className="h-[150px]"
								>
									<ResponsiveContainer width="100%" height="100%">
										<PieChart>
											<Pie
												data={resilienceData}
												cx="50%"
												cy="50%"
												innerRadius={40}
												outerRadius={60}
												paddingAngle={2}
												dataKey="value"
											>
												{resilienceData.map((entry, index) => (
													<Cell key={`cell-${index}`} fill={entry.fill} />
												))}
											</Pie>
											<ChartTooltip content={<ChartTooltipContent />} />
										</PieChart>
									</ResponsiveContainer>
								</ChartContainer>
								<div className="mt-2 text-center">
									<div className="text-2xl font-bold">{metricsData.circuitBreaker.successRate.toFixed(1)}%</div>
									<div className="text-xs text-muted-foreground">Success Rate</div>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Cache Performance */}
					{metricsData?.cache && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium flex items-center gap-2">
									<Database className="h-4 w-4" />
									Cache Performance
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									<div>
										<div className="flex justify-between items-center mb-1">
											<span className="text-sm text-muted-foreground">Hit Rate</span>
											<span className="text-sm font-bold">
												{metricsData.cache.hitRate?.toFixed(1) || 0}%
											</span>
										</div>
										<Progress value={metricsData.cache.hitRate || 0} />
									</div>
									<div className="grid grid-cols-3 gap-2 text-center">
										<div>
											<div className="text-lg font-bold text-green-600">
												{metricsData.cache.hits}
											</div>
											<div className="text-xs text-muted-foreground">Hits</div>
										</div>
										<div>
											<div className="text-lg font-bold text-red-600">
												{metricsData.cache.misses}
											</div>
											<div className="text-xs text-muted-foreground">Misses</div>
										</div>
										<div>
											<div className="text-lg font-bold text-blue-600">
												{metricsData.cache.sets}
											</div>
											<div className="text-xs text-muted-foreground">Sets</div>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					{/* Queue Status */}
					{metricsData?.queue && (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium flex items-center gap-2">
									<Activity className="h-4 w-4" />
									Queue Status
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="space-y-3">
									<div className="grid grid-cols-2 gap-2">
										<div className="text-center">
											<div className="text-2xl font-bold">{metricsData.queue.depth}</div>
											<div className="text-xs text-muted-foreground">Queue Depth</div>
										</div>
										<div className="text-center">
											<div className="text-2xl font-bold">{metricsData.queue.pending}</div>
											<div className="text-xs text-muted-foreground">Pending</div>
										</div>
									</div>
									<div className="border-t pt-2">
										<div className="flex justify-between items-center">
											<span className="text-sm text-muted-foreground">Throughput</span>
											<span className="text-sm font-bold">
												{metricsData.queue.throughput.toFixed(1)} req/s
											</span>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>
					)}
				</div>

				{/* Infrastructure Metrics */}
				{(metricsData?.scaling || metricsData?.current || metricsData?.global) && (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Scaling & Load */}
						{metricsData?.scaling && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Cpu className="h-4 w-4" />
										Scaling & Load Distribution
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="grid grid-cols-3 gap-4 text-center">
										<div>
											<div className="text-2xl font-bold">{metricsData.scaling.instanceCount || 0}</div>
											<div className="text-xs text-muted-foreground">Instances</div>
										</div>
										<div>
											<div className="text-2xl font-bold">{metricsData.scaling.totalLoad || 0}</div>
											<div className="text-xs text-muted-foreground">Total Load</div>
										</div>
										<div>
											<div className="text-2xl font-bold">{metricsData.scaling.loadBalance || 0}%</div>
											<div className="text-xs text-muted-foreground">Balance</div>
										</div>
									</div>
								</CardContent>
							</Card>
						)}

						{/* Global Statistics */}
						{metricsData?.global && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Network className="h-4 w-4" />
										Global Statistics
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2">
										<div className="grid grid-cols-2 gap-2 text-sm">
											{metricsData.global.taskSuccess !== undefined && (
												<div className="flex justify-between">
													<span className="text-muted-foreground">Task Success:</span>
													<Badge variant="default">{metricsData.global.taskSuccess}</Badge>
												</div>
											)}
											{metricsData.global.taskFailure !== undefined && (
												<div className="flex justify-between">
													<span className="text-muted-foreground">Task Failure:</span>
													<Badge variant="destructive">{metricsData.global.taskFailure}</Badge>
												</div>
											)}
											{metricsData.global.systemSuccess !== undefined && (
												<div className="flex justify-between">
													<span className="text-muted-foreground">System Success:</span>
													<Badge variant="default">{metricsData.global.systemSuccess}</Badge>
												</div>
											)}
											{metricsData.global.totalEvents !== undefined && (
												<div className="flex justify-between">
													<span className="text-muted-foreground">Total Events:</span>
													<Badge variant="outline">{metricsData.global.totalEvents}</Badge>
												</div>
											)}
										</div>
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)}

				{/* Loading state */}
				{isLoading && (
					<div className="text-center text-muted-foreground py-8">
						Loading metrics data...
					</div>
				)}
			</CardContent>
		</Card>
	);
}