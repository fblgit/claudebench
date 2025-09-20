import { useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Brain,
	Loader2,
	AlertCircle,
	FileText,
	Code,
	TestTube,
	BookOpen,
	Zap,
	CheckCircle,
	XCircle,
} from "lucide-react";
import { useGenerateContext } from "@/services/event-client";

interface Task {
	id: string;
	text: string;
	status: string;
	metadata?: Record<string, any>;
}

interface ContextGenerationDialogProps {
	task: Task | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (context: any) => void;
}

export function ContextGenerationDialog({
	task,
	open,
	onOpenChange,
	onSuccess,
}: ContextGenerationDialogProps) {
	const [specialist, setSpecialist] = useState<string>("general");
	const [customDescription, setCustomDescription] = useState("");
	const [isGenerating, setIsGenerating] = useState(false);
	const [generatedContext, setGeneratedContext] = useState<any>(null);
	const [error, setError] = useState<string | null>(null);
	
	const generateContextMutation = useGenerateContext();

	const handleGenerateContext = async () => {
		if (!task) return;
		
		setIsGenerating(true);
		setError(null);
		setGeneratedContext(null);
		
		try {
			// Create a subtask-like structure for context generation
			const subtaskId = `st-${task.id}-${Date.now()}`;
			const description = customDescription || task.text;
			
			const result = await generateContextMutation.mutateAsync({
				subtaskId,
				specialist,
				parentTaskId: task.id,
			});
			
			setGeneratedContext(result);
			
			if (onSuccess) {
				onSuccess(result);
			}
		} catch (error: any) {
			console.error("Failed to generate context:", error);
			setError(error?.message || "Failed to generate context. Please try again.");
		} finally {
			setIsGenerating(false);
		}
	};

	const getSpecialistIcon = (spec: string) => {
		switch (spec) {
			case "frontend":
				return <Code className="h-4 w-4" />;
			case "backend":
				return <Zap className="h-4 w-4" />;
			case "testing":
				return <TestTube className="h-4 w-4" />;
			case "docs":
				return <BookOpen className="h-4 w-4" />;
			default:
				return <Brain className="h-4 w-4" />;
		}
	};

	const renderGeneratedContext = () => {
		if (!generatedContext?.context) return null;
		
		const ctx = generatedContext.context;
		
		return (
			<Tabs defaultValue="overview" className="w-full">
				<TabsList className="grid w-full grid-cols-4">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="requirements">Requirements</TabsTrigger>
					<TabsTrigger value="constraints">Constraints</TabsTrigger>
					<TabsTrigger value="prompt">Full Prompt</TabsTrigger>
				</TabsList>
				
				<TabsContent value="overview" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle className="text-sm">Task Description</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">{ctx.description}</p>
						</CardContent>
					</Card>
					
					<Card>
						<CardHeader>
							<CardTitle className="text-sm">Scope</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm text-muted-foreground">{ctx.scope}</p>
						</CardContent>
					</Card>
					
					{ctx.successCriteria && ctx.successCriteria.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Success Criteria</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="list-disc list-inside space-y-1">
									{ctx.successCriteria.map((criteria: string, idx: number) => (
										<li key={idx} className="text-sm text-muted-foreground">
											{criteria}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					)}
				</TabsContent>
				
				<TabsContent value="requirements" className="space-y-4">
					{ctx.mandatoryReadings && ctx.mandatoryReadings.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Mandatory Readings</CardTitle>
								<CardDescription>Files and resources to review</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									{ctx.mandatoryReadings.map((reading: any, idx: number) => (
										<div key={idx} className="flex items-start gap-2">
											<FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
											<div className="flex-1">
												<p className="text-sm font-medium">{reading.title}</p>
												<p className="text-xs text-muted-foreground">{reading.path}</p>
												{reading.reason && (
													<p className="text-xs text-muted-foreground mt-1">
														{reading.reason}
													</p>
												)}
											</div>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}
					
					{ctx.relatedWork && ctx.relatedWork.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Related Work</CardTitle>
								<CardDescription>Work from other specialists</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="space-y-2">
									{ctx.relatedWork.map((work: any, idx: number) => (
										<div key={idx} className="border rounded-lg p-3">
											<div className="flex items-center justify-between mb-1">
												<Badge variant="outline">{work.instanceId}</Badge>
												<Badge variant={
													work.status === "completed" ? "default" :
													work.status === "in_progress" ? "secondary" :
													"outline"
												}>
													{work.status}
												</Badge>
											</div>
											<p className="text-sm text-muted-foreground">
												{work.summary}
											</p>
										</div>
									))}
								</div>
							</CardContent>
						</Card>
					)}
				</TabsContent>
				
				<TabsContent value="constraints" className="space-y-4">
					{ctx.architectureConstraints && ctx.architectureConstraints.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Architecture Constraints</CardTitle>
								<CardDescription>Technical requirements and limitations</CardDescription>
							</CardHeader>
							<CardContent>
								<ul className="list-disc list-inside space-y-1">
									{ctx.architectureConstraints.map((constraint: string, idx: number) => (
										<li key={idx} className="text-sm text-muted-foreground">
											{constraint}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					)}
					
					{ctx.discoveredPatterns && ctx.discoveredPatterns.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Discovered Patterns</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-wrap gap-2">
									{ctx.discoveredPatterns.map((pattern: string, idx: number) => (
										<Badge key={idx} variant="secondary">
											{pattern}
										</Badge>
									))}
								</div>
							</CardContent>
						</Card>
					)}
					
					{ctx.integrationPoints && ctx.integrationPoints.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle className="text-sm">Integration Points</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="list-disc list-inside space-y-1">
									{ctx.integrationPoints.map((point: string, idx: number) => (
										<li key={idx} className="text-sm text-muted-foreground">
											{point}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					)}
				</TabsContent>
				
				<TabsContent value="prompt">
					<Card>
						<CardHeader>
							<CardTitle className="text-sm">Generated Prompt</CardTitle>
							<CardDescription>
								Full prompt that will be provided to the specialist
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ScrollArea className="h-[300px] w-full rounded-md border p-4">
								<pre className="text-xs whitespace-pre-wrap">
									{generatedContext.prompt}
								</pre>
							</ScrollArea>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Brain className="h-5 w-5" />
						Generate Context for Task
					</DialogTitle>
					<DialogDescription>
						Generate specialized execution context to guide task implementation
					</DialogDescription>
				</DialogHeader>
				
				<div className="flex-1 overflow-y-auto">
					{!generatedContext ? (
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label>Task</Label>
								<Card className="bg-muted/50">
									<CardContent className="pt-4">
										<p className="text-sm">{task?.text}</p>
										<div className="flex gap-2 mt-2">
											<Badge variant="outline">ID: {task?.id}</Badge>
											<Badge variant="outline">Status: {task?.status}</Badge>
										</div>
									</CardContent>
								</Card>
							</div>
							
							<div className="space-y-2">
								<Label htmlFor="specialist">Select Specialist Type</Label>
								<Select value={specialist} onValueChange={setSpecialist}>
									<SelectTrigger id="specialist">
										<SelectValue placeholder="Choose a specialist..." />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="general">
											<div className="flex items-center gap-2">
												<Brain className="h-4 w-4" />
												General - Versatile implementation
											</div>
										</SelectItem>
										<SelectItem value="frontend">
											<div className="flex items-center gap-2">
												<Code className="h-4 w-4" />
												Frontend - UI/UX components
											</div>
										</SelectItem>
										<SelectItem value="backend">
											<div className="flex items-center gap-2">
												<Zap className="h-4 w-4" />
												Backend - API and services
											</div>
										</SelectItem>
										<SelectItem value="testing">
											<div className="flex items-center gap-2">
												<TestTube className="h-4 w-4" />
												Testing - Test implementation
											</div>
										</SelectItem>
										<SelectItem value="docs">
											<div className="flex items-center gap-2">
												<BookOpen className="h-4 w-4" />
												Documentation - Technical docs
											</div>
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							
							<div className="space-y-2">
								<Label htmlFor="description">
									Custom Task Description (Optional)
								</Label>
								<Textarea
									id="description"
									placeholder="Provide additional context or modify the task description..."
									value={customDescription}
									onChange={(e) => setCustomDescription(e.target.value)}
									rows={3}
								/>
							</div>
							
							{error && (
								<Alert variant="destructive">
									<AlertCircle className="h-4 w-4" />
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							)}
						</div>
					) : (
						<div className="py-4">
							<div className="flex items-center gap-2 mb-4">
								<CheckCircle className="h-5 w-5 text-green-500" />
								<span className="font-medium">Context Generated Successfully</span>
								<Badge variant="outline" className="ml-auto">
									{getSpecialistIcon(specialist)}
									<span className="ml-1">{specialist}</span>
								</Badge>
							</div>
							
							<ScrollArea className="h-[400px]">
								{renderGeneratedContext()}
							</ScrollArea>
						</div>
					)}
				</div>
				
				<DialogFooter>
					{!generatedContext ? (
						<>
							<Button
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={isGenerating}
							>
								Cancel
							</Button>
							<Button
								onClick={handleGenerateContext}
								disabled={isGenerating || !task}
							>
								{isGenerating ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										Generating Context...
									</>
								) : (
									<>
										<Brain className="h-4 w-4 mr-2" />
										Generate Context
									</>
								)}
							</Button>
						</>
					) : (
						<>
							<Button
								variant="outline"
								onClick={() => {
									setGeneratedContext(null);
									setError(null);
								}}
							>
								Generate Another
							</Button>
							<Button onClick={() => onOpenChange(false)}>
								Close
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}