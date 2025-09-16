import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
	getEventClient,
	useSystemHealth,
	useSystemState,
	useEventMutation
} from "@/services/event-client";
import { 
	Heart,
	AlertTriangle,
	CheckCircle,
	XCircle,
	Server,
	Database,
	Network,
	RefreshCw,
	Activity,
	Clock,
	Hash,
	User,
	ChevronRight,
	Zap,
	Pause,
	Play,
	Shield,
	Cpu,
	HardDrive,
	Signal
} from "lucide-react";

// Instance type based on the system schema
interface Instance {
	id: string;
	roles: string[];
	status: "ACTIVE" | "IDLE" | "BUSY" | "OFFLINE";
	lastHeartbeat: string;
	registeredAt: string;
	metadata?: Record<string, any>;
}

interface ServiceHealth {
	redis: boolean;
	postgres: boolean;
	mcp: boolean;
}

interface InstanceHealthProps {
	autoRefresh?: boolean;
	showFilters?: boolean;
	className?: string;
}

export function InstanceHealth({ 
	autoRefresh = true,
	showFilters = true,
	className
}: InstanceHealthProps) {
	// State
	const [instances, setInstances] = useState<Instance[]>([]);
	const [filteredInstances, setFilteredInstances] = useState<Instance[]>([]);
	const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	const [serviceHealth, setServiceHealth] = useState<ServiceHealth>({
		redis: true,
		postgres: true,
		mcp: true
	});
	const [systemStatus, setSystemStatus] = useState<"healthy" | "degraded" | "unhealthy">("healthy");
	
	// Filters
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [roleFilter, setRoleFilter] = useState<string>("all");
	const [searchTerm, setSearchTerm] = useState("");
	const [isPaused, setIsPaused] = useState(false);
	
	// Refs
	const connectionRef = useRef<{ ws: WebSocket; subscriptions: Set<string>; close: () => void } | null>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	
	// Queries and Mutations
	const { data: systemState, refetch: refetchState } = useSystemState();
	const { data: healthData, refetch: refetchHealth } = useSystemHealth();
	const registerMutation = useEventMutation("system.register");
	const heartbeatMutation = useEventMutation("system.heartbeat");
	
	// Connect to WebSocket for real-time updates
	const connectWebSocket = useCallback(() => {
		if (isPaused) return;
		
		const client = getEventClient();
		
		connectionRef.current = client.subscribeToEvents(
			["system.*"],
			(message: any) => {
				try {
					if (message.type === "event") {
						const eventType = message.event;
						const eventPayload = message.data?.payload;
						const eventMetadata = message.data?.metadata;
						
						// Handle different system events
						if (eventType === "system.registered") {
							// New instance registered
							setInstances(prev => {
								// Parse roles - handle JSON strings, arrays, and other formats
								let roles: string[] = [];
								if (typeof eventPayload.roles === 'string') {
									try {
										const parsed = JSON.parse(eventPayload.roles);
										roles = Array.isArray(parsed) ? parsed : [parsed];
									} catch {
										roles = [eventPayload.roles];
									}
								} else if (Array.isArray(eventPayload.roles)) {
									roles = eventPayload.roles;
								} else if (eventPayload.roles) {
									roles = [String(eventPayload.roles)];
								}
								
								const newInstance: Instance = {
									id: eventPayload.id,
									roles,
									status: "ACTIVE",
									lastHeartbeat: new Date().toISOString(),
									registeredAt: new Date().toISOString(),
									metadata: eventMetadata
								};
								// Check if instance already exists
								const exists = prev.some(i => i.id === eventPayload.id);
								if (exists) {
									return prev.map(i => i.id === eventPayload.id ? newInstance : i);
								}
								return [...prev, newInstance];
							});
						} else if (eventType === "system.heartbeat") {
							// Instance heartbeat received
							setInstances(prev => prev.map(instance => 
								instance.id === eventPayload.instanceId 
									? { ...instance, status: "ACTIVE", lastHeartbeat: new Date().toISOString() }
									: instance
							));
						} else if (eventType === "system.health") {
							// Health status update
							if (eventPayload.status) {
								setSystemStatus(eventPayload.status);
							}
							if (eventPayload.services) {
								setServiceHealth(eventPayload.services);
							}
						}
					}
				} catch (error) {
					console.error("Failed to process system event:", error);
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
	}, [isPaused]);
	
	// Disconnect WebSocket
	const disconnectWebSocket = useCallback(() => {
		if (connectionRef.current) {
			connectionRef.current.close();
			connectionRef.current = null;
		}
		setIsConnected(false);
	}, []);
	
	// Initialize instances from system state
	useEffect(() => {
		if (systemState?.instances) {
			const mappedInstances = (systemState.instances as any[]).map(inst => {
				// Parse roles - handle JSON strings, arrays, and other formats
				let roles: string[] = [];
				if (typeof inst.roles === 'string') {
					try {
						// Try to parse as JSON if it's a string
						const parsed = JSON.parse(inst.roles);
						roles = Array.isArray(parsed) ? parsed : [parsed];
					} catch {
						// If not JSON, treat as a single role
						roles = [inst.roles];
					}
				} else if (Array.isArray(inst.roles)) {
					roles = inst.roles;
				} else if (inst.roles) {
					roles = [String(inst.roles)];
				}
				
				return {
					id: inst.id || inst.instanceId || `instance-${Date.now()}`,
					roles,
					status: inst.status || "ACTIVE",
					lastHeartbeat: inst.lastHeartbeat || inst.lastSeen || new Date().toISOString(),
					registeredAt: inst.registeredAt || inst.createdAt || new Date().toISOString(),
					metadata: inst.metadata
				};
			});
			setInstances(mappedInstances);
		}
	}, [systemState]);
	
	// Update service health from health data
	useEffect(() => {
		if (healthData) {
			setSystemStatus(healthData.status);
			setServiceHealth(healthData.services);
		}
	}, [healthData]);
	
	// Connect to WebSocket on mount
	useEffect(() => {
		if (!isPaused) {
			connectWebSocket();
		}
		return disconnectWebSocket;
	}, [connectWebSocket, disconnectWebSocket, isPaused]);
	
	// Check for stale instances (no heartbeat for 60 seconds)
	useEffect(() => {
		const interval = setInterval(() => {
			const now = Date.now();
			setInstances(prev => prev.map(instance => {
				const lastHeartbeatTime = new Date(instance.lastHeartbeat).getTime();
				const timeSinceHeartbeat = now - lastHeartbeatTime;
				
				if (timeSinceHeartbeat > 60000 && instance.status !== "OFFLINE") {
					// Mark as offline if no heartbeat for 60 seconds
					return { ...instance, status: "OFFLINE" };
				} else if (timeSinceHeartbeat > 30000 && timeSinceHeartbeat <= 60000 && instance.status === "ACTIVE") {
					// Mark as idle if no heartbeat for 30 seconds
					return { ...instance, status: "IDLE" };
				}
				return instance;
			}));
		}, 5000); // Check every 5 seconds
		
		return () => clearInterval(interval);
	}, []);
	
	// Get unique roles from instances
	const uniqueRoles = useMemo(() => {
		const roles = new Set<string>();
		instances.forEach(inst => {
			if (Array.isArray(inst.roles)) {
				inst.roles.forEach(role => roles.add(role));
			}
		});
		return Array.from(roles);
	}, [instances]);
	
	// Filter instances
	useEffect(() => {
		let filtered = [...instances];
		
		// Status filter
		if (statusFilter !== "all") {
			filtered = filtered.filter(i => i.status === statusFilter);
		}
		
		// Role filter
		if (roleFilter !== "all") {
			filtered = filtered.filter(i => Array.isArray(i.roles) && i.roles.includes(roleFilter));
		}
		
		// Search filter
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(i => 
				i.id.toLowerCase().includes(term) ||
				(Array.isArray(i.roles) && i.roles.some(r => r.toLowerCase().includes(term))) ||
				(i.metadata && JSON.stringify(i.metadata).toLowerCase().includes(term))
			);
		}
		
		// Sort by status (active first) then by last heartbeat
		filtered.sort((a, b) => {
			const statusOrder = { ACTIVE: 0, BUSY: 1, IDLE: 2, OFFLINE: 3 };
			const statusDiff = statusOrder[a.status] - statusOrder[b.status];
			if (statusDiff !== 0) return statusDiff;
			
			return new Date(b.lastHeartbeat).getTime() - new Date(a.lastHeartbeat).getTime();
		});
		
		setFilteredInstances(filtered);
	}, [instances, statusFilter, roleFilter, searchTerm]);
	
	// Get status color
	const getStatusColor = (status: Instance["status"]): string => {
		switch (status) {
			case "ACTIVE": return "green";
			case "BUSY": return "blue";
			case "IDLE": return "yellow";
			case "OFFLINE": return "red";
			default: return "gray";
		}
	};
	
	// Get status icon
	const getStatusIcon = (status: Instance["status"]) => {
		switch (status) {
			case "ACTIVE": return <CheckCircle className="h-4 w-4" />;
			case "BUSY": return <Activity className="h-4 w-4" />;
			case "IDLE": return <Pause className="h-4 w-4" />;
			case "OFFLINE": return <XCircle className="h-4 w-4" />;
		}
	};
	
	// Get system status color
	const getSystemStatusColor = () => {
		switch (systemStatus) {
			case "healthy": return "text-green-600";
			case "degraded": return "text-yellow-600";
			case "unhealthy": return "text-red-600";
			default: return "text-gray-600";
		}
	};
	
	// Get system status icon
	const getSystemStatusIcon = () => {
		switch (systemStatus) {
			case "healthy": return <CheckCircle className="h-5 w-5" />;
			case "degraded": return <AlertTriangle className="h-5 w-5" />;
			case "unhealthy": return <XCircle className="h-5 w-5" />;
			default: return <Activity className="h-5 w-5" />;
		}
	};
	
	// Format date
	const formatDate = (dateStr: string): string => {
		return new Date(dateStr).toLocaleString("en-US", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit"
		});
	};
	
	// Calculate time since last heartbeat
	const getTimeSinceHeartbeat = (lastHeartbeat: string): string => {
		const now = Date.now();
		const then = new Date(lastHeartbeat).getTime();
		const diff = Math.floor((now - then) / 1000); // in seconds
		
		if (diff < 60) return `${diff}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	};
	
	// Send heartbeat for an instance
	const sendHeartbeat = async (instanceId: string) => {
		await heartbeatMutation.mutateAsync({ instanceId });
		await refetchState();
	};
	
	// Refresh all data
	const handleRefresh = async () => {
		await Promise.all([refetchState(), refetchHealth()]);
	};
	
	// Instance stats
	const instanceStats = useMemo(() => {
		return {
			total: instances.length,
			active: instances.filter(i => i.status === "ACTIVE").length,
			busy: instances.filter(i => i.status === "BUSY").length,
			idle: instances.filter(i => i.status === "IDLE").length,
			offline: instances.filter(i => i.status === "OFFLINE").length,
		};
	}, [instances]);
	
	// Service health percentage
	const serviceHealthPercentage = useMemo(() => {
		const services = [serviceHealth.redis, serviceHealth.postgres, serviceHealth.mcp];
		const healthyCount = services.filter(Boolean).length;
		return (healthyCount / services.length) * 100;
	}, [serviceHealth]);
	
	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Heart className="h-5 w-5" />
							Instance Health
						</CardTitle>
						<CardDescription>
							Monitor and manage system instances
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant={isConnected ? "default" : "secondary"}>
							{isConnected ? "Connected" : "Disconnected"}
						</Badge>
						<Badge 
							variant="outline" 
							className={cn("gap-1", getSystemStatusColor())}
						>
							{getSystemStatusIcon()}
							{systemStatus}
						</Badge>
						<Badge variant="outline">
							{instanceStats.total} instances
						</Badge>
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* System Health Alert */}
				{systemStatus !== "healthy" && (
					<Alert variant={systemStatus === "degraded" ? "warning" : "destructive"}>
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>System {systemStatus}</AlertTitle>
						<AlertDescription>
							{systemStatus === "degraded" 
								? "Some services are experiencing issues. Performance may be impacted."
								: "Critical services are down. Immediate attention required."}
						</AlertDescription>
					</Alert>
				)}
				
				{/* Controls */}
				{showFilters && (
					<div className="flex flex-wrap gap-2">
						{/* Status Filter */}
						<Select value={statusFilter} onValueChange={setStatusFilter}>
							<SelectTrigger className="w-[150px]">
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All statuses</SelectItem>
								<SelectItem value="ACTIVE">Active</SelectItem>
								<SelectItem value="BUSY">Busy</SelectItem>
								<SelectItem value="IDLE">Idle</SelectItem>
								<SelectItem value="OFFLINE">Offline</SelectItem>
							</SelectContent>
						</Select>
						
						{/* Role Filter */}
						{uniqueRoles.length > 0 && (
							<Select value={roleFilter} onValueChange={setRoleFilter}>
								<SelectTrigger className="w-[150px]">
									<SelectValue placeholder="All roles" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All roles</SelectItem>
									{uniqueRoles.map(role => (
										<SelectItem key={role} value={role}>
											{role}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						
						{/* Search */}
						<div className="flex-1">
							<Input
								placeholder="Search instances..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
							/>
						</div>
						
						{/* Auto-refresh toggle */}
						<div className="flex items-center gap-2">
							<Switch
								id="auto-refresh"
								checked={!isPaused}
								onCheckedChange={(checked) => setIsPaused(!checked)}
							/>
							<Label htmlFor="auto-refresh">Live updates</Label>
						</div>
						
						{/* Refresh button */}
						<Button
							variant="outline"
							size="sm"
							onClick={handleRefresh}
						>
							<RefreshCw className="h-4 w-4" />
						</Button>
					</div>
				)}
				
				{/* Service Health Cards */}
				<div className="grid grid-cols-4 gap-2">
					<Card>
						<CardContent className="p-3">
							<div className="flex items-center justify-between mb-2">
								<span className="text-sm font-medium">Services</span>
								<Progress value={serviceHealthPercentage} className="w-16" />
							</div>
							<div className="text-2xl font-bold">{serviceHealthPercentage.toFixed(0)}%</div>
							<p className="text-xs text-muted-foreground">Overall health</p>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-3">
							<div className="flex items-center gap-2 mb-2">
								<Database className={cn("h-4 w-4", serviceHealth.redis ? "text-green-600" : "text-red-600")} />
								<span className="text-sm font-medium">Redis</span>
							</div>
							<div className="flex items-center gap-2">
								{serviceHealth.redis ? (
									<CheckCircle className="h-4 w-4 text-green-600" />
								) : (
									<XCircle className="h-4 w-4 text-red-600" />
								)}
								<span className="text-sm">{serviceHealth.redis ? "Connected" : "Disconnected"}</span>
							</div>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-3">
							<div className="flex items-center gap-2 mb-2">
								<HardDrive className={cn("h-4 w-4", serviceHealth.postgres ? "text-green-600" : "text-red-600")} />
								<span className="text-sm font-medium">PostgreSQL</span>
							</div>
							<div className="flex items-center gap-2">
								{serviceHealth.postgres ? (
									<CheckCircle className="h-4 w-4 text-green-600" />
								) : (
									<XCircle className="h-4 w-4 text-red-600" />
								)}
								<span className="text-sm">{serviceHealth.postgres ? "Connected" : "Disconnected"}</span>
							</div>
						</CardContent>
					</Card>
					
					<Card>
						<CardContent className="p-3">
							<div className="flex items-center gap-2 mb-2">
								<Network className={cn("h-4 w-4", serviceHealth.mcp ? "text-green-600" : "text-red-600")} />
								<span className="text-sm font-medium">MCP</span>
							</div>
							<div className="flex items-center gap-2">
								{serviceHealth.mcp ? (
									<CheckCircle className="h-4 w-4 text-green-600" />
								) : (
									<XCircle className="h-4 w-4 text-red-600" />
								)}
								<span className="text-sm">{serviceHealth.mcp ? "Active" : "Inactive"}</span>
							</div>
						</CardContent>
					</Card>
				</div>
				
				{/* Instance Statistics */}
				<div className="grid grid-cols-5 gap-2">
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold">{instanceStats.total}</div>
							<p className="text-xs text-muted-foreground">Total</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-green-600">{instanceStats.active}</div>
							<p className="text-xs text-muted-foreground">Active</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-blue-600">{instanceStats.busy}</div>
							<p className="text-xs text-muted-foreground">Busy</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-yellow-600">{instanceStats.idle}</div>
							<p className="text-xs text-muted-foreground">Idle</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="p-3">
							<div className="text-2xl font-bold text-red-600">{instanceStats.offline}</div>
							<p className="text-xs text-muted-foreground">Offline</p>
						</CardContent>
					</Card>
				</div>
				
				{/* Instance List and Details */}
				<div className="flex-1 flex gap-4 min-h-0">
					<ScrollArea className="flex-1 border rounded-md" ref={scrollAreaRef}>
						<div className="p-4 space-y-2">
							{filteredInstances.length === 0 ? (
								<div className="text-center text-muted-foreground py-8">
									{instances.length === 0 ? "No instances registered" : "No instances match filters"}
								</div>
							) : (
								filteredInstances.map((instance) => (
									<Card
										key={instance.id}
										className={`cursor-pointer transition-colors hover:bg-accent ${
											selectedInstance?.id === instance.id ? "bg-accent" : ""
										}`}
										onClick={() => setSelectedInstance(instance)}
									>
										<CardContent className="p-3">
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2 mb-1">
														<Badge
															variant={getStatusColor(instance.status) as any}
															className="gap-1"
														>
															{getStatusIcon(instance.status)}
															{instance.status}
														</Badge>
														{Array.isArray(instance.roles) && instance.roles.map(role => (
															<Badge key={role} variant="outline">
																<Shield className="h-3 w-3 mr-1" />
																{role}
															</Badge>
														))}
													</div>
													<p className="text-sm font-medium">
														{instance.id}
													</p>
													<div className="flex items-center gap-3 mt-1">
														<span className="text-xs text-muted-foreground flex items-center gap-1">
															<Clock className="h-3 w-3" />
															{getTimeSinceHeartbeat(instance.lastHeartbeat)}
														</span>
														<span className="text-xs text-muted-foreground flex items-center gap-1">
															<Signal className="h-3 w-3" />
															Registered {formatDate(instance.registeredAt)}
														</span>
													</div>
												</div>
												<ChevronRight className="h-4 w-4 text-muted-foreground" />
											</div>
										</CardContent>
									</Card>
								))
							)}
						</div>
					</ScrollArea>
					
					{/* Instance Details */}
					{selectedInstance && (
						<Card className="w-[400px] flex flex-col">
							<CardHeader className="pb-3">
								<CardTitle className="text-base">Instance Details</CardTitle>
								<CardDescription className="text-xs">
									{selectedInstance.id}
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 overflow-auto">
								<div className="space-y-4">
									<div>
										<Label className="text-xs">Instance ID</Label>
										<p className="text-sm mt-1 font-mono">{selectedInstance.id}</p>
									</div>
									
									<Separator />
									
									<div>
										<Label className="text-xs">Status</Label>
										<div className="mt-1">
											<Badge
												variant={getStatusColor(selectedInstance.status) as any}
												className="gap-1"
											>
												{getStatusIcon(selectedInstance.status)}
												{selectedInstance.status}
											</Badge>
										</div>
									</div>
									
									<div>
										<Label className="text-xs">Roles</Label>
										<div className="flex flex-wrap gap-1 mt-1">
											{Array.isArray(selectedInstance.roles) && selectedInstance.roles.length > 0 ? (
												selectedInstance.roles.map(role => (
													<Badge key={role} variant="secondary">
														<Shield className="h-3 w-3 mr-1" />
														{role}
													</Badge>
												))
											) : (
												<span className="text-sm text-muted-foreground">No roles assigned</span>
											)}
										</div>
									</div>
									
									<div className="grid grid-cols-2 gap-4">
										<div>
											<Label className="text-xs">Last Heartbeat</Label>
											<p className="text-sm mt-1">
												{formatDate(selectedInstance.lastHeartbeat)}
											</p>
											<p className="text-xs text-muted-foreground mt-1">
												{getTimeSinceHeartbeat(selectedInstance.lastHeartbeat)}
											</p>
										</div>
										<div>
											<Label className="text-xs">Registered</Label>
											<p className="text-sm mt-1">
												{formatDate(selectedInstance.registeredAt)}
											</p>
										</div>
									</div>
									
									{selectedInstance.metadata && Object.keys(selectedInstance.metadata).length > 0 && (
										<div>
											<Label className="text-xs">Metadata</Label>
											<pre className="text-xs bg-muted p-2 rounded-md mt-1 overflow-auto">
												{JSON.stringify(selectedInstance.metadata, null, 2)}
											</pre>
										</div>
									)}
									
									<Separator />
									
									<div className="flex gap-2">
										<Button
											size="sm"
											onClick={() => sendHeartbeat(selectedInstance.id)}
											disabled={heartbeatMutation.isPending}
										>
											<Heart className="h-4 w-4 mr-1" />
											Send Heartbeat
										</Button>
										{selectedInstance.status === "OFFLINE" && (
											<Button
												size="sm"
												variant="outline"
												onClick={async () => {
													await registerMutation.mutateAsync({
														id: selectedInstance.id,
														roles: selectedInstance.roles
													});
													await refetchState();
												}}
											>
												<Zap className="h-4 w-4 mr-1" />
												Re-register
											</Button>
										)}
									</div>
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			</CardContent>
		</Card>
	);
}