import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Plus,
	User,
	Activity,
	Shield,
	Clock,
	RefreshCw,
	XCircle,
	CheckCircle,
	AlertCircle,
	Server,
	Zap,
	Heart,
} from "lucide-react";
import { useEventMutation, useEventQuery } from "@/services/event-client";
import { formatDistanceToNow } from "date-fns";

interface Instance {
	id: string;
	roles: string[];
	status?: "ACTIVE" | "IDLE" | "BUSY" | "OFFLINE";
	health?: string;
	lastSeen?: string;
	taskCount?: number;
}

interface InstanceManagerProps {
	onInstancesChange?: (instances: Instance[]) => void;
	className?: string;
}

// Predefined roles that users can select
const AVAILABLE_ROLES = [
	{ id: "worker", label: "Worker", description: "Can claim and process tasks" },
	{ id: "validator", label: "Validator", description: "Can validate task results" },
	{ id: "supervisor", label: "Supervisor", description: "Can manage other instances" },
	{ id: "scheduler", label: "Scheduler", description: "Can assign tasks to instances" },
	{ id: "monitor", label: "Monitor", description: "Read-only access for monitoring" },
	{ id: "admin", label: "Admin", description: "Full system access" },
];

export function InstanceManager({ onInstancesChange, className }: InstanceManagerProps) {
	const [instances, setInstances] = useState<Instance[]>([]);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [newInstanceId, setNewInstanceId] = useState("");
	const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
	const [isCreating, setIsCreating] = useState(false);
	const [heartbeatIntervals, setHeartbeatIntervals] = useState<Map<string, NodeJS.Timeout>>(new Map());

	// Queries
	const { 
		data: systemState, 
		isLoading, 
		refetch: refetchState 
	} = useEventQuery(
		"system.get_state",
		{},
		{ refetchInterval: 5000 } // Refresh every 5 seconds
	);

	// Mutations
	const registerMutation = useEventMutation("system.register");
	const heartbeatMutation = useEventMutation("system.heartbeat");
	const unregisterMutation = useEventMutation("system.unregister");

	// Update instances from system state
	useEffect(() => {
		if (systemState?.instances) {
			const instanceList = systemState.instances.map((inst: any) => {
				let roles: string[] = [];
				if (inst.roles) {
					if (Array.isArray(inst.roles)) {
						roles = inst.roles;
					} else if (typeof inst.roles === 'string') {
						try {
							const parsed = JSON.parse(inst.roles);
							roles = Array.isArray(parsed) ? parsed : [parsed];
						} catch {
							roles = [inst.roles];
						}
					}
				}
				return {
					id: inst.id || inst.instanceId,
					roles,
					status: inst.status || "ACTIVE",
					health: inst.health || "healthy",
					lastSeen: inst.lastSeen || inst.lastHeartbeat || new Date().toISOString(),
					taskCount: inst.taskCount || 0,
				};
			});
			setInstances(instanceList);
			onInstancesChange?.(instanceList);
		}
	}, [systemState, onInstancesChange]);

	// Generate a unique instance ID
	const generateInstanceId = () => {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 5);
		return `inst-${timestamp}-${random}`;
	};

	// Start heartbeat for an instance
	const startHeartbeat = (instanceId: string) => {
		// Clear existing heartbeat if any
		const existingInterval = heartbeatIntervals.get(instanceId);
		if (existingInterval) {
			clearInterval(existingInterval);
		}

		// Send heartbeat every 20 seconds (TTL is 30s)
		const interval = setInterval(() => {
			heartbeatMutation.mutate(
				{ instanceId },
				{
					onError: (error) => {
						console.error(`Heartbeat failed for ${instanceId}:`, error);
						// Stop heartbeat if it fails
						stopHeartbeat(instanceId);
					},
				}
			);
		}, 20000);

		setHeartbeatIntervals((prev) => new Map(prev).set(instanceId, interval));
		
		// Send immediate heartbeat
		heartbeatMutation.mutate({ instanceId });
	};

	// Stop heartbeat for an instance
	const stopHeartbeat = (instanceId: string) => {
		const interval = heartbeatIntervals.get(instanceId);
		if (interval) {
			clearInterval(interval);
			setHeartbeatIntervals((prev) => {
				const newMap = new Map(prev);
				newMap.delete(instanceId);
				return newMap;
			});
		}
	};

	// Create a new instance
	const handleCreateInstance = async () => {
		if (!newInstanceId || selectedRoles.length === 0) return;
		
		setIsCreating(true);
		try {
			await registerMutation.mutateAsync({
				id: newInstanceId,
				roles: selectedRoles,
			});
			
			// Start heartbeat for the new instance
			startHeartbeat(newInstanceId);
			
			// Reset form
			setNewInstanceId("");
			setSelectedRoles([]);
			setDialogOpen(false);
			
			// Refresh state
			await refetchState();
		} catch (error) {
			console.error("Failed to create instance:", error);
		} finally {
			setIsCreating(false);
		}
	};

	// Remove an instance
	const handleRemoveInstance = async (instanceId: string) => {
		try {
			// Stop heartbeat
			stopHeartbeat(instanceId);
			
			// Unregister if endpoint exists
			if (unregisterMutation) {
				await unregisterMutation.mutateAsync({
					instanceId,
					sessionId: `session-${Date.now()}`,
					timestamp: Date.now(),
				});
			}
			
			// Refresh state
			await refetchState();
		} catch (error) {
			console.error("Failed to remove instance:", error);
			// Still refresh to update UI
			await refetchState();
		}
	};

	// Get health color
	const getHealthColor = (health?: string) => {
		switch (health) {
			case "healthy":
				return "text-green-500";
			case "degraded":
				return "text-yellow-500";
			case "unhealthy":
				return "text-red-500";
			default:
				return "text-gray-500";
		}
	};

	// Get status badge variant
	const getStatusVariant = (status?: string) => {
		switch (status) {
			case "ACTIVE":
				return "default";
			case "IDLE":
				return "secondary";
			case "BUSY":
				return "warning";
			case "OFFLINE":
				return "destructive";
			default:
				return "outline";
		}
	};

	// Cleanup intervals on unmount
	useEffect(() => {
		return () => {
			heartbeatIntervals.forEach((interval) => clearInterval(interval));
		};
	}, []);

	return (
		<TooltipProvider>
			<Card className={className}>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle className="flex items-center gap-2">
								<Server className="h-5 w-5" />
								Instance Manager
							</CardTitle>
							<CardDescription>
								Manage worker instances and their roles
							</CardDescription>
						</div>
						<div className="flex gap-2">
							<Button
								onClick={() => refetchState()}
								variant="outline"
								size="sm"
							>
								<RefreshCw className="h-4 w-4 mr-2" />
								Refresh
							</Button>
							<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
								<DialogTrigger asChild>
									<Button size="sm">
										<Plus className="h-4 w-4 mr-2" />
										New Instance
									</Button>
								</DialogTrigger>
								<DialogContent className="sm:max-w-[500px]">
									<DialogHeader>
										<DialogTitle>Create New Instance</DialogTitle>
										<DialogDescription>
											Register a new instance with specific roles
										</DialogDescription>
									</DialogHeader>
									<div className="grid gap-4 py-4">
										<div className="grid gap-2">
											<Label htmlFor="instance-id">Instance ID</Label>
											<div className="flex gap-2">
												<Input
													id="instance-id"
													placeholder="inst-worker-1"
													value={newInstanceId}
													onChange={(e) => setNewInstanceId(e.target.value)}
												/>
												<Button
													onClick={() => setNewInstanceId(generateInstanceId())}
													variant="outline"
													size="sm"
												>
													Generate
												</Button>
											</div>
										</div>
										<div className="grid gap-2">
											<Label>Roles</Label>
											<div className="space-y-2 rounded-md border p-3">
												{AVAILABLE_ROLES.map((role) => (
													<div
														key={role.id}
														className="flex items-start space-x-2"
													>
														<Checkbox
															id={role.id}
															checked={selectedRoles.includes(role.id)}
															onCheckedChange={(checked) => {
																if (checked) {
																	setSelectedRoles([...selectedRoles, role.id]);
																} else {
																	setSelectedRoles(
																		selectedRoles.filter((r) => r !== role.id)
																	);
																}
															}}
														/>
														<div className="grid gap-1.5 leading-none">
															<label
																htmlFor={role.id}
																className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
															>
																{role.label}
															</label>
															<p className="text-xs text-muted-foreground">
																{role.description}
															</p>
														</div>
													</div>
												))}
											</div>
										</div>
									</div>
									<DialogFooter>
										<Button
											onClick={handleCreateInstance}
											disabled={!newInstanceId || selectedRoles.length === 0 || isCreating}
										>
											{isCreating ? (
												<>
													<RefreshCw className="h-4 w-4 mr-2 animate-spin" />
													Creating...
												</>
											) : (
												<>
													<Plus className="h-4 w-4 mr-2" />
													Create Instance
												</>
											)}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-8 text-muted-foreground">
							<RefreshCw className="h-4 w-4 mr-2 animate-spin" />
							Loading instances...
						</div>
					) : instances.length === 0 ? (
						<Alert>
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>
								No instances registered. Create one to start processing tasks.
							</AlertDescription>
						</Alert>
					) : (
						<ScrollArea className="h-[400px]">
							<div className="space-y-3">
								{instances.map((instance) => (
									<Card key={instance.id}>
										<CardContent className="p-4">
											<div className="flex items-start justify-between">
												<div className="space-y-2">
													<div className="flex items-center gap-2">
														<User className="h-4 w-4" />
														<span className="font-medium">{instance.id}</span>
														<Badge variant={getStatusVariant(instance.status)}>
															{instance.status || "UNKNOWN"}
														</Badge>
														<Tooltip>
															<TooltipTrigger>
																<Heart
																	className={`h-4 w-4 ${getHealthColor(
																		instance.health
																	)}`}
																/>
															</TooltipTrigger>
															<TooltipContent>
																Health: {instance.health || "unknown"}
															</TooltipContent>
														</Tooltip>
													</div>
													<div className="flex flex-wrap gap-2">
														{instance.roles.map((role) => (
															<Badge key={role} variant="outline" className="text-xs">
																<Shield className="h-3 w-3 mr-1" />
																{role}
															</Badge>
														))}
													</div>
													<div className="flex items-center gap-4 text-xs text-muted-foreground">
														<div className="flex items-center gap-1">
															<Clock className="h-3 w-3" />
															{(() => {
																if (!instance.lastSeen) return "Never";
																const date = new Date(instance.lastSeen);
																if (isNaN(date.getTime())) return "Invalid date";
																return `Last seen ${formatDistanceToNow(date, { addSuffix: true })}`;
															})()}
														</div>
														{instance.taskCount !== undefined && (
															<div className="flex items-center gap-1">
																<Zap className="h-3 w-3" />
																{instance.taskCount} tasks
															</div>
														)}
													</div>
												</div>
												<div className="flex gap-2">
													<Button
														onClick={() => startHeartbeat(instance.id)}
														variant="outline"
														size="sm"
													>
														<Activity className="h-4 w-4" />
													</Button>
													<Button
														onClick={() => handleRemoveInstance(instance.id)}
														variant="outline"
														size="sm"
														className="text-red-600 hover:text-red-700"
													>
														<XCircle className="h-4 w-4" />
													</Button>
												</div>
											</div>
										</CardContent>
									</Card>
								))}
							</div>
						</ScrollArea>
					)}
				</CardContent>
			</Card>
		</TooltipProvider>
	);
}