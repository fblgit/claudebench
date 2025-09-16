import { useEffect, useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getEventClient } from "@/services/event-client";
import { 
	Activity, 
	Pause, 
	Play, 
	Filter, 
	Download, 
	Trash2,
	Search,
	ChevronRight,
	Clock,
	Hash,
	Layers
} from "lucide-react";

interface EventMessage {
	id: string;
	type: string;
	timestamp: number;
	payload: any;
	metadata?: {
		source?: string;
		sessionId?: string;
		correlationId?: string;
		[key: string]: any;
	};
}

interface EventStreamProps {
	maxEvents?: number;
	autoScroll?: boolean;
	showFilters?: boolean;
}

export function EventStream({ 
	maxEvents = 100, 
	autoScroll: initialAutoScroll = true,
	showFilters = true 
}: EventStreamProps) {
	const [events, setEvents] = useState<EventMessage[]>([]);
	const [filteredEvents, setFilteredEvents] = useState<EventMessage[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [isPaused, setIsPaused] = useState(false);
	const [autoScroll, setAutoScroll] = useState(initialAutoScroll);
	const [selectedDomain, setSelectedDomain] = useState<string>("all");
	const [searchTerm, setSearchTerm] = useState("");
	const [selectedEvent, setSelectedEvent] = useState<EventMessage | null>(null);
	
	const connectionRef = useRef<{ ws: WebSocket; subscriptions: Set<string>; close: () => void } | null>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const pausedEventsRef = useRef<EventMessage[]>([]);

	// Get unique domains from events
	const domains = Array.from(new Set(events.map(e => e.type.split(".")[0])));

	// Connect to event stream
	const connect = useCallback(() => {
		const client = getEventClient();
		
		// Subscribe to all events or specific domain
		const eventTypes = selectedDomain === "all" ? undefined : [`${selectedDomain}.*`];
		
		connectionRef.current = client.subscribeToEvents(
			eventTypes,
			(message: any) => {
				try {
					// The WebSocket sends data with type: "event"
					if (message.type === "event") {
						const eventData: EventMessage = {
							id: message.data?.id || `${Date.now()}-${Math.random()}`,
							type: message.event,
							timestamp: message.timestamp || Date.now(),
							payload: message.data,
							metadata: message.data?.metadata,
						};
						
						if (isPaused) {
							pausedEventsRef.current.push(eventData);
						} else {
							setEvents(prev => {
								const newEvents = [eventData, ...prev];
								return newEvents.slice(0, maxEvents);
							});
						}
					}
				} catch (error) {
					console.error("Failed to process event:", error);
				}
			},
			(error: Error) => {
				console.error("WebSocket error:", error);
				setIsConnected(false);
			},
			() => {
				// onConnect callback
				setIsConnected(true);
			},
			() => {
				// onDisconnect callback
				setIsConnected(false);
			}
		);
	}, [selectedDomain, isPaused, maxEvents]);

	// Disconnect from event stream
	const disconnect = useCallback(() => {
		if (connectionRef.current) {
			connectionRef.current.close();
			connectionRef.current = null;
		}
		setIsConnected(false);
	}, []);

	// Toggle pause
	const togglePause = useCallback(() => {
		setIsPaused(prev => {
			if (prev && pausedEventsRef.current.length > 0) {
				// Resume and add paused events
				setEvents(current => {
					const combined = [...pausedEventsRef.current, ...current];
					pausedEventsRef.current = [];
					return combined.slice(0, maxEvents);
				});
			}
			return !prev;
		});
	}, [maxEvents]);

	// Clear events
	const clearEvents = useCallback(() => {
		setEvents([]);
		pausedEventsRef.current = [];
	}, []);

	// Export events
	const exportEvents = useCallback(() => {
		const dataStr = JSON.stringify(filteredEvents, null, 2);
		const blob = new Blob([dataStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `events-${Date.now()}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}, [filteredEvents]);

	// Filter events
	useEffect(() => {
		let filtered = [...events];
		
		// Filter by domain
		if (selectedDomain !== "all") {
			filtered = filtered.filter(e => e.type.startsWith(selectedDomain + "."));
		}
		
		// Filter by search term
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(e => 
				e.type.toLowerCase().includes(term) ||
				JSON.stringify(e.payload).toLowerCase().includes(term) ||
				e.id.toLowerCase().includes(term)
			);
		}
		
		setFilteredEvents(filtered);
	}, [events, selectedDomain, searchTerm]);

	// Auto-scroll effect
	useEffect(() => {
		if (autoScroll && scrollAreaRef.current) {
			scrollAreaRef.current.scrollTop = 0;
		}
	}, [filteredEvents, autoScroll]);

	// Connect on mount
	useEffect(() => {
		connect();
		return disconnect;
	}, [connect, disconnect]);

	// Get event color based on type
	const getEventColor = (type: string): string => {
		const domain = type.split(".")[0];
		switch (domain) {
			case "task": return "blue";
			case "system": return "green";
			case "hook": return "purple";
			case "error": return "red";
			default: return "gray";
		}
	};

	// Format timestamp
	const formatTime = (timestamp: number): string => {
		return new Date(timestamp).toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			fractionalSecondDigits: 3
		});
	};

	return (
		<Card className="flex flex-col h-full">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Activity className="h-5 w-5" />
							Event Stream
						</CardTitle>
						<CardDescription>
							Real-time event monitoring
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant={isConnected ? "default" : "secondary"}>
							{isConnected ? "Connected" : "Disconnected"}
						</Badge>
						<Badge variant="outline">
							{filteredEvents.length} / {events.length} events
						</Badge>
						{isPaused && pausedEventsRef.current.length > 0 && (
							<Badge variant="warning">
								{pausedEventsRef.current.length} paused
							</Badge>
						)}
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* Controls */}
				{showFilters && (
					<div className="flex flex-wrap gap-2">
						<Select value={selectedDomain} onValueChange={setSelectedDomain}>
							<SelectTrigger className="w-[150px]">
								<SelectValue placeholder="All domains" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All domains</SelectItem>
								{domains.map(domain => (
									<SelectItem key={domain} value={domain}>
										{domain}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						
						<div className="flex items-center gap-2 flex-1">
							<Search className="h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search events..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="flex-1 max-w-sm"
							/>
						</div>
						
						<div className="flex items-center gap-2">
							<Switch
								id="auto-scroll"
								checked={autoScroll}
								onCheckedChange={setAutoScroll}
							/>
							<Label htmlFor="auto-scroll">Auto-scroll</Label>
						</div>
						
						<Button
							variant={isPaused ? "default" : "outline"}
							size="sm"
							onClick={togglePause}
						>
							{isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
						</Button>
						
						<Button
							variant="outline"
							size="sm"
							onClick={clearEvents}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
						
						<Button
							variant="outline"
							size="sm"
							onClick={exportEvents}
						>
							<Download className="h-4 w-4" />
						</Button>
					</div>
				)}

				{/* Event list and details */}
				<div className="flex-1 flex gap-4 min-h-0">
					{/* Event list */}
					<div className="flex-1 flex flex-col">
						<ScrollArea className="flex-1 border rounded-md" ref={scrollAreaRef}>
							<div className="p-4 space-y-2">
								{filteredEvents.length === 0 ? (
									<div className="text-center text-muted-foreground py-8">
										{isConnected ? "No events yet..." : "Connecting to WebSocket..."}
									</div>
								) : (
									filteredEvents.map((event) => (
										<div
											key={event.id}
											className={`p-3 rounded-md border cursor-pointer transition-colors hover:bg-accent ${
												selectedEvent?.id === event.id ? "bg-accent" : ""
											}`}
											onClick={() => setSelectedEvent(event)}
										>
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<Badge variant="outline" className={`text-${getEventColor(event.type)}-600`}>
															{event.type}
														</Badge>
														<span className="text-xs text-muted-foreground">
															{formatTime(event.timestamp)}
														</span>
													</div>
													<div className="mt-1 text-sm text-muted-foreground truncate">
														{JSON.stringify(event.payload).substring(0, 100)}...
													</div>
												</div>
												<ChevronRight className="h-4 w-4 text-muted-foreground" />
											</div>
										</div>
									))
								)}
							</div>
						</ScrollArea>
					</div>

					{/* Event details */}
					{selectedEvent && (
						<Card className="w-[400px] flex flex-col">
							<CardHeader className="pb-3">
								<CardTitle className="text-base">Event Details</CardTitle>
								<CardDescription className="text-xs">
									{selectedEvent.id}
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 overflow-auto">
								<Tabs defaultValue="payload">
									<TabsList className="grid w-full grid-cols-2">
										<TabsTrigger value="payload">Payload</TabsTrigger>
										<TabsTrigger value="metadata">Metadata</TabsTrigger>
									</TabsList>
									<TabsContent value="payload" className="mt-4">
										<pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
											{JSON.stringify(selectedEvent.payload, null, 2)}
										</pre>
									</TabsContent>
									<TabsContent value="metadata" className="mt-4">
										<div className="space-y-2">
											<div className="flex items-center gap-2">
												<Hash className="h-3 w-3" />
												<span className="text-xs font-medium">ID:</span>
												<span className="text-xs text-muted-foreground">{selectedEvent.id}</span>
											</div>
											<div className="flex items-center gap-2">
												<Layers className="h-3 w-3" />
												<span className="text-xs font-medium">Type:</span>
												<span className="text-xs text-muted-foreground">{selectedEvent.type}</span>
											</div>
											<div className="flex items-center gap-2">
												<Clock className="h-3 w-3" />
												<span className="text-xs font-medium">Time:</span>
												<span className="text-xs text-muted-foreground">
													{new Date(selectedEvent.timestamp).toLocaleString()}
												</span>
											</div>
											{selectedEvent.metadata && (
												<div className="mt-3">
													<span className="text-xs font-medium">Additional Metadata:</span>
													<pre className="text-xs bg-muted p-2 rounded-md mt-1 overflow-auto">
														{JSON.stringify(selectedEvent.metadata, null, 2)}
													</pre>
												</div>
											)}
										</div>
									</TabsContent>
								</Tabs>
							</CardContent>
						</Card>
					)}
				</div>
			</CardContent>
		</Card>
	);
}