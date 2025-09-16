"use client";

import React, { useState, useMemo } from "react";
import { useEventQuery, useEventMutation } from "@/hooks/use-event";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Search,
	Filter,
	Activity,
	Database,
	Shield,
	Clock,
	Zap,
	AlertCircle,
	CheckCircle2,
	XCircle,
	RefreshCw,
	Info,
	Code,
	BarChart3,
	Settings,
} from "lucide-react";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

// TypeScript interfaces based on ClaudeBench architecture
interface HandlerMetadata {
	persist?: boolean;
	rateLimit?: number;
	roles?: string[];
	cache?: {
		ttl: number;
		enabled: boolean;
	};
	resilience?: {
		timeout?: number;
		circuitBreaker?: {
			threshold: number;
			timeout: number;
		};
	};
}

interface HandlerMethod {
	name: string;
	description?: string;
	inputSchema: any;
	outputSchema: any;
	metadata: HandlerMetadata;
	domain?: string;
	action?: string;
	enabled?: boolean;
}

interface HandlerMetrics {
	totalCalls: number;
	successCount: number;
	errorCount: number;
	avgResponseTime: number;
	lastCalled?: string;
	rateLimitHits?: number;
	circuitState?: "CLOSED" | "OPEN" | "HALF_OPEN";
	cacheHitRate?: number;
}

interface HandlerManagerProps {
	className?: string;
}

export function HandlerManager({ className }: HandlerManagerProps) {
	// State management
	const [searchTerm, setSearchTerm] = useState("");
	const [selectedDomain, setSelectedDomain] = useState<string>("all");
	const [selectedHandler, setSelectedHandler] = useState<HandlerMethod | null>(null);
	const [viewMode, setViewMode] = useState<"list" | "grid">("list");

	// Fetch handlers using discovery mechanism
	const { 
		data: handlersData, 
		isLoading: isLoadingHandlers,
		error: handlersError,
		refetch: refetchHandlers 
	} = useEventQuery<{ methods: HandlerMethod[] }>(
		"system.discover",
		selectedDomain !== "all" ? { domain: selectedDomain } : {},
		{ refetchInterval: 30000 } // Refresh every 30 seconds
	);

	// Fetch metrics for handlers
	const { 
		data: metricsData,
		isLoading: isLoadingMetrics 
	} = useEventQuery<{ handlers: Record<string, HandlerMetrics> }>(
		"system.metrics",
		{ detailed: true },
		{ refetchInterval: 5000 } // Refresh every 5 seconds
	);

	// Handler state management mutation
	const toggleHandler = useEventMutation<{ handler: string; enabled: boolean }, { success: boolean }>(
		"system.handler.toggle",
		{
			onSuccess: () => {
				refetchHandlers();
			},
			invalidateQueries: [["system.get_state"], ["system.metrics"]]
		}
	);

	// Process handlers and extract domains
	const { handlers, domains } = useMemo(() => {
		if (!handlersData?.methods) {
			return { handlers: [], domains: [] };
		}

		const methods = handlersData.methods.map(method => ({
			...method,
			domain: method.name.split(".")[0],
			action: method.name.split(".")[1],
		}));

		const uniqueDomains = [...new Set(methods.map(m => m.domain))].filter(Boolean);

		// Apply search filter
		const filtered = methods.filter(handler => {
			const matchesSearch = !searchTerm || 
				handler.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				handler.description?.toLowerCase().includes(searchTerm.toLowerCase());
			
			const matchesDomain = selectedDomain === "all" || handler.domain === selectedDomain;
			
			return matchesSearch && matchesDomain;
		});

		return { 
			handlers: filtered, 
			domains: uniqueDomains as string[] 
		};
	}, [handlersData, searchTerm, selectedDomain]);

	// Get metrics for a specific handler
	const getHandlerMetrics = (handlerName: string): HandlerMetrics | undefined => {
		return metricsData?.handlers?.[handlerName];
	};

	// Render loading state
	if (isLoadingHandlers) {
		return (
			<div className={className}>
				<Card>
					<CardHeader>
						<CardTitle>Handler Manager</CardTitle>
						<CardDescription>Loading handlers...</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{[1, 2, 3].map(i => (
							<Skeleton key={i} className="h-24 w-full" />
						))}
					</CardContent>
				</Card>
			</div>
		);
	}

	// Render error state
	if (handlersError) {
		return (
			<div className={className}>
				<Alert variant="destructive">
					<AlertCircle className="h-4 w-4" />
					<AlertDescription>
						Failed to load handlers: {handlersError.message}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className={className}>
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="flex items-center gap-2">
								<Settings className="h-5 w-5" />
								Handler Manager
							</CardTitle>
							<CardDescription>
								Manage and monitor ClaudeBench event handlers
							</CardDescription>
						</div>
						<Button 
							onClick={() => refetchHandlers()} 
							variant="outline"
							size="sm"
						>
							<RefreshCw className="h-4 w-4 mr-2" />
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{/* Controls Bar */}
					<div className="flex flex-col sm:flex-row gap-4 mb-6">
						<div className="flex-1 relative">
							<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
							<Input
								placeholder="Search handlers..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-10"
							/>
						</div>
						<Select value={selectedDomain} onValueChange={setSelectedDomain}>
							<SelectTrigger className="w-[180px]">
								<Filter className="h-4 w-4 mr-2" />
								<SelectValue placeholder="Filter by domain" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Domains</SelectItem>
								{domains.map(domain => (
									<SelectItem key={domain} value={domain}>
										{domain}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<div className="flex gap-2">
							<Button
								variant={viewMode === "list" ? "default" : "outline"}
								size="sm"
								onClick={() => setViewMode("list")}
							>
								List
							</Button>
							<Button
								variant={viewMode === "grid" ? "default" : "outline"}
								size="sm"
								onClick={() => setViewMode("grid")}
							>
								Grid
							</Button>
						</div>
					</div>

					<Tabs defaultValue="handlers" className="space-y-4">
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="handlers">
								Handlers ({handlers.length})
							</TabsTrigger>
							<TabsTrigger value="metrics">
								Metrics
							</TabsTrigger>
							<TabsTrigger value="details">
								Details
							</TabsTrigger>
						</TabsList>

						{/* Handlers Tab */}
						<TabsContent value="handlers" className="space-y-4">
							<ScrollArea className="h-[600px] pr-4">
								{viewMode === "list" ? (
									<div className="space-y-4">
										{handlers.map(handler => (
											<HandlerCard
												key={handler.name}
												handler={handler}
												metrics={getHandlerMetrics(handler.name)}
												onSelect={() => setSelectedHandler(handler)}
												onToggle={() => toggleHandler.mutate({ 
													handler: handler.name, 
													enabled: !handler.enabled 
												})}
												isSelected={selectedHandler?.name === handler.name}
											/>
										))}
									</div>
								) : (
									<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
										{handlers.map(handler => (
											<HandlerGridCard
												key={handler.name}
												handler={handler}
												metrics={getHandlerMetrics(handler.name)}
												onSelect={() => setSelectedHandler(handler)}
											/>
										))}
									</div>
								)}
							</ScrollArea>
						</TabsContent>

						{/* Metrics Tab */}
						<TabsContent value="metrics" className="space-y-4">
							<MetricsOverview handlers={handlers} metrics={metricsData?.handlers || {}} />
						</TabsContent>

						{/* Details Tab */}
						<TabsContent value="details" className="space-y-4">
							{selectedHandler ? (
								<HandlerDetails handler={selectedHandler} metrics={getHandlerMetrics(selectedHandler.name)} />
							) : (
								<div className="text-center text-muted-foreground py-8">
									Select a handler to view details
								</div>
							)}
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
		</div>
	);
}

// Handler Card Component for list view
function HandlerCard({ 
	handler, 
	metrics, 
	onSelect, 
	onToggle,
	isSelected 
}: { 
	handler: HandlerMethod; 
	metrics?: HandlerMetrics;
	onSelect: () => void;
	onToggle: () => void;
	isSelected?: boolean;
}) {
	return (
		<Card 
			className={`cursor-pointer hover:shadow-md transition-shadow ${
				isSelected ? "ring-2 ring-primary" : ""
			}`} 
			onClick={onSelect}
		>
			<CardContent className="p-4">
				<div className="flex items-start justify-between">
					<div className="flex-1">
						<div className="flex items-center gap-2 mb-2">
							<h3 className="font-semibold text-sm">{handler.name}</h3>
							<Badge variant={handler.enabled !== false ? "default" : "secondary"}>
								{handler.enabled !== false ? "Enabled" : "Disabled"}
							</Badge>
							{handler.metadata.persist && (
								<Tooltip>
									<TooltipTrigger>
										<Database className="h-3 w-3 text-blue-500" />
									</TooltipTrigger>
									<TooltipContent>Persists to PostgreSQL</TooltipContent>
								</Tooltip>
							)}
						</div>
						{handler.description && (
							<p className="text-xs text-muted-foreground mb-2">{handler.description}</p>
						)}
						<div className="flex flex-wrap gap-2">
							{handler.metadata.rateLimit && (
								<Badge variant="outline" className="text-xs">
									<Zap className="h-3 w-3 mr-1" />
									{handler.metadata.rateLimit}/min
								</Badge>
							)}
							{handler.metadata.cache?.enabled && (
								<Badge variant="outline" className="text-xs">
									<Clock className="h-3 w-3 mr-1" />
									Cache: {handler.metadata.cache.ttl}s
								</Badge>
							)}
							{handler.metadata.roles && handler.metadata.roles.length > 0 && (
								<Badge variant="outline" className="text-xs">
									<Shield className="h-3 w-3 mr-1" />
									{handler.metadata.roles.join(", ")}
								</Badge>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						{metrics && (
							<div className="text-right">
								<div className="text-xs text-muted-foreground">
									{metrics.totalCalls} calls
								</div>
								<div className="text-xs">
									{metrics.successCount > 0 && (
										<span className="text-green-500">✓ {metrics.successCount}</span>
									)}
									{metrics.errorCount > 0 && (
										<span className="text-red-500 ml-2">✗ {metrics.errorCount}</span>
									)}
								</div>
								{metrics.circuitState && metrics.circuitState !== "CLOSED" && (
									<Badge variant={metrics.circuitState === "OPEN" ? "destructive" : "warning"} className="text-xs mt-1">
										Circuit: {metrics.circuitState}
									</Badge>
								)}
							</div>
						)}
						<Button
							size="sm"
							variant={handler.enabled !== false ? "outline" : "default"}
							onClick={(e) => {
								e.stopPropagation();
								onToggle();
							}}
						>
							{handler.enabled !== false ? "Disable" : "Enable"}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

// Handler Grid Card Component
function HandlerGridCard({ 
	handler, 
	metrics, 
	onSelect,
	isSelected 
}: { 
	handler: HandlerMethod; 
	metrics?: HandlerMetrics;
	onSelect: () => void;
	isSelected?: boolean;
}) {
	return (
		<Card 
			className={`cursor-pointer hover:shadow-md transition-shadow h-full ${
				isSelected ? "ring-2 ring-primary" : ""
			}`}
			onClick={onSelect}
		>
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between">
					<Badge 
						variant={handler.enabled !== false ? "default" : "secondary"}
						className="text-xs"
					>
						{handler.domain}
					</Badge>
					{metrics?.circuitState && metrics.circuitState !== "CLOSED" && (
						<AlertCircle className={`h-4 w-4 ${
							metrics.circuitState === "OPEN" ? "text-red-500" : "text-yellow-500"
						}`} />
					)}
				</div>
				<CardTitle className="text-sm mt-2">{handler.action}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				{handler.description && (
					<p className="text-xs text-muted-foreground line-clamp-2">
						{handler.description}
					</p>
				)}
				{metrics && (
					<div className="flex justify-between text-xs">
						<span className="text-muted-foreground">Calls:</span>
						<span>{metrics.totalCalls}</span>
					</div>
				)}
				{metrics && metrics.avgResponseTime > 0 && (
					<div className="flex justify-between text-xs">
						<span className="text-muted-foreground">Avg Time:</span>
						<span>{metrics.avgResponseTime.toFixed(0)}ms</span>
					</div>
				)}
				{metrics && metrics.cacheHitRate !== undefined && (
					<div className="flex justify-between text-xs">
						<span className="text-muted-foreground">Cache Hit:</span>
						<span>{(metrics.cacheHitRate * 100).toFixed(0)}%</span>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

// Handler Details Component
function HandlerDetails({ 
	handler, 
	metrics 
}: { 
	handler: HandlerMethod; 
	metrics?: HandlerMetrics;
}) {
	return (
		<div className="space-y-6">
			<div>
				<h3 className="text-lg font-semibold mb-4">{handler.name}</h3>
				{handler.description && (
					<p className="text-muted-foreground mb-4">{handler.description}</p>
				)}
			</div>

			{/* Quick Stats Overview */}
			{metrics && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs font-medium text-muted-foreground">
								Total Calls
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-xl font-bold">{metrics.totalCalls || 0}</div>
							<p className="text-xs text-muted-foreground mt-1">
								Success: {metrics.successCount || 0} | Error: {metrics.errorCount || 0}
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs font-medium text-muted-foreground">
								Performance
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-xl font-bold">
								{metrics.avgResponseTime ? `${metrics.avgResponseTime.toFixed(0)}ms` : "N/A"}
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Avg response time
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs font-medium text-muted-foreground">
								Circuit Breaker
							</CardTitle>
						</CardHeader>
						<CardContent>
							<Badge 
								variant={
									metrics.circuitState === "CLOSED" ? "default" :
									metrics.circuitState === "OPEN" ? "destructive" : "warning"
								}
								className="text-xs"
							>
								{metrics.circuitState || "CLOSED"}
							</Badge>
							{metrics.rateLimitHits && metrics.rateLimitHits > 0 && (
								<p className="text-xs text-red-500 mt-1">
									Rate limit hits: {metrics.rateLimitHits}
								</p>
							)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-xs font-medium text-muted-foreground">
								Cache Performance
							</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="text-xl font-bold">
								{metrics.cacheHitRate !== undefined 
									? `${(metrics.cacheHitRate * 100).toFixed(0)}%`
									: "N/A"}
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								Hit rate
							</p>
						</CardContent>
					</Card>
				</div>
			)}

			<Separator />

			<Accordion type="single" collapsible className="w-full" defaultValue="metrics">
				{/* Detailed Metrics Section - Expanded by default */}
				{metrics && (
					<AccordionItem value="metrics">
						<AccordionTrigger>
							<div className="flex items-center gap-2">
								<BarChart3 className="h-4 w-4" />
								Detailed Metrics
							</div>
						</AccordionTrigger>
						<AccordionContent>
							<div className="space-y-4 pt-2">
								{/* Call Statistics */}
								<div>
									<h4 className="text-sm font-medium mb-3">Call Statistics</h4>
									<div className="grid grid-cols-3 gap-4">
										<div className="space-y-1">
											<label className="text-xs text-muted-foreground">Total Calls</label>
											<p className="text-lg font-semibold">{metrics.totalCalls || 0}</p>
										</div>
										<div className="space-y-1">
											<label className="text-xs text-muted-foreground">Successful</label>
											<p className="text-lg font-semibold text-green-600">{metrics.successCount || 0}</p>
										</div>
										<div className="space-y-1">
											<label className="text-xs text-muted-foreground">Failed</label>
											<p className="text-lg font-semibold text-red-600">{metrics.errorCount || 0}</p>
										</div>
									</div>
									{metrics.totalCalls > 0 && (
										<div className="mt-3">
											<label className="text-xs text-muted-foreground">Success Rate</label>
											<div className="flex items-center gap-2 mt-1">
												<div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
													<div 
														className="h-full bg-green-500"
														style={{ width: `${(metrics.successCount / metrics.totalCalls) * 100}%` }}
													/>
												</div>
												<span className="text-sm font-medium">
													{((metrics.successCount / metrics.totalCalls) * 100).toFixed(1)}%
												</span>
											</div>
										</div>
									)}
								</div>

								<Separator />

								{/* Performance Metrics */}
								<div>
									<h4 className="text-sm font-medium mb-3">Performance</h4>
									<div className="grid grid-cols-2 gap-4">
										<div className="space-y-1">
											<label className="text-xs text-muted-foreground">Average Response Time</label>
											<p className="text-sm font-medium">
												{metrics.avgResponseTime ? `${metrics.avgResponseTime.toFixed(2)}ms` : "N/A"}
											</p>
										</div>
										<div className="space-y-1">
											<label className="text-xs text-muted-foreground">Last Called</label>
											<p className="text-sm">
												{metrics.lastCalled ? new Date(metrics.lastCalled).toLocaleString() : "Never"}
											</p>
										</div>
									</div>
								</div>

								<Separator />

								{/* Resilience Metrics */}
								<div>
									<h4 className="text-sm font-medium mb-3">Resilience & Protection</h4>
									<div className="space-y-3">
										<div className="flex items-center justify-between">
											<span className="text-sm text-muted-foreground">Circuit Breaker State</span>
											<Badge 
												variant={
													metrics.circuitState === "CLOSED" ? "default" :
													metrics.circuitState === "OPEN" ? "destructive" : "warning"
												}
											>
												{metrics.circuitState || "CLOSED"}
											</Badge>
										</div>
										{metrics.rateLimitHits !== undefined && (
											<div className="flex items-center justify-between">
												<span className="text-sm text-muted-foreground">Rate Limit Hits</span>
												<span className="text-sm font-medium">
													{metrics.rateLimitHits}
												</span>
											</div>
										)}
										<div className="flex items-center justify-between">
											<span className="text-sm text-muted-foreground">Cache Hit Rate</span>
											<span className="text-sm font-medium">
												{metrics.cacheHitRate !== undefined 
													? `${(metrics.cacheHitRate * 100).toFixed(1)}%`
													: "No cache"}
											</span>
										</div>
									</div>
								</div>
							</div>
						</AccordionContent>
					</AccordionItem>
				)}

				{/* Configuration Section */}
				<AccordionItem value="configuration">
					<AccordionTrigger>
						<div className="flex items-center gap-2">
							<Settings className="h-4 w-4" />
							Configuration
						</div>
					</AccordionTrigger>
					<AccordionContent>
						<div className="space-y-4 pt-2">
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Persistence</label>
									<div className="flex items-center gap-2">
										{handler.metadata.persist ? (
											<>
												<CheckCircle2 className="h-4 w-4 text-green-500" />
												<span className="text-sm">Enabled (PostgreSQL)</span>
											</>
										) : (
											<>
												<XCircle className="h-4 w-4 text-gray-400" />
												<span className="text-sm">Disabled (Redis only)</span>
											</>
										)}
									</div>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Rate Limit</label>
									<p className="text-sm font-medium">
										{handler.metadata.rateLimit ? `${handler.metadata.rateLimit} req/min` : "Unlimited"}
									</p>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Cache Settings</label>
									<p className="text-sm font-medium">
										{handler.metadata.cache?.enabled 
											? `Enabled (TTL: ${handler.metadata.cache.ttl}s)` 
											: "Disabled"}
									</p>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Timeout</label>
									<p className="text-sm font-medium">
										{handler.metadata.resilience?.timeout 
											? `${handler.metadata.resilience.timeout}ms` 
											: "Default (30s)"}
									</p>
								</div>
							</div>
							
							{handler.metadata.resilience?.circuitBreaker && (
								<div>
									<label className="text-xs text-muted-foreground">Circuit Breaker Settings</label>
									<div className="mt-1 p-2 bg-muted/30 rounded-md">
										<p className="text-xs">
											Threshold: {handler.metadata.resilience.circuitBreaker.threshold} failures
										</p>
										<p className="text-xs">
											Recovery timeout: {handler.metadata.resilience.circuitBreaker.timeout}ms
										</p>
									</div>
								</div>
							)}

							{handler.metadata.roles && handler.metadata.roles.length > 0 && (
								<div>
									<label className="text-xs text-muted-foreground">Required Roles</label>
									<div className="flex flex-wrap gap-2 mt-1">
										{handler.metadata.roles.map(role => (
											<Badge key={role} variant="secondary" className="text-xs">
												<Shield className="h-3 w-3 mr-1" />
												{role}
											</Badge>
										))}
									</div>
								</div>
							)}
						</div>
					</AccordionContent>
				</AccordionItem>

				{/* Input Schema Section */}
				<AccordionItem value="input-schema">
					<AccordionTrigger>
						<div className="flex items-center gap-2">
							<Code className="h-4 w-4" />
							Input Schema
						</div>
					</AccordionTrigger>
					<AccordionContent>
						<ScrollArea className="h-[200px] w-full rounded-md border p-4 bg-muted/30">
							<pre className="text-xs font-mono">
								{JSON.stringify(handler.inputSchema, null, 2)}
							</pre>
						</ScrollArea>
					</AccordionContent>
				</AccordionItem>

				{/* Output Schema Section */}
				<AccordionItem value="output-schema">
					<AccordionTrigger>
						<div className="flex items-center gap-2">
							<Code className="h-4 w-4" />
							Output Schema
						</div>
					</AccordionTrigger>
					<AccordionContent>
						<ScrollArea className="h-[200px] w-full rounded-md border p-4 bg-muted/30">
							<pre className="text-xs font-mono">
								{JSON.stringify(handler.outputSchema, null, 2)}
							</pre>
						</ScrollArea>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
}

// Metrics Overview Component
function MetricsOverview({ 
	handlers, 
	metrics 
}: { 
	handlers: HandlerMethod[]; 
	metrics: Record<string, HandlerMetrics>;
}) {
	// Calculate aggregate metrics
	const aggregateMetrics = useMemo(() => {
		const totalCalls = Object.values(metrics).reduce((sum, m) => sum + (m.totalCalls || 0), 0);
		const totalSuccess = Object.values(metrics).reduce((sum, m) => sum + (m.successCount || 0), 0);
		const totalErrors = Object.values(metrics).reduce((sum, m) => sum + (m.errorCount || 0), 0);
		const avgResponseTime = Object.values(metrics)
			.filter(m => m.avgResponseTime > 0)
			.reduce((sum, m, _, arr) => sum + m.avgResponseTime / arr.length, 0);

		const openCircuits = Object.values(metrics).filter(m => m.circuitState === "OPEN").length;
		const halfOpenCircuits = Object.values(metrics).filter(m => m.circuitState === "HALF_OPEN").length;

		return {
			totalCalls,
			totalSuccess,
			totalErrors,
			avgResponseTime,
			successRate: totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 0,
			openCircuits,
			halfOpenCircuits,
		};
	}, [metrics]);

	// Get top handlers by calls
	const topHandlers = useMemo(() => {
		return Object.entries(metrics)
			.sort(([, a], [, b]) => b.totalCalls - a.totalCalls)
			.slice(0, 5)
			.map(([name, data]) => ({ name, ...data }));
	}, [metrics]);

	return (
		<div className="space-y-6">
			{/* Overview Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Total Calls
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{aggregateMetrics.totalCalls}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Success Rate
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{aggregateMetrics.successRate.toFixed(1)}%
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Avg Response
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{aggregateMetrics.avgResponseTime.toFixed(0)}ms
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm font-medium text-muted-foreground">
							Circuit Status
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex items-center gap-2">
							{aggregateMetrics.openCircuits > 0 && (
								<Badge variant="destructive" className="text-xs">
									{aggregateMetrics.openCircuits} Open
								</Badge>
							)}
							{aggregateMetrics.halfOpenCircuits > 0 && (
								<Badge variant="warning" className="text-xs">
									{aggregateMetrics.halfOpenCircuits} Half
								</Badge>
							)}
							{aggregateMetrics.openCircuits === 0 && aggregateMetrics.halfOpenCircuits === 0 && (
								<Badge variant="default" className="text-xs">
									All Healthy
								</Badge>
							)}
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Top Handlers */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Most Active Handlers</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{topHandlers.map((handler, index) => (
							<div key={handler.name} className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<span className="text-sm font-medium text-muted-foreground">
										#{index + 1}
									</span>
									<span className="text-sm font-medium">{handler.name}</span>
								</div>
								<div className="flex items-center gap-4">
									<span className="text-sm text-muted-foreground">
										{handler.totalCalls} calls
									</span>
									<Badge variant="outline" className="text-xs">
										{((handler.successCount / handler.totalCalls) * 100).toFixed(0)}%
									</Badge>
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

// Wrap everything with TooltipProvider
export default function HandlerManagerWithProvider(props: HandlerManagerProps) {
	return (
		<TooltipProvider>
			<HandlerManager {...props} />
		</TooltipProvider>
	);
}