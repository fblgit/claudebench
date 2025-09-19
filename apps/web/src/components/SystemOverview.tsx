import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
	PieChart,
	Pie,
	Cell
} from "recharts";
import { 
	Activity, 
	AlertTriangle, 
	CheckCircle, 
	XCircle, 
	Server, 
	Database,
	Network,
	RefreshCw,
	Heart,
	Clock,
	MemoryStick,
	Cpu,
	HardDrive,
	Zap,
	Shield,
	TrendingUp,
	TrendingDown,
	Minus,
	Info,
	Gauge,
	Eye,
	Key,
	Table as TableIcon
} from "lucide-react";
import { 
	useSystemHealth, 
	useSystemState, 
	useSystemMetrics 
} from "@/services/event-client";

interface SystemOverviewProps {
	className?: string;
}

interface ServiceStatus {
	name: string;
	status: "healthy" | "degraded" | "unhealthy";
	icon: React.ReactNode;
	details?: string;
	lastCheck?: string;
}

export function SystemOverview({ className }: SystemOverviewProps) {
	// Data fetching
	const { data: healthData, refetch: refetchHealth, isLoading: healthLoading } = useSystemHealth();
	const { data: stateData, refetch: refetchState, isLoading: stateLoading } = useSystemState();
	const { data: metricsData, refetch: refetchMetrics, isLoading: metricsLoading } = useSystemMetrics({ detailed: true });
	
	// State
	const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
	
	// Auto-refresh data every 30 seconds
	useEffect(() => {
		const interval = setInterval(() => {
			refetchHealth();
			refetchState();
			refetchMetrics();
			setLastUpdate(new Date());
		}, 30000);
		
		return () => clearInterval(interval);
	}, [refetchHealth, refetchState, refetchMetrics]);
	
	// Calculate overall system health
	const getSystemHealthScore = (): number => {
		if (!healthData || !metricsData) return 0;
		
		let score = 0;
		let weights = 0;
		
		// Service health (40% weight)
		const services = healthData.services;
		const serviceScore = (
			(services.redis ? 1 : 0) +
			(services.postgres ? 1 : 0) +
			(services.mcp ? 1 : 0)
		) / 3 * 100;
		score += serviceScore * 0.4;
		weights += 0.4;
		
		// Circuit breaker health (30% weight)
		if (metricsData.circuitBreaker) {
			const cbScore = metricsData.circuitBreaker.successRate;
			score += cbScore * 0.3;
			weights += 0.3;
		}
		
		// Memory usage (15% weight)
		if (metricsData.memoryUsage) {
			const memScore = metricsData.memoryUsage < 100 ? 100 : 
							  metricsData.memoryUsage < 200 ? 80 : 
							  metricsData.memoryUsage < 500 ? 60 : 40;
			score += memScore * 0.15;
			weights += 0.15;
		}
		
		// Throughput (15% weight)
		if (metricsData.global?.throughput) {
			const throughputScore = Math.min(100, metricsData.global.throughput * 10); // Normalize to 0-100
			score += throughputScore * 0.15;
			weights += 0.15;
		}
		
		return weights > 0 ? Math.round(score / weights) : 0;
	};
	
	// Get health status details
	const getHealthStatus = (score: number) => {
		if (score >= 90) return { color: "text-green-600", icon: <CheckCircle className="h-5 w-5" />, label: "Excellent", variant: "default" };
		if (score >= 70) return { color: "text-blue-600", icon: <CheckCircle className="h-5 w-5" />, label: "Good", variant: "default" };
		if (score >= 50) return { color: "text-yellow-600", icon: <AlertTriangle className="h-5 w-5" />, label: "Warning", variant: "warning" };
		return { color: "text-red-600", icon: <XCircle className="h-5 w-5" />, label: "Critical", variant: "destructive" };
	};
	
	// Get service statuses
	const getServiceStatuses = (): ServiceStatus[] => {
		const services: ServiceStatus[] = [];
		
		if (healthData?.services) {
			services.push({
				name: "Redis",
				status: healthData.services.redis ? "healthy" : "unhealthy",
				icon: <Database className="h-4 w-4" />,
				details: healthData.services.redis ? "Connected and responsive" : "Connection failed or timeout",
			});
			
			services.push({
				name: "PostgreSQL",
				status: healthData.services.postgres ? "healthy" : "unhealthy",
				icon: <HardDrive className="h-4 w-4" />,
				details: healthData.services.postgres ? "Connected and responsive" : "Connection failed or timeout",
			});
			
			services.push({
				name: "MCP Server",
				status: healthData.services.mcp ? "healthy" : "unhealthy",
				icon: <Network className="h-4 w-4" />,
				details: healthData.services.mcp ? "Active and accepting connections" : "Inactive or not responding",
			});
		}
		
		return services;
	};
	
	// Calculate metrics for the past period (simulated data for visualization)
	const getPerformanceData = () => {
		const now = Date.now();
		const data = [];
		
		for (let i = 23; i >= 0; i--) {
			const timestamp = new Date(now - i * 5 * 60000); // 5-minute intervals
			data.push({
				time: timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
				events: Math.floor(Math.random() * 50) + (metricsData?.eventsProcessed || 0) / 24,
				latency: Math.floor(Math.random() * 20) + (metricsData?.averageLatency || 50),
				memory: Math.floor(Math.random() * 10) + (metricsData?.memoryUsage || 80),
				throughput: Math.floor(Math.random() * 5) + (metricsData?.global?.throughput || 2),
			});
		}
		
		return data;
	};
	
	// Get circuit breaker data
	const getCircuitBreakerData = () => {
		if (!metricsData?.circuitBreaker) return [];
		
		return [
			{ name: "Success", value: metricsData.circuitBreaker.totalSuccesses, fill: "#10b981" },
			{ name: "Failures", value: metricsData.circuitBreaker.totalFailures, fill: "#ef4444" },
			{ name: "Trips", value: metricsData.circuitBreaker.totalTrips, fill: "#f59e0b" },
		];
	};
	
	// Refresh all data
	const refreshAll = () => {
		refetchHealth();
		refetchState();
		refetchMetrics();
		setLastUpdate(new Date());
	};
	
	const systemScore = getSystemHealthScore();
	const healthStatus = getHealthStatus(systemScore);
	const serviceStatuses = getServiceStatuses();
	const performanceData = getPerformanceData();
	const circuitBreakerData = getCircuitBreakerData();
	
	const isLoading = healthLoading || stateLoading || metricsLoading;

	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Activity className="h-5 w-5" />
							System Overview
						</CardTitle>
						<CardDescription>
							Real-time ClaudeBench system health and performance monitoring
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant="outline" className="text-xs">
							Updated {lastUpdate.toLocaleTimeString()}
						</Badge>
						<Button
							variant="outline"
							size="sm"
							onClick={refreshAll}
							disabled={isLoading}
						>
							{isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
						</Button>
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* System Health Score */}
				<Card>
					<CardContent className="p-6">
						<div className="flex items-center justify-between mb-4">
							<div>
								<h3 className="text-lg font-semibold">System Health</h3>
								<p className="text-sm text-muted-foreground">Overall system status and performance</p>
							</div>
							<div className="text-right">
								<div className={cn("text-3xl font-bold", healthStatus.color)}>
									{systemScore}%
								</div>
								<div className={cn("flex items-center gap-1 text-sm", healthStatus.color)}>
									{healthStatus.icon}
									{healthStatus.label}
								</div>
							</div>
						</div>
						<Progress value={systemScore} className="mb-2" />
						{systemScore < 70 && (
							<Alert variant={healthStatus.variant as any} className="mt-4">
								<AlertTriangle className="h-4 w-4" />
								<AlertTitle>System Health Warning</AlertTitle>
								<AlertDescription>
									{systemScore < 50 
										? "Critical issues detected. Immediate attention required."
										: "Some performance degradation detected. Monitor closely."}
								</AlertDescription>
							</Alert>
						)}
					</CardContent>
				</Card>
				
				{/* Service Status */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					{serviceStatuses.map((service) => (
						<Card key={service.name}>
							<CardContent className="p-4">
								<div className="flex items-center justify-between mb-2">
									<div className="flex items-center gap-2">
										{service.icon}
										<span className="font-medium">{service.name}</span>
									</div>
									<Badge 
										variant={
											service.status === "healthy" ? "default" : 
											service.status === "degraded" ? "warning" : "destructive"
										}
									>
										{service.status}
									</Badge>
								</div>
								<p className="text-sm text-muted-foreground">
									{service.details}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
				
				{/* Key Metrics */}
				<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center justify-between mb-1">
								<Activity className="h-4 w-4 text-muted-foreground" />
								<span className="text-2xl font-bold">
									{metricsData?.eventsProcessed?.toLocaleString() || 0}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">Events Processed</p>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center justify-between mb-1">
								<CheckCircle className="h-4 w-4 text-muted-foreground" />
								<span className="text-2xl font-bold">
									{stateData?.tasks?.length || 0}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">Active Tasks</p>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center justify-between mb-1">
								<Server className="h-4 w-4 text-muted-foreground" />
								<span className="text-2xl font-bold">
									{stateData?.instances?.length || 0}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">Instances</p>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center justify-between mb-1">
								<Clock className="h-4 w-4 text-muted-foreground" />
								<span className="text-2xl font-bold">
									{metricsData?.averageLatency?.toFixed(1) || 0}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">Avg Latency (ms)</p>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-4">
							<div className="flex items-center justify-between mb-1">
								<MemoryStick className="h-4 w-4 text-muted-foreground" />
								<span className="text-2xl font-bold">
									{metricsData?.memoryUsage?.toFixed(0) || 0}
								</span>
							</div>
							<p className="text-xs text-muted-foreground">Memory (MB)</p>
						</CardContent>
					</Card>
				</div>
				
				{/* Performance Charts */}
				<Tabs defaultValue="performance" className="flex-1 flex flex-col min-h-0">
					<TabsList className="grid w-full grid-cols-3">
						<TabsTrigger value="performance">Performance</TabsTrigger>
						<TabsTrigger value="reliability">Reliability</TabsTrigger>
						<TabsTrigger value="resources">Resources</TabsTrigger>
					</TabsList>
					
					<TabsContent value="performance" className="flex-1 min-h-0">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm">Event Processing Rate</CardTitle>
								</CardHeader>
								<CardContent>
									<ChartContainer
										config={{
											events: { label: "Events/min", color: "hsl(var(--chart-1))" }
										}}
										className="h-[200px]"
									>
										<ResponsiveContainer width="100%" height="100%">
											<AreaChart data={performanceData}>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis dataKey="time" />
												<YAxis />
												<ChartTooltip content={<ChartTooltipContent />} />
												<Area 
													type="monotone" 
													dataKey="events" 
													stroke="hsl(var(--chart-1))" 
													fill="hsl(var(--chart-1))"
													fillOpacity={0.2}
												/>
											</AreaChart>
										</ResponsiveContainer>
									</ChartContainer>
								</CardContent>
							</Card>
							
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm">Response Latency</CardTitle>
								</CardHeader>
								<CardContent>
									<ChartContainer
										config={{
											latency: { label: "Latency (ms)", color: "hsl(var(--chart-2))" }
										}}
										className="h-[200px]"
									>
										<ResponsiveContainer width="100%" height="100%">
											<LineChart data={performanceData}>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis dataKey="time" />
												<YAxis />
												<ChartTooltip content={<ChartTooltipContent />} />
												<Line 
													type="monotone" 
													dataKey="latency" 
													stroke="hsl(var(--chart-2))"
													strokeWidth={2}
													dot={false}
												/>
											</LineChart>
										</ResponsiveContainer>
									</ChartContainer>
								</CardContent>
							</Card>
						</div>
					</TabsContent>
					
					<TabsContent value="reliability" className="flex-1 min-h-0">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm flex items-center gap-2">
										<Zap className="h-4 w-4" />
										Circuit Breaker Status
									</CardTitle>
								</CardHeader>
								<CardContent>
									{circuitBreakerData.length > 0 ? (
										<ChartContainer
											config={{
												success: { label: "Success", color: "#10b981" },
												failure: { label: "Failures", color: "#ef4444" },
												trips: { label: "Trips", color: "#f59e0b" }
											}}
											className="h-[200px]"
										>
											<ResponsiveContainer width="100%" height="100%">
												<PieChart>
													<Pie
														data={circuitBreakerData}
														cx="50%"
														cy="50%"
														innerRadius={40}
														outerRadius={80}
														paddingAngle={2}
														dataKey="value"
													>
														{circuitBreakerData.map((entry, index) => (
															<Cell key={`cell-${index}`} fill={entry.fill} />
														))}
													</Pie>
													<ChartTooltip content={<ChartTooltipContent />} />
												</PieChart>
											</ResponsiveContainer>
										</ChartContainer>
									) : (
										<div className="h-[200px] flex items-center justify-center text-muted-foreground">
											No circuit breaker data available
										</div>
									)}
									
									{metricsData?.circuitBreaker && (
										<div className="mt-4 text-center">
											<div className="text-2xl font-bold text-green-600">
												{metricsData.circuitBreaker.successRate.toFixed(1)}%
											</div>
											<div className="text-xs text-muted-foreground">Success Rate</div>
										</div>
									)}
								</CardContent>
							</Card>
							
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm flex items-center gap-2">
										<Shield className="h-4 w-4" />
										System Resilience
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									{metricsData?.cache && (
										<div>
											<div className="flex justify-between items-center mb-1">
												<span className="text-sm">Cache Hit Rate</span>
												<span className="text-sm font-bold">
													{metricsData.cache.hitRate?.toFixed(1) || 0}%
												</span>
											</div>
											<Progress value={metricsData.cache.hitRate || 0} />
										</div>
									)}
									
									{metricsData?.queue && (
										<div>
											<div className="flex justify-between items-center mb-1">
												<span className="text-sm">Queue Health</span>
												<span className="text-sm font-bold">
													{metricsData.queue.depth < 10 ? "Good" : 
													 metricsData.queue.depth < 50 ? "Fair" : "Poor"}
												</span>
											</div>
											<Progress 
												value={Math.max(0, 100 - metricsData.queue.depth)} 
											/>
										</div>
									)}
									
									<div className="grid grid-cols-2 gap-4 pt-2">
										<div className="text-center">
											<div className="text-lg font-bold">
												{metricsData?.global?.totalEvents || 0}
											</div>
											<div className="text-xs text-muted-foreground">Total Events</div>
										</div>
										<div className="text-center">
											<div className="text-lg font-bold">
												{metricsData?.global?.taskSuccess || 0}
											</div>
											<div className="text-xs text-muted-foreground">Successful Tasks</div>
										</div>
									</div>
								</CardContent>
							</Card>
						</div>
					</TabsContent>
					
					<TabsContent value="resources" className="flex-1 min-h-0">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm">Memory Usage Trend</CardTitle>
								</CardHeader>
								<CardContent>
									<ChartContainer
										config={{
											memory: { label: "Memory (MB)", color: "hsl(var(--chart-3))" }
										}}
										className="h-[200px]"
									>
										<ResponsiveContainer width="100%" height="100%">
											<AreaChart data={performanceData}>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis dataKey="time" />
												<YAxis />
												<ChartTooltip content={<ChartTooltipContent />} />
												<Area 
													type="monotone" 
													dataKey="memory" 
													stroke="hsl(var(--chart-3))" 
													fill="hsl(var(--chart-3))"
													fillOpacity={0.2}
												/>
											</AreaChart>
										</ResponsiveContainer>
									</ChartContainer>
								</CardContent>
							</Card>
							
							<Card>
								<CardHeader className="pb-2">
									<CardTitle className="text-sm">System Throughput</CardTitle>
								</CardHeader>
								<CardContent>
									<ChartContainer
										config={{
											throughput: { label: "Requests/sec", color: "hsl(var(--chart-4))" }
										}}
										className="h-[200px]"
									>
										<ResponsiveContainer width="100%" height="100%">
											<BarChart data={performanceData}>
												<CartesianGrid strokeDasharray="3 3" />
												<XAxis dataKey="time" />
												<YAxis />
												<ChartTooltip content={<ChartTooltipContent />} />
												<Bar 
													dataKey="throughput" 
													fill="hsl(var(--chart-4))"
													radius={[2, 2, 0, 0]}
												/>
											</BarChart>
										</ResponsiveContainer>
									</ChartContainer>
								</CardContent>
							</Card>
						</div>
					</TabsContent>
				</Tabs>
				
				{/* Quick Actions */}
				<Card>
					<CardHeader className="pb-3">
						<CardTitle className="text-base">Quick Diagnostics</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
							<Button variant="outline" size="sm" className="justify-start">
								<Key className="h-4 w-4 mr-2" />
								Redis Keys
							</Button>
							<Button variant="outline" size="sm" className="justify-start">
								<TableIcon className="h-4 w-4 mr-2" />
								DB Tables  
							</Button>
							<Button variant="outline" size="sm" className="justify-start">
								<Activity className="h-4 w-4 mr-2" />
								Event Stream
							</Button>
							<Button variant="outline" size="sm" className="justify-start">
								<Gauge className="h-4 w-4 mr-2" />
								Performance
							</Button>
						</div>
					</CardContent>
				</Card>
			</CardContent>
		</Card>
	);
}