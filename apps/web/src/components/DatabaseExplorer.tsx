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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
	Database, 
	Table as TableIcon, 
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
	Filter,
	Play,
	BarChart3,
	Columns,
	Grid,
	ChevronLeft,
	ChevronRightIcon
} from "lucide-react";
import { getEventClient } from "@/services/event-client";

interface DatabaseTable {
	name: string;
	schema: string;
	type: "table" | "view" | "materialized_view";
	rowCount?: number;
	sizeBytes?: number;
	columns: Array<{
		name: string;
		type: string;
		nullable: boolean;
		defaultValue?: string | null;
		isPrimaryKey: boolean;
	}>;
	indexes?: Array<{
		name: string;
		columns: string[];
		unique: boolean;
		primary: boolean;
	}>;
	constraints?: Array<{
		name: string;
		type: string;
		definition: string;
	}>;
}

interface DatabaseQueryResult {
	table: string;
	schema: string;
	columns: Array<{
		name: string;
		type: string;
	}>;
	rows: Array<Record<string, any>>;
	totalRows: number;
	hasMore: boolean;
	executionTime: number;
	queryInfo: {
		sql: string;
		parameters: any[];
	};
}

interface DatabaseExplorerProps {
	className?: string;
}

export function DatabaseExplorer({ className }: DatabaseExplorerProps) {
	// State
	const [tables, setTables] = useState<DatabaseTable[]>([]);
	const [filteredTables, setFilteredTables] = useState<DatabaseTable[]>([]);
	const [selectedTable, setSelectedTable] = useState<DatabaseTable | null>(null);
	const [queryResult, setQueryResult] = useState<DatabaseQueryResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [queryLoading, setQueryLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	
	// Filters and search
	const [schema, setSchema] = useState("public");
	const [searchTerm, setSearchTerm] = useState("");
	const [tableTypeFilter, setTableTypeFilter] = useState<string>("all");
	const [includeViews, setIncludeViews] = useState(false);
	const [includeSystemTables, setIncludeSystemTables] = useState(false);
	
	// Query parameters
	const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
	const [whereClause, setWhereClause] = useState("");
	const [orderByClause, setOrderByClause] = useState("");
	const [limit, setLimit] = useState(100);
	const [offset, setOffset] = useState(0);
	
	// UI state
	const [currentView, setCurrentView] = useState<"tables" | "query">("tables");
	
	// Refs
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	
	// Event client
	const client = getEventClient();
	
	// Load tables from database
	const loadTables = useCallback(async () => {
		setLoading(true);
		setError(null);
		
		try {
			const result = await client.invoke("system.postgres.tables", {
				schema,
				includeViews,
				includeSystemTables,
			});
			
			setTables(result.tables);
		} catch (err: any) {
			setError(`Failed to load tables: ${err.message}`);
			setTables([]);
		} finally {
			setLoading(false);
		}
	}, [client, schema, includeViews, includeSystemTables]);
	
	// Query table data
	const queryTable = useCallback(async (table: DatabaseTable, resetOffset = true) => {
		setQueryLoading(true);
		setError(null);
		
		try {
			const queryOffset = resetOffset ? 0 : offset;
			
			const result = await client.invoke("system.postgres.query", {
				table: table.name,
				schema: table.schema,
				columns: selectedColumns.length > 0 ? selectedColumns : undefined,
				where: whereClause.trim() || undefined,
				orderBy: orderByClause.trim() || undefined,
				limit,
				offset: queryOffset,
				format: "pretty",
			});
			
			setQueryResult(result);
			if (resetOffset) {
				setOffset(0);
			}
		} catch (err: any) {
			setError(`Failed to query table: ${err.message}`);
			setQueryResult(null);
		} finally {
			setQueryLoading(false);
		}
	}, [client, selectedColumns, whereClause, orderByClause, limit, offset]);
	
	// Filter tables
	useEffect(() => {
		let filtered = [...tables];
		
		// Filter by type
		if (tableTypeFilter !== "all") {
			filtered = filtered.filter(table => table.type === tableTypeFilter);
		}
		
		// Filter by search term
		if (searchTerm) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(table => 
				table.name.toLowerCase().includes(term) ||
				table.columns.some(col => col.name.toLowerCase().includes(term))
			);
		}
		
		// Sort by name
		filtered.sort((a, b) => a.name.localeCompare(b.name));
		
		setFilteredTables(filtered);
	}, [tables, tableTypeFilter, searchTerm]);
	
	// Handle table selection
	const handleTableSelect = useCallback((table: DatabaseTable) => {
		setSelectedTable(table);
		setSelectedColumns([]);
		setWhereClause("");
		setOrderByClause("");
		setOffset(0);
		setCurrentView("query");
		
		// Auto-query the table with default settings
		setTimeout(() => queryTable(table), 100);
	}, [queryTable]);
	
	// Load initial tables
	useEffect(() => {
		loadTables();
	}, [loadTables]);
	
	// Get table type icon
	const getTableTypeIcon = (type: string) => {
		switch (type) {
			case "table": return <TableIcon className="h-4 w-4" />;
			case "view": return <Eye className="h-4 w-4" />;
			case "materialized_view": return <Database className="h-4 w-4" />;
			default: return <TableIcon className="h-4 w-4" />;
		}
	};
	
	// Get table type color
	const getTableTypeColor = (type: string): string => {
		switch (type) {
			case "table": return "blue";
			case "view": return "green";
			case "materialized_view": return "purple";
			default: return "gray";
		}
	};
	
	// Format data size
	const formatSize = (size: number): string => {
		if (size < 1024) return `${size} B`;
		if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
		if (size < 1073741824) return `${(size / 1048576).toFixed(1)} MB`;
		return `${(size / 1073741824).toFixed(1)} GB`;
	};
	
	// Export query results
	const exportResults = () => {
		if (!queryResult) return;
		
		const dataStr = JSON.stringify(queryResult.rows, null, 2);
		const blob = new Blob([dataStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${queryResult.table}_data.json`;
		link.click();
		URL.revokeObjectURL(url);
	};
	
	// Handle pagination
	const nextPage = () => {
		if (selectedTable && queryResult) {
			const newOffset = offset + limit;
			setOffset(newOffset);
			queryTable(selectedTable, false);
		}
	};
	
	const prevPage = () => {
		if (selectedTable && offset > 0) {
			const newOffset = Math.max(0, offset - limit);
			setOffset(newOffset);
			queryTable(selectedTable, false);
		}
	};
	
	// Toggle column selection
	const toggleColumn = (columnName: string) => {
		setSelectedColumns(prev => 
			prev.includes(columnName)
				? prev.filter(c => c !== columnName)
				: [...prev, columnName]
		);
	};
	
	// Get unique table types for filter
	const uniqueTypes = Array.from(new Set(tables.map(t => t.type)));
	
	// Render table data
	const renderTableData = (rows: Array<Record<string, any>>, columns: Array<{name: string; type: string}>) => {
		if (rows.length === 0) {
			return (
				<div className="text-center text-muted-foreground py-8">
					No data found
				</div>
			);
		}
		
		return (
			<div className="border rounded-md">
				<Table>
					<TableHeader>
						<TableRow>
							{columns.map(column => (
								<TableHead key={column.name} className="min-w-[100px]">
									<div className="space-y-1">
										<div className="font-medium">{column.name}</div>
										<Badge variant="outline" className="text-xs">
											{column.type}
										</Badge>
									</div>
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row, index) => (
							<TableRow key={index}>
								{columns.map(column => (
									<TableCell key={column.name} className="max-w-[200px]">
										<div className="truncate" title={String(row[column.name] || "")}>
											{row[column.name] === null 
												? <span className="text-muted-foreground italic">null</span>
												: row[column.name] === ""
												? <span className="text-muted-foreground italic">empty</span>
												: typeof row[column.name] === "object"
												? JSON.stringify(row[column.name])
												: String(row[column.name])
											}
										</div>
									</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		);
	};

	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader className="pb-3 flex-shrink-0">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Database className="h-5 w-5" />
							Database Explorer
						</CardTitle>
						<CardDescription>
							Browse PostgreSQL tables and query data for troubleshooting
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant="outline">
							{filteredTables.length} tables
						</Badge>
						{selectedTable && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setCurrentView(currentView === "tables" ? "query" : "tables")}
							>
								{currentView === "tables" ? "View Data" : "Back to Tables"}
							</Button>
						)}
					</div>
				</div>
			</CardHeader>
			
			<CardContent className="flex-1 flex flex-col gap-4 pb-4">
				{error && (
					<Alert variant="destructive">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				
				<Tabs value={currentView} onValueChange={(v: any) => setCurrentView(v)}>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="tables">Tables</TabsTrigger>
						<TabsTrigger value="query" disabled={!selectedTable}>
							Data {selectedTable && `(${selectedTable.name})`}
						</TabsTrigger>
					</TabsList>
					
					<TabsContent value="tables" className="flex-1 flex flex-col min-h-0 mt-4">
						{/* Table filters */}
						<div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
							<div className="space-y-1">
								<Label htmlFor="schema">Schema</Label>
								<Input
									id="schema"
									value={schema}
									onChange={(e) => setSchema(e.target.value)}
									placeholder="public"
								/>
							</div>
							
							<div className="space-y-1">
								<Label htmlFor="search-tables">Search Tables</Label>
								<Input
									id="search-tables"
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									placeholder="Filter tables..."
								/>
							</div>
							
							<div className="space-y-1">
								<Label htmlFor="table-type-filter">Type Filter</Label>
								<Select value={tableTypeFilter} onValueChange={setTableTypeFilter}>
									<SelectTrigger>
										<SelectValue placeholder="All types" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All Types</SelectItem>
										{uniqueTypes.map(type => (
											<SelectItem key={type} value={type}>
												{type.replace("_", " ")}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							
							<div className="space-y-1 flex items-end">
								<Button 
									onClick={loadTables}
									disabled={loading}
									className="w-full"
								>
									{loading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
									Load Tables
								</Button>
							</div>
						</div>
						
						{/* Table options */}
						<div className="flex items-center gap-4 mb-4">
							<div className="flex items-center space-x-2">
								<Switch
									id="include-views"
									checked={includeViews}
									onCheckedChange={setIncludeViews}
								/>
								<Label htmlFor="include-views">Include Views</Label>
							</div>
							<div className="flex items-center space-x-2">
								<Switch
									id="include-system"
									checked={includeSystemTables}
									onCheckedChange={setIncludeSystemTables}
								/>
								<Label htmlFor="include-system">Include System Tables</Label>
							</div>
						</div>
						
						{/* Tables list */}
						<ScrollArea className="flex-1 border rounded-md" ref={scrollAreaRef}>
							<div className="p-4 space-y-2">
								{filteredTables.length === 0 && !loading ? (
									<div className="text-center text-muted-foreground py-8">
										{tables.length === 0 ? "No tables found. Try loading with different settings." : "No tables match the current filters."}
									</div>
								) : (
									filteredTables.map((table) => (
										<Card
											key={`${table.schema}.${table.name}`}
											className="cursor-pointer transition-colors hover:bg-accent"
											onClick={() => handleTableSelect(table)}
										>
											<CardContent className="p-4">
												<div className="flex items-start justify-between gap-2">
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-2 mb-2">
															<Badge
																variant={getTableTypeColor(table.type) as any}
																className="gap-1"
															>
																{getTableTypeIcon(table.type)}
																{table.type.replace("_", " ")}
															</Badge>
															{table.rowCount !== undefined && (
																<Badge variant="outline">
																	{table.rowCount.toLocaleString()} rows
																</Badge>
															)}
															{table.sizeBytes !== undefined && table.sizeBytes > 0 && (
																<Badge variant="outline" className="gap-1">
																	<HardDrive className="h-3 w-3" />
																	{formatSize(table.sizeBytes)}
																</Badge>
															)}
														</div>
														<p className="text-sm font-medium mb-1">
															{table.schema}.{table.name}
														</p>
														<div className="text-xs text-muted-foreground">
															{table.columns.length} columns
															{table.indexes && ` • ${table.indexes.length} indexes`}
															{table.constraints && ` • ${table.constraints.length} constraints`}
														</div>
													</div>
													<ChevronRight className="h-4 w-4 text-muted-foreground" />
												</div>
											</CardContent>
										</Card>
									))
								)}
								
								{loading && (
									<div className="text-center text-muted-foreground py-8">
										<RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
										Loading tables...
									</div>
								)}
							</div>
						</ScrollArea>
					</TabsContent>
					
					<TabsContent value="query" className="flex-1 flex flex-col min-h-0 mt-4">
						{selectedTable ? (
							<div className="flex-1 flex flex-col gap-4 min-h-0">
								{/* Query controls */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div className="space-y-2">
										<Label htmlFor="columns">Select Columns (leave empty for all)</Label>
										<div className="border rounded-md p-2 max-h-32 overflow-y-auto">
											<div className="space-y-1">
												{selectedTable.columns.map(column => (
													<div key={column.name} className="flex items-center space-x-2">
														<input
															type="checkbox"
															id={`col-${column.name}`}
															checked={selectedColumns.includes(column.name)}
															onChange={() => toggleColumn(column.name)}
															className="rounded"
														/>
														<label 
															htmlFor={`col-${column.name}`}
															className="text-sm font-mono flex-1 flex items-center justify-between"
														>
															<span>{column.name}</span>
															<Badge variant="outline" className="text-xs">
																{column.type}
															</Badge>
														</label>
													</div>
												))}
											</div>
										</div>
									</div>
									
									<div className="space-y-2">
										<div className="space-y-1">
											<Label htmlFor="where">WHERE Clause (optional)</Label>
											<Textarea
												id="where"
												value={whereClause}
												onChange={(e) => setWhereClause(e.target.value)}
												placeholder="id > 100 AND status = 'active'"
												className="font-mono text-sm"
												rows={3}
											/>
										</div>
										
										<div className="grid grid-cols-2 gap-2">
											<div className="space-y-1">
												<Label htmlFor="order-by">ORDER BY</Label>
												<Input
													id="order-by"
													value={orderByClause}
													onChange={(e) => setOrderByClause(e.target.value)}
													placeholder="created_at DESC"
													className="font-mono text-sm"
												/>
											</div>
											<div className="space-y-1">
												<Label htmlFor="limit">Limit</Label>
												<Input
													id="limit"
													type="number"
													value={limit}
													onChange={(e) => setLimit(parseInt(e.target.value) || 100)}
													min={1}
													max={1000}
												/>
											</div>
										</div>
									</div>
								</div>
								
								{/* Execute query button */}
								<div className="flex items-center gap-2">
									<Button 
										onClick={() => selectedTable && queryTable(selectedTable, true)}
										disabled={queryLoading}
									>
										{queryLoading ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
										Execute Query
									</Button>
									
									{queryResult && (
										<>
											<Button
												variant="outline"
												size="sm"
												onClick={exportResults}
											>
												<Download className="h-4 w-4 mr-2" />
												Export
											</Button>
											
											<div className="flex items-center gap-1 text-sm text-muted-foreground">
												<Badge variant="outline">
													{queryResult.totalRows} rows
												</Badge>
												<Badge variant="outline">
													{queryResult.executionTime}ms
												</Badge>
											</div>
										</>
									)}
								</div>
								
								{/* Query results */}
								<div className="flex-1 flex flex-col min-h-0">
									{queryLoading ? (
										<div className="text-center text-muted-foreground py-8">
											<RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
											Executing query...
										</div>
									) : queryResult ? (
										<>
											<ScrollArea className="flex-1 border rounded-md">
												<div className="p-2">
													{renderTableData(queryResult.rows, queryResult.columns)}
												</div>
											</ScrollArea>
											
											{/* Pagination */}
											<div className="flex items-center justify-between mt-2">
												<div className="text-sm text-muted-foreground">
													Showing rows {offset + 1} to {Math.min(offset + limit, offset + queryResult.totalRows)} 
													{queryResult.hasMore && " (estimated)"}
												</div>
												<div className="flex items-center gap-2">
													<Button
														variant="outline"
														size="sm"
														onClick={prevPage}
														disabled={offset === 0}
													>
														<ChevronLeft className="h-4 w-4" />
														Previous
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={nextPage}
														disabled={!queryResult.hasMore || queryResult.totalRows < limit}
													>
														Next
														<ChevronRightIcon className="h-4 w-4" />
													</Button>
												</div>
											</div>
										</>
									) : (
										<div className="text-center text-muted-foreground py-8">
											<BarChart3 className="h-8 w-8 mx-auto mb-2" />
											Execute a query to view table data
										</div>
									)}
								</div>
							</div>
						) : (
							<div className="text-center text-muted-foreground py-8">
								<TableIcon className="h-8 w-8 mx-auto mb-2" />
								Select a table to query its data
							</div>
						)}
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}