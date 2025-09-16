import { useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
	ChartContainer, 
	ChartTooltip, 
	ChartTooltipContent,
	ChartLegend,
	ChartLegendContent,
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
	PolarAngleAxis,
	PolarRadiusAxis
} from "recharts";
import { 
	getEventClient,
	useSystemMetrics,
	useEventQuery
} from "@/services/event-client";
import { 
	TrendingUp,
	TrendingDown,
	Activity,
	Zap,
	BarChart3,
	Timer,
	Database,
	Cpu,
	MemoryStick,
	Network,
	RefreshCw,
	Calendar,
	Clock,
	AlertTriangle,
	CheckCircle,
	Hash,
	ArrowUp,
	ArrowDown,
	Minus
} from "lucide-react";

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

interface HistoricalDataPoint {
	timestamp: string;
	time: string;
	eventsProcessed: number;
	tasksCompleted: number;
	averageLatency: number;
	memoryUsage: number;
}

interface MetricsProps {
	className?: string;
	showCharts?: boolean;
	autoRefresh?: boolean;
}

export function Metrics({ 
	className,
	showCharts = true,
	autoRefresh = true
}: MetricsProps) {
	// State
	const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
	const [timeWindow, setTimeWindow] = useState<"1h" | "6h" | "24h" | "7d">("1h");
	const [isConnected, setIsConnected] = useState(false);
	const [selectedMetric, setSelectedMetric] = useState<"all" | "events" | "tasks" | "latency" | "memory">("all");
	
	// Queries - request detailed metrics
	const { data: metricsData, refetch: refetchMetrics, isLoading } = useSystemMetrics({ detailed: true });
	
	// Calculate refresh interval based on time window
	const refreshInterval = useMemo(() => {
		switch (timeWindow) {
			case "1h": return 5000; // 5 seconds
			case "6h": return 30000; // 30 seconds
			case "24h": return 60000; // 1 minute
			case "7d": return 300000; // 5 minutes
			default: return 30000;
		}
	}, [timeWindow]);
	
	// WebSocket connection for real-time updates
	const connectWebSocket = useCallback(() => {
		const client = getEventClient();
		
		const connection = client.subscribeToEvents(
			["system.metrics", "task.completed"],
			(message: any) => {
				try {
					if (message.type === "event") {
						// Trigger metrics refresh when relevant events occur
						refetchMetrics();
					}
				} catch (error) {
					console.error("Failed to process metrics event:", error);
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
		
		return () => connection.close();
	}, [refetchMetrics]);
	
	// Connect to WebSocket on mount
	useEffect(() => {
		if (autoRefresh) {
			const cleanup = connectWebSocket();
			return cleanup;
		}
	}, [connectWebSocket, autoRefresh]);
	
	// Update historical data
	useEffect(() => {
		if (metricsData) {
			const now = new Date();
			const newPoint: HistoricalDataPoint = {
				timestamp: now.toISOString(),
				time: now.toLocaleTimeString("en-US", { 
					hour: "2-digit", 
					minute: "2-digit",
					hour12: false 
				}),
				eventsProcessed: metricsData.eventsProcessed || 0,
				tasksCompleted: metricsData.tasksCompleted || 0,
				averageLatency: metricsData.averageLatency || 0,
				memoryUsage: metricsData.memoryUsage || 0,
			};
			
			setHistoricalData(prev => {
				const updated = [...prev, newPoint];
				// Keep only the last N points based on time window
				const maxPoints = timeWindow === "1h" ? 60 : 
								 timeWindow === "6h" ? 72 : 
								 timeWindow === "24h" ? 96 : 168;
				return updated.slice(-maxPoints);
			});
		}
	}, [metricsData, timeWindow]);
	
	// Auto-refresh metrics
	useEffect(() => {
		if (autoRefresh) {
			const interval = setInterval(() => {
				refetchMetrics();
			}, refreshInterval);
			
			return () => clearInterval(interval);
		}
	}, [autoRefresh, refreshInterval, refetchMetrics]);
	
	// Calculate trends
	const trends = useMemo(() => {
		if (historicalData.length < 2) {
			return {
				events: { value: 0, direction: "neutral" as const },
				tasks: { value: 0, direction: "neutral" as const },
				latency: { value: 0, direction: "neutral" as const },
				memory: { value: 0, direction: "neutral" as const },
			};
		}
		
		const recent = historicalData[historicalData.length - 1];
		const previous = historicalData[historicalData.length - 2];
		
		const eventsTrend = recent.eventsProcessed - previous.eventsProcessed;
		const tasksTrend = recent.tasksCompleted - previous.tasksCompleted;
		const latencyTrend = recent.averageLatency - previous.averageLatency;
		const memoryTrend = recent.memoryUsage - previous.memoryUsage;
		
		return {
			events: {
				value: Math.abs(eventsTrend),
				direction: (eventsTrend > 0 ? "up" : eventsTrend < 0 ? "down" : "neutral") as "up" | "down" | "neutral"
			},
			tasks: {
				value: Math.abs(tasksTrend),
				direction: (tasksTrend > 0 ? "up" : tasksTrend < 0 ? "down" : "neutral") as "up" | "down" | "neutral"
			},
			latency: {
				value: Math.abs(latencyTrend),
				direction: (latencyTrend > 0 ? "up" : latencyTrend < 0 ? "down" : "neutral") as "up" | "down" | "neutral"
			},
			memory: {
				value: Math.abs(memoryTrend),
				direction: (memoryTrend > 0 ? "up" : memoryTrend < 0 ? "down" : "neutral") as "up" | "down" | "neutral"
			},
		};
	}, [historicalData]);
	
	// Get trend icon
	const getTrendIcon = (direction: "up" | "down" | "neutral") => {
		switch (direction) {
			case "up": return <ArrowUp className="h-3 w-3" />;
			case "down": return <ArrowDown className="h-3 w-3" />;
			case "neutral": return <Minus className="h-3 w-3" />;
		}
	};
	
	// Get trend color (for metrics where lower is better like latency)
	const getTrendColor = (direction: "up" | "down" | "neutral", invertGood = false) => {
		if (direction === "neutral") return "text-muted-foreground";
		if (invertGood) {
			return direction === "up" ? "text-red-600" : "text-green-600";
		}
		return direction === "up" ? "text-green-600" : "text-red-600";
	};
	
	// Chart configurations
	const chartConfig: ChartConfig = {
		eventsProcessed: {
			label: "Events",
			color: "hsl(var(--chart-1))",
		},
		tasksCompleted: {
			label: "Tasks",
			color: "hsl(var(--chart-2))",
		},
		averageLatency: {
			label: "Latency",
			color: "hsl(var(--chart-3))",
		},
		memoryUsage: {
			label: "Memory",
			color: "hsl(var(--chart-4))",
		},
	};
	
	// Performance score calculation
	const performanceScore = useMemo(() => {
		if (!metricsData) return 0;
		
		let score = 100;
		
		// Deduct points for high latency
		if (metricsData.averageLatency) {
			if (metricsData.averageLatency > 100) score -= 20;
			else if (metricsData.averageLatency > 50) score -= 10;
		}
		
		// Deduct points for high memory usage
		if (metricsData.memoryUsage) {
			if (metricsData.memoryUsage > 1000) score -= 30;
			else if (metricsData.memoryUsage > 500) score -= 15;
		}
		
		return Math.max(0, score);
	}, [metricsData]);
	
	// Get performance status
	const getPerformanceStatus = () => {
		if (performanceScore >= 80) return { label: "Excellent", color: "text-green-600", icon: <CheckCircle className="h-5 w-5" /> };
		if (performanceScore >= 60) return { label: "Good", color: "text-blue-600", icon: <CheckCircle className="h-5 w-5" /> };
		if (performanceScore >= 40) return { label: "Fair", color: "text-yellow-600", icon: <AlertTriangle className="h-5 w-5" /> };
		return { label: "Poor", color: "text-red-600", icon: <AlertTriangle className="h-5 w-5" /> };
	};
	
	const performanceStatus = getPerformanceStatus();
	
	// Radial chart data for performance score
	const radialData = [{
		name: "Performance",
		value: performanceScore,
		fill: performanceScore >= 80 ? "hsl(142, 76%, 36%)" : 
			  performanceScore >= 60 ? "hsl(217, 91%, 60%)" :
			  performanceScore >= 40 ? "hsl(48, 96%, 53%)" : "hsl(0, 84%, 60%)"
	}];
	
	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<BarChart3 className="h-5 w-5" />
							System Metrics
						</CardTitle>
						<CardDescription>
							Real-time performance monitoring and analytics
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant={isConnected ? "default" : "secondary"}>
							{isConnected ? "Live" : "Offline"}
						</Badge>
						<Badge 
							variant="outline" 
							className={cn("gap-1", performanceStatus.color)}
						>
							{performanceStatus.icon}
							{performanceStatus.label}
						</Badge>
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* Controls */}
				<div className="flex flex-wrap gap-2">
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
					
					<Select value={selectedMetric} onValueChange={(v: any) => setSelectedMetric(v)}>
						<SelectTrigger className="w-[150px]">
							<SelectValue placeholder="Metric filter" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All metrics</SelectItem>
							<SelectItem value="events">Events</SelectItem>
							<SelectItem value="tasks">Tasks</SelectItem>
							<SelectItem value="latency">Latency</SelectItem>
							<SelectItem value="memory">Memory</SelectItem>
						</SelectContent>
					</Select>
					
					<div className="flex-1" />
					
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetchMetrics()}
					>
						<RefreshCw className="h-4 w-4" />
					</Button>
				</div>
				
				{/* Key Metrics Cards */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium flex items-center justify-between">
								<span className="flex items-center gap-2">
									<Activity className="h-4 w-4" />
									Events Processed
								</span>
								<span className={cn("flex items-center gap-1 text-xs", getTrendColor(trends.events.direction))}>
									{getTrendIcon(trends.events.direction)}
									{trends.events.value}
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{metricsData?.eventsProcessed?.toLocaleString() || "0"}
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Total events
							</p>
							<Progress 
								value={Math.min(100, (metricsData?.eventsProcessed || 0) / 100)} 
								className="mt-2"
							/>
						</CardContent>
					</Card>
					
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium flex items-center justify-between">
								<span className="flex items-center gap-2">
									<CheckCircle className="h-4 w-4" />
									Tasks Completed
								</span>
								<span className={cn("flex items-center gap-1 text-xs", getTrendColor(trends.tasks.direction))}>
									{getTrendIcon(trends.tasks.direction)}
									{trends.tasks.value}
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{metricsData?.tasksCompleted?.toLocaleString() || "0"}
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Finished tasks
							</p>
							<Progress 
								value={Math.min(100, (metricsData?.tasksCompleted || 0) / 50)} 
								className="mt-2"
							/>
						</CardContent>
					</Card>
					
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium flex items-center justify-between">
								<span className="flex items-center gap-2">
									<Timer className="h-4 w-4" />
									Avg Latency
								</span>
								<span className={cn("flex items-center gap-1 text-xs", getTrendColor(trends.latency.direction, true))}>
									{getTrendIcon(trends.latency.direction)}
									{trends.latency.value.toFixed(1)}
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{metricsData?.averageLatency?.toFixed(1) || "0"} ms
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Response time
							</p>
							<Progress 
								value={Math.max(0, 100 - (metricsData?.averageLatency || 0))} 
								className="mt-2"
							/>
						</CardContent>
					</Card>
					
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium flex items-center justify-between">
								<span className="flex items-center gap-2">
									<MemoryStick className="h-4 w-4" />
									Memory Usage
								</span>
								<span className={cn("flex items-center gap-1 text-xs", getTrendColor(trends.memory.direction, true))}>
									{getTrendIcon(trends.memory.direction)}
									{trends.memory.value.toFixed(1)}
								</span>
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">
								{metricsData?.memoryUsage?.toFixed(1) || "0"} MB
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Heap used
							</p>
							<Progress 
								value={Math.min(100, (metricsData?.memoryUsage || 0) / 10)} 
								className="mt-2"
							/>
						</CardContent>
					</Card>
				</div>
				
				{/* Performance Score */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<Card className="md:col-span-1">
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium">
								Performance Score
							</CardTitle>
							<CardDescription className="text-xs">
								Overall system health
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ChartContainer config={{
								performance: {
									label: "Performance",
									color: "hsl(var(--chart-1))",
								},
							}} className="h-[200px]">
								<ResponsiveContainer width="100%" height="100%">
									<RadialBarChart 
										cx="50%" 
										cy="50%" 
										innerRadius="60%" 
										outerRadius="90%" 
										data={radialData}
										startAngle={90}
										endAngle={-270}
									>
										<PolarGrid gridType="circle" />
										<RadialBar dataKey="value" cornerRadius={10} fill="currentColor" className="fill-primary" />
										<text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
											<tspan className="text-3xl font-bold">{performanceScore}</tspan>
											<tspan x="50%" y="50%" dy="1.5em" className="text-xs text-muted-foreground">Score</tspan>
										</text>
									</RadialBarChart>
								</ResponsiveContainer>
							</ChartContainer>
						</CardContent>
					</Card>
					
					{/* Charts */}
					{showCharts && historicalData.length > 0 && (
						<Card className="md:col-span-2">
							<CardHeader className="pb-2">
								<CardTitle className="text-sm font-medium">
									Metrics Trends
								</CardTitle>
								<CardDescription className="text-xs">
									Historical data for {timeWindow === "1h" ? "the last hour" : 
													   timeWindow === "6h" ? "the last 6 hours" :
													   timeWindow === "24h" ? "the last 24 hours" : "the last 7 days"}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Tabs defaultValue="combined" className="w-full">
									<TabsList className="grid w-full grid-cols-2">
										<TabsTrigger value="combined">Combined</TabsTrigger>
										<TabsTrigger value="individual">Individual</TabsTrigger>
									</TabsList>
									
									<TabsContent value="combined" className="mt-4">
										<ChartContainer config={chartConfig} className="h-[200px]">
											<ResponsiveContainer width="100%" height="100%">
												<LineChart data={historicalData}>
													<CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
													<XAxis 
														dataKey="time" 
														className="text-xs"
														tick={{ fill: 'currentColor' }}
													/>
													<YAxis 
														className="text-xs"
														tick={{ fill: 'currentColor' }}
													/>
													<ChartTooltip content={<ChartTooltipContent />} />
													<ChartLegend />
													{(selectedMetric === "all" || selectedMetric === "events") && (
														<Line 
															type="monotone" 
															dataKey="eventsProcessed" 
															stroke="hsl(var(--chart-1))"
															strokeWidth={2}
															dot={false}
														/>
													)}
													{(selectedMetric === "all" || selectedMetric === "tasks") && (
														<Line 
															type="monotone" 
															dataKey="tasksCompleted" 
															stroke="hsl(var(--chart-2))"
															strokeWidth={2}
															dot={false}
														/>
													)}
													{(selectedMetric === "all" || selectedMetric === "latency") && (
														<Line 
															type="monotone" 
															dataKey="averageLatency" 
															stroke="hsl(var(--chart-3))"
															strokeWidth={2}
															dot={false}
														/>
													)}
													{(selectedMetric === "all" || selectedMetric === "memory") && (
														<Line 
															type="monotone" 
															dataKey="memoryUsage" 
															stroke="hsl(var(--chart-4))"
															strokeWidth={2}
															dot={false}
														/>
													)}
												</LineChart>
											</ResponsiveContainer>
										</ChartContainer>
									</TabsContent>
									
									<TabsContent value="individual" className="mt-4">
										<div className="grid grid-cols-2 gap-2">
											<ChartContainer config={chartConfig} className="h-[100px]">
												<ResponsiveContainer width="100%" height="100%">
													<AreaChart data={historicalData}>
														<CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
														<XAxis dataKey="time" hide />
														<YAxis hide />
														<ChartTooltip content={<ChartTooltipContent />} />
														<Area 
															type="monotone" 
															dataKey="eventsProcessed" 
															stroke="hsl(var(--chart-1))"
															fill="hsl(var(--chart-1))"
															fillOpacity={0.2}
														/>
													</AreaChart>
												</ResponsiveContainer>
											</ChartContainer>
											
											<ChartContainer config={chartConfig} className="h-[100px]">
												<ResponsiveContainer width="100%" height="100%">
													<AreaChart data={historicalData}>
														<CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
														<XAxis dataKey="time" hide />
														<YAxis hide />
														<ChartTooltip content={<ChartTooltipContent />} />
														<Area 
															type="monotone" 
															dataKey="tasksCompleted" 
															stroke="hsl(var(--chart-2))"
															fill="hsl(var(--chart-2))"
															fillOpacity={0.2}
														/>
													</AreaChart>
												</ResponsiveContainer>
											</ChartContainer>
											
											<ChartContainer config={chartConfig} className="h-[100px]">
												<ResponsiveContainer width="100%" height="100%">
													<AreaChart data={historicalData}>
														<CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
														<XAxis dataKey="time" hide />
														<YAxis hide />
														<ChartTooltip content={<ChartTooltipContent />} />
														<Area 
															type="monotone" 
															dataKey="averageLatency" 
															stroke="hsl(var(--chart-3))"
															fill="hsl(var(--chart-3))"
															fillOpacity={0.2}
														/>
													</AreaChart>
												</ResponsiveContainer>
											</ChartContainer>
											
											<ChartContainer config={chartConfig} className="h-[100px]">
												<ResponsiveContainer width="100%" height="100%">
													<AreaChart data={historicalData}>
														<CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
														<XAxis dataKey="time" hide />
														<YAxis hide />
														<ChartTooltip content={<ChartTooltipContent />} />
														<Area 
															type="monotone" 
															dataKey="memoryUsage" 
															stroke="hsl(var(--chart-4))"
															fill="hsl(var(--chart-4))"
															fillOpacity={0.2}
														/>
													</AreaChart>
												</ResponsiveContainer>
											</ChartContainer>
										</div>
									</TabsContent>
								</Tabs>
							</CardContent>
						</Card>
					)}
				</div>

				{/* Circuit Breaker & Cache Metrics */}
				{(metricsData?.circuitBreaker || metricsData?.cache) && (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Circuit Breaker */}
						{metricsData?.circuitBreaker && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Zap className="h-4 w-4" />
										Circuit Breaker Status
									</CardTitle>
									<CardDescription className="text-xs">
										System resilience metrics
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-2">
									<div className="flex justify-between items-center">
										<span className="text-sm text-muted-foreground">Success Rate</span>
										<div className="flex items-center gap-2">
											<span className="text-sm font-bold">
												{metricsData.circuitBreaker.successRate.toFixed(1)}%
											</span>
											<Progress 
												value={metricsData.circuitBreaker.successRate} 
												className="w-20"
											/>
										</div>
									</div>
									<div className="grid grid-cols-3 gap-2 text-center">
										<div>
											<div className="text-2xl font-bold text-green-600">
												{metricsData.circuitBreaker.totalSuccesses}
											</div>
											<div className="text-xs text-muted-foreground">Successes</div>
										</div>
										<div>
											<div className="text-2xl font-bold text-red-600">
												{metricsData.circuitBreaker.totalFailures}
											</div>
											<div className="text-xs text-muted-foreground">Failures</div>
										</div>
										<div>
											<div className="text-2xl font-bold text-yellow-600">
												{metricsData.circuitBreaker.totalTrips}
											</div>
											<div className="text-xs text-muted-foreground">Trips</div>
										</div>
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
									<CardDescription className="text-xs">
										Cache hit/miss statistics
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-2">
									{metricsData.cache.hitRate !== undefined && (
										<div className="flex justify-between items-center">
											<span className="text-sm text-muted-foreground">Hit Rate</span>
											<div className="flex items-center gap-2">
												<span className="text-sm font-bold">
													{metricsData.cache.hitRate.toFixed(1)}%
												</span>
												<Progress 
													value={metricsData.cache.hitRate} 
													className="w-20"
												/>
											</div>
										</div>
									)}
									<div className="grid grid-cols-3 gap-2 text-center">
										<div>
											<div className="text-2xl font-bold text-green-600">
												{metricsData.cache.hits}
											</div>
											<div className="text-xs text-muted-foreground">Hits</div>
										</div>
										<div>
											<div className="text-2xl font-bold text-red-600">
												{metricsData.cache.misses}
											</div>
											<div className="text-xs text-muted-foreground">Misses</div>
										</div>
										<div>
											<div className="text-2xl font-bold text-blue-600">
												{metricsData.cache.sets}
											</div>
											<div className="text-xs text-muted-foreground">Sets</div>
										</div>
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)}

				{/* Global & Scaling Metrics */}
				{(metricsData?.global || metricsData?.scaling) && (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Global Stats */}
						{metricsData?.global && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Network className="h-4 w-4" />
										Global Statistics
									</CardTitle>
									<CardDescription className="text-xs">
										Overall system metrics
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="grid grid-cols-2 gap-2">
										{metricsData.global.taskSuccess !== undefined && (
											<div className="flex items-center justify-between">
												<span className="text-xs text-muted-foreground">Task Success</span>
												<Badge variant="default" className="text-xs">
													{metricsData.global.taskSuccess}
												</Badge>
											</div>
										)}
										{metricsData.global.taskFailure !== undefined && (
											<div className="flex items-center justify-between">
												<span className="text-xs text-muted-foreground">Task Failure</span>
												<Badge variant="destructive" className="text-xs">
													{metricsData.global.taskFailure}
												</Badge>
											</div>
										)}
										{metricsData.global.systemSuccess !== undefined && (
											<div className="flex items-center justify-between">
												<span className="text-xs text-muted-foreground">System Success</span>
												<Badge variant="default" className="text-xs">
													{metricsData.global.systemSuccess}
												</Badge>
											</div>
										)}
										{metricsData.global.totalEvents !== undefined && (
											<div className="flex items-center justify-between">
												<span className="text-xs text-muted-foreground">Total Events</span>
												<Badge variant="outline" className="text-xs">
													{metricsData.global.totalEvents}
												</Badge>
											</div>
										)}
									</div>
									{metricsData.global.throughput !== undefined && (
										<div className="flex justify-between items-center">
											<span className="text-sm text-muted-foreground">Throughput</span>
											<span className="text-sm font-bold">
												{metricsData.global.throughput.toFixed(1)} req/s
											</span>
										</div>
									)}
								</CardContent>
							</Card>
						)}

						{/* Scaling Info */}
						{metricsData?.scaling && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Cpu className="h-4 w-4" />
										Scaling Metrics
									</CardTitle>
									<CardDescription className="text-xs">
										Instance and load distribution
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-3">
									<div className="grid grid-cols-3 gap-2 text-center">
										{metricsData.scaling.instanceCount !== undefined && (
											<div>
												<div className="text-2xl font-bold">
													{metricsData.scaling.instanceCount}
												</div>
												<div className="text-xs text-muted-foreground">Instances</div>
											</div>
										)}
										{metricsData.scaling.totalLoad !== undefined && (
											<div>
												<div className="text-2xl font-bold">
													{metricsData.scaling.totalLoad}
												</div>
												<div className="text-xs text-muted-foreground">Total Load</div>
											</div>
										)}
										{metricsData.scaling.loadBalance !== undefined && (
											<div>
												<div className="text-2xl font-bold">
													{metricsData.scaling.loadBalance}%
												</div>
												<div className="text-xs text-muted-foreground">Balance</div>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)}

				{/* System Info */}
				{(metricsData?.current || metricsData?.mcpCalls !== undefined) && (
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{/* Current State */}
						{metricsData?.current && (
							<Card className="md:col-span-2">
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Activity className="h-4 w-4" />
										Current System State
									</CardTitle>
									<CardDescription className="text-xs">
										Real-time system metrics
									</CardDescription>
								</CardHeader>
								<CardContent>
									<div className="grid grid-cols-3 gap-4">
										{metricsData.current.eventsTotal !== undefined && (
											<div>
												<div className="text-lg font-bold">
													{metricsData.current.eventsTotal}
												</div>
												<div className="text-xs text-muted-foreground">Total Events</div>
											</div>
										)}
										{metricsData.current.instancesActive !== undefined && (
											<div>
												<div className="text-lg font-bold">
													{metricsData.current.instancesActive}
												</div>
												<div className="text-xs text-muted-foreground">Active Instances</div>
											</div>
										)}
										{metricsData.current.queueDepth !== undefined && (
											<div>
												<div className="text-lg font-bold">
													{metricsData.current.queueDepth}
												</div>
												<div className="text-xs text-muted-foreground">Queue Depth</div>
											</div>
										)}
										{metricsData.current.tasksPending !== undefined && (
											<div>
												<div className="text-lg font-bold">
													{metricsData.current.tasksPending}
												</div>
												<div className="text-xs text-muted-foreground">Pending Tasks</div>
											</div>
										)}
										{metricsData.current.tasksCompleted !== undefined && (
											<div>
												<div className="text-lg font-bold">
													{metricsData.current.tasksCompleted}
												</div>
												<div className="text-xs text-muted-foreground">Completed Tasks</div>
											</div>
										)}
										{metricsData.current.metricsStartTime && (
											<div>
												<div className="text-xs font-mono">
													{new Date(metricsData.current.metricsStartTime).toLocaleTimeString()}
												</div>
												<div className="text-xs text-muted-foreground">Started At</div>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						)}

						{/* MCP Calls */}
						{metricsData?.mcpCalls !== undefined && (
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm font-medium flex items-center gap-2">
										<Hash className="h-4 w-4" />
										MCP Calls
									</CardTitle>
									<CardDescription className="text-xs">
										Model Context Protocol
									</CardDescription>
								</CardHeader>
								<CardContent className="flex items-center justify-center">
									<div className="text-center">
										<div className="text-4xl font-bold text-primary">
											{metricsData.mcpCalls}
										</div>
										<div className="text-xs text-muted-foreground mt-1">Total Calls</div>
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)}
				
				{/* Loading state */}
				{isLoading && historicalData.length === 0 && (
					<div className="text-center text-muted-foreground py-8">
						Loading metrics data...
					</div>
				)}
			</CardContent>
		</Card>
	);
}