import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
	Database, 
	Search, 
	RefreshCw, 
	Key, 
	Hash,
	List,
	FileText,
	Layers,
	Clock,
	Download,
	Trash2,
	ChevronRight,
	ChevronDown,
	Copy,
	AlertCircle,
	Info,
	HardDrive,
	Eye,
	Filter
} from "lucide-react";
import { getEventClient, useEventMutation } from "@/services/event-client";

interface RedisKey {
	name: string;
	type: string;
	ttl: number;
	size: number;
	namespace?: string;
}

interface RedisKeyData {
	key: string;
	exists: boolean;
	type: string;
	ttl: number;
	size: number;
	data: any;
	metadata?: {
		encoding?: string;
		memory?: number;
		lastModified?: string;
	};
}

interface RedisExplorerProps {
	className?: string;
}

export function RedisExplorer({ className }: RedisExplorerProps) {
	// State
	const [keys, setKeys] = useState<RedisKey[]>([]);
	const [filteredKeys, setFilteredKeys] = useState<RedisKey[]>([]);
	const [selectedKey, setSelectedKey] = useState<RedisKey | null>(null);
	const [keyData, setKeyData] = useState<RedisKeyData | null>(null);
	const [loading, setLoading] = useState(false);
	const [keyDataLoading, setKeyDataLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	
	// Filters and search
	const [searchPattern, setSearchPattern] = useState("cb:*");
	const [keyTypeFilter, setKeyTypeFilter] = useState<string>("all");
	const [searchTerm, setSearchTerm] = useState("");
	const [showExpiredKeys, setShowExpiredKeys] = useState(false);
	const [groupByNamespace, setGroupByNamespace] = useState(true);
	
	// Pagination
	const [cursor, setCursor] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const [totalKeys, setTotalKeys] = useState<number | null>(null);
	
	// Refs
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	
	// Event client
	const client = getEventClient();
	
	// Scan Redis keys
	const scanKeys = useCallback(async (pattern: string, resetKeys = true) => {
		setLoading(true);
		setError(null);
		
		try {
			const result = await client.invoke("system.redis.keys", {
				pattern,
				cursor: resetKeys ? 0 : cursor,
				count: 100,
			});
			
			const newKeys: RedisKey[] = result.keys.map((keyName: string) => ({
				name: keyName,
				type: "unknown",
				ttl: -1,
				size: 0,
				namespace: extractNamespace(keyName),
			}));
			
			if (resetKeys) {
				setKeys(newKeys);
				setCursor(0);
			} else {
				setKeys(prev => [...prev, ...newKeys]);
			}
			
			setCursor(result.cursor);
			setHasMore(result.cursor !== 0);
			setTotalKeys(result.total || null);
			
			// Get types for keys if the batch is small
			if (newKeys.length > 0 && newKeys.length <= 20) {
				await enrichKeysWithTypes(newKeys, resetKeys);
			}
		} catch (err: any) {
			setError(`Failed to scan keys: ${err.message}`);
		} finally {
			setLoading(false);
		}
	}, [client, cursor]);
	
	// Get detailed key information
	const inspectKey = useCallback(async (keyName: string) => {
		setKeyDataLoading(true);
		
		try {
			const result = await client.invoke("system.redis.get", {
				key: keyName,
				format: "pretty",
				limit: 100,
			});
			
			setKeyData(result);
		} catch (err: any) {
			setError(`Failed to inspect key: ${err.message}`);
			setKeyData(null);
		} finally {
			setKeyDataLoading(false);
		}
	}, [client]);
	
	// Enrich keys with type information
	const enrichKeysWithTypes = async (keysToEnrich: RedisKey[], resetKeys: boolean) => {
		try {
			const enrichedKeys = await Promise.all(
				keysToEnrich.map(async (key) => {
					try {
						const keyInfo = await client.invoke("system.redis.get", {
							key: key.name,
							format: "raw",
							limit: 1,
						});
						
						return {
							...key,
							type: keyInfo.type,
							ttl: keyInfo.ttl,
							size: keyInfo.size,
						};
					} catch {
						return key; // Keep original if enrichment fails
					}
				})
			);
			
			if (resetKeys) {
				setKeys(enrichedKeys);
			} else {
				setKeys(prev => {
					const existingKeys = prev.slice(0, -keysToEnrich.length);
					return [...existingKeys, ...enrichedKeys];
				});
			}
		} catch (error) {
			// Ignore enrichment errors
		}
	};
	
	// Extract namespace from key name
	const extractNamespace = (keyName: string): string => {
		const parts = keyName.split(":");
		return parts.length > 1 ? parts[0] : "root";
	};
	
	// Filter keys
	useEffect(() => {
		let filtered = [...keys];
		
		// Filter by type
		if (keyTypeFilter !== "all") {
			filtered = filtered.filter(key => key.type === keyTypeFilter);
		}
		
		// Filter by search term
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(key => 
				key.name.toLowerCase().includes(term) ||
				(key.namespace && key.namespace.toLowerCase().includes(term))
			);
		}
		
		// Filter expired keys
		if (!showExpiredKeys) {
			filtered = filtered.filter(key => key.ttl === -1 || key.ttl > 0);
		}
		
		// Sort by namespace then by name
		filtered.sort((a, b) => {
			if (groupByNamespace) {
				const nsCompare = (a.namespace || "").localeCompare(b.namespace || "");
				if (nsCompare !== 0) return nsCompare;
			}
			return a.name.localeCompare(b.name);
		});
		
		setFilteredKeys(filtered);
	}, [keys, keyTypeFilter, searchTerm, showExpiredKeys, groupByNamespace]);
	
	// Load more keys
	const loadMore = useCallback(() => {
		if (hasMore && !loading) {
			scanKeys(searchPattern, false);
		}
	}, [hasMore, loading, scanKeys, searchPattern]);
	
	// Handle key selection
	const handleKeySelect = useCallback((key: RedisKey) => {
		setSelectedKey(key);
		inspectKey(key.name);
	}, [inspectKey]);
	
	// Get key type icon
	const getTypeIcon = (type: string) => {
		switch (type) {
			case "string": return <FileText className="h-4 w-4" />;
			case "hash": return <Hash className="h-4 w-4" />;
			case "list": return <List className="h-4 w-4" />;
			case "set": return <Layers className="h-4 w-4" />;
			case "zset": return <Layers className="h-4 w-4" />;
			case "stream": return <Database className="h-4 w-4" />;
			default: return <Key className="h-4 w-4" />;
		}
	};
	
	// Get key type color
	const getTypeColor = (type: string): string => {
		switch (type) {
			case "string": return "blue";
			case "hash": return "green";
			case "list": return "purple";
			case "set": return "orange";
			case "zset": return "red";
			case "stream": return "pink";
			default: return "gray";
		}
	};
	
	// Format TTL display
	const formatTTL = (ttl: number): string => {
		if (ttl === -1) return "No expiration";
		if (ttl === -2) return "Key not found";
		if (ttl < 60) return `${ttl}s`;
		if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
		if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
		return `${Math.floor(ttl / 86400)}d`;
	};
	
	// Format data size
	const formatSize = (size: number): string => {
		if (size < 1024) return `${size} B`;
		if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
		return `${(size / 1048576).toFixed(1)} MB`;
	};
	
	// Group keys by namespace
	const groupedKeys = groupByNamespace ? filteredKeys.reduce((groups, key) => {
		const namespace = key.namespace || "root";
		if (!groups[namespace]) groups[namespace] = [];
		groups[namespace].push(key);
		return groups;
	}, {} as Record<string, RedisKey[]>) : { "all": filteredKeys };
	
	// Export key data
	const exportKeyData = () => {
		if (!keyData) return;
		
		const dataStr = JSON.stringify(keyData, null, 2);
		const blob = new Blob([dataStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `redis-key-${keyData.key.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};
	
	// Copy key name to clipboard
	const copyKeyName = (keyName: string) => {
		navigator.clipboard.writeText(keyName);
	};
	
	// Get unique key types for filter
	const uniqueTypes = Array.from(new Set(keys.map(k => k.type).filter(t => t !== "unknown")));
	
	// Render data based on type
	const renderKeyData = (data: any, type: string) => {
		if (!data) return <div className="text-muted-foreground">No data</div>;
		
		switch (type) {
			case "string":
				return (
					<div className="space-y-2">
						<div className="font-medium">String Value:</div>
						<pre className="text-sm bg-muted p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap">
							{typeof data === "string" ? data : JSON.stringify(data, null, 2)}
						</pre>
					</div>
				);
				
			case "hash":
				return (
					<div className="space-y-2">
						<div className="font-medium">Hash Fields:</div>
						<div className="space-y-1">
							{Object.entries(data).map(([field, value]) => (
								<div key={field} className="border rounded-md p-2">
									<div className="font-mono text-sm text-muted-foreground">{field}</div>
									<div className="mt-1 text-sm">
										{typeof value === "string" ? value : JSON.stringify(value)}
									</div>
								</div>
							))}
						</div>
					</div>
				);
				
			case "list":
				if (data.items) {
					return (
						<div className="space-y-2">
							<div className="font-medium">
								List Items ({data.showing}/{data.total})
								{data.hasMore && <span className="text-muted-foreground"> - showing first {data.showing}</span>}
							</div>
							<div className="space-y-1">
								{data.items.map((item: any, index: number) => (
									<div key={index} className="border rounded-md p-2">
										<div className="font-mono text-xs text-muted-foreground">[{index}]</div>
										<div className="mt-1 text-sm">
											{typeof item === "string" ? item : JSON.stringify(item)}
										</div>
									</div>
								))}
							</div>
						</div>
					);
				}
				break;
				
			case "set":
				if (data.members) {
					return (
						<div className="space-y-2">
							<div className="font-medium">
								Set Members ({data.showing}/{data.total})
								{data.hasMore && <span className="text-muted-foreground"> - showing first {data.showing}</span>}
							</div>
							<div className="flex flex-wrap gap-1">
								{data.members.map((member: any, index: number) => (
									<Badge key={index} variant="outline">
										{typeof member === "string" ? member : JSON.stringify(member)}
									</Badge>
								))}
							</div>
						</div>
					);
				}
				break;
				
			case "zset":
				if (data.items) {
					return (
						<div className="space-y-2">
							<div className="font-medium">
								Sorted Set ({data.showing}/{data.total})
								{data.hasMore && <span className="text-muted-foreground"> - showing first {data.showing}</span>}
							</div>
							<div className="space-y-1">
								{data.items.map((item: any, index: number) => (
									<div key={index} className="flex items-center justify-between border rounded-md p-2">
										<div className="text-sm">
											{typeof item.member === "string" ? item.member : JSON.stringify(item.member)}
										</div>
										<Badge variant="secondary">{item.score}</Badge>
									</div>
								))}
							</div>
						</div>
					);
				}
				break;
				
			default:
				return (
					<pre className="text-sm bg-muted p-3 rounded-md overflow-auto max-h-96">
						{JSON.stringify(data, null, 2)}
					</pre>
				);
		}
		
		return (
			<pre className="text-sm bg-muted p-3 rounded-md overflow-auto max-h-96">
				{JSON.stringify(data, null, 2)}
			</pre>
		);
	};

	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Database className="h-5 w-5" />
							Redis Explorer
						</CardTitle>
						<CardDescription>
							Browse and inspect Redis keys for troubleshooting
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						{totalKeys !== null && (
							<Badge variant="outline">
								{totalKeys.toLocaleString()} total keys
							</Badge>
						)}
						<Badge variant="outline">
							{filteredKeys.length} filtered
						</Badge>
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{/* Controls */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
					<div className="space-y-1">
						<Label htmlFor="pattern">Key Pattern</Label>
						<Input
							id="pattern"
							value={searchPattern}
							onChange={(e) => setSearchPattern(e.target.value)}
							placeholder="cb:*"
							className="font-mono"
						/>
					</div>
					
					<div className="space-y-1">
						<Label htmlFor="search">Search Keys</Label>
						<Input
							id="search"
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							placeholder="Filter keys..."
						/>
					</div>
					
					<div className="space-y-1">
						<Label htmlFor="type-filter">Type Filter</Label>
						<Select value={keyTypeFilter} onValueChange={setKeyTypeFilter}>
							<SelectTrigger>
								<SelectValue placeholder="All types" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Types</SelectItem>
								{uniqueTypes.map(type => (
									<SelectItem key={type} value={type}>
										{type}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					
					<div className="space-y-1 flex items-end">
						<Button 
							onClick={() => scanKeys(searchPattern, true)}
							disabled={loading}
							className="w-full"
						>
							{loading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
							Scan Keys
						</Button>
					</div>
				</div>
				
				{error && (
					<Alert variant="destructive">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				
				{/* Main content */}
				<div className="flex-1 flex gap-4 min-h-0">
					{/* Keys list */}
					<div className="flex-1 flex flex-col">
						<ScrollArea className="flex-1 border rounded-md" ref={scrollAreaRef}>
							<div className="p-4 space-y-2">
								{Object.entries(groupedKeys).map(([namespace, namespaceKeys]) => (
									<div key={namespace}>
										{groupByNamespace && Object.keys(groupedKeys).length > 1 && (
											<div className="mb-2">
												<Badge variant="secondary" className="mb-2">
													{namespace} ({namespaceKeys.length})
												</Badge>
											</div>
										)}
										{namespaceKeys.map((key) => (
											<Card
												key={key.name}
												className={`cursor-pointer transition-colors hover:bg-accent ${
													selectedKey?.name === key.name ? "bg-accent" : ""
												}`}
												onClick={() => handleKeySelect(key)}
											>
												<CardContent className="p-3">
													<div className="flex items-start justify-between gap-2">
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-1">
																<Badge
																	variant={getTypeColor(key.type) as any}
																	className="gap-1"
																>
																	{getTypeIcon(key.type)}
																	{key.type}
																</Badge>
																{key.ttl > 0 && (
																	<Badge variant="outline" className="gap-1">
																		<Clock className="h-3 w-3" />
																		{formatTTL(key.ttl)}
																	</Badge>
																)}
															</div>
															<p className="text-sm font-mono truncate">
																{key.name}
															</p>
															<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
																{key.size > 0 && (
																	<span className="flex items-center gap-1">
																		<HardDrive className="h-3 w-3" />
																		{formatSize(key.size)}
																	</span>
																)}
															</div>
														</div>
														<ChevronRight className="h-4 w-4 text-muted-foreground" />
													</div>
												</CardContent>
											</Card>
										))}
									</div>
								))}
								
								{filteredKeys.length === 0 && !loading && (
									<div className="text-center text-muted-foreground py-8">
										{keys.length === 0 ? "No keys found. Try scanning with a different pattern." : "No keys match the current filters."}
									</div>
								)}
								
								{hasMore && !loading && (
									<Button
										variant="outline"
										onClick={loadMore}
										className="w-full"
									>
										Load More Keys
									</Button>
								)}
								
								{loading && (
									<div className="text-center text-muted-foreground py-4">
										<RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
										Scanning keys...
									</div>
								)}
							</div>
						</ScrollArea>
					</div>
					
					{/* Key details */}
					{selectedKey && (
						<Card className="w-[500px] flex flex-col">
							<CardHeader className="pb-3">
								<div className="flex items-center justify-between">
									<CardTitle className="text-base">Key Details</CardTitle>
									<div className="flex items-center gap-1">
										<Button
											variant="outline"
											size="sm"
											onClick={() => copyKeyName(selectedKey.name)}
										>
											<Copy className="h-4 w-4" />
										</Button>
										{keyData && (
											<Button
												variant="outline"
												size="sm"
												onClick={exportKeyData}
											>
												<Download className="h-4 w-4" />
											</Button>
										)}
									</div>
								</div>
								<CardDescription className="font-mono text-xs break-all">
									{selectedKey.name}
								</CardDescription>
							</CardHeader>
							<CardContent className="flex-1 overflow-auto">
								{keyDataLoading ? (
									<div className="text-center text-muted-foreground py-8">
										<RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
										Loading key data...
									</div>
								) : keyData ? (
									<Tabs defaultValue="data">
										<TabsList className="grid w-full grid-cols-2">
											<TabsTrigger value="data">Data</TabsTrigger>
											<TabsTrigger value="info">Info</TabsTrigger>
										</TabsList>
										<TabsContent value="data" className="mt-4">
											{renderKeyData(keyData.data, keyData.type)}
										</TabsContent>
										<TabsContent value="info" className="mt-4">
											<div className="space-y-4">
												<div className="grid grid-cols-2 gap-4">
													<div>
														<Label className="text-xs">Type</Label>
														<div className="flex items-center gap-2 mt-1">
															{getTypeIcon(keyData.type)}
															<span className="text-sm">{keyData.type}</span>
														</div>
													</div>
													<div>
														<Label className="text-xs">TTL</Label>
														<p className="text-sm mt-1">{formatTTL(keyData.ttl)}</p>
													</div>
													<div>
														<Label className="text-xs">Size</Label>
														<p className="text-sm mt-1">{keyData.size} elements</p>
													</div>
													{keyData.metadata?.memory && (
														<div>
															<Label className="text-xs">Memory</Label>
															<p className="text-sm mt-1">{formatSize(keyData.metadata.memory)}</p>
														</div>
													)}
												</div>
												
												{keyData.metadata?.encoding && (
													<div>
														<Label className="text-xs">Encoding</Label>
														<p className="text-sm mt-1 font-mono">{keyData.metadata.encoding}</p>
													</div>
												)}
											</div>
										</TabsContent>
									</Tabs>
								) : (
									<div className="text-center text-muted-foreground py-8">
										<Info className="h-8 w-8 mx-auto mb-2" />
										Select a key to view its data
									</div>
								)}
							</CardContent>
						</Card>
					)}
				</div>
			</CardContent>
		</Card>
	);
}