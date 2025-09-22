import { useState, useEffect } from "react";
import { useCreateProject } from "@/hooks/useProjects";
import { useSystemState } from "@/services/event-client";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { X, Plus, AlertCircle, Loader2, FolderPlus, User, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectCreationDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: (projectId: string, taskId: string) => void;
}

export function ProjectCreationDialog({
	isOpen,
	onClose,
	onSuccess,
}: ProjectCreationDialogProps) {
	// Form state
	const [projectDescription, setProjectDescription] = useState("");
	const [priority, setPriority] = useState(75);
	const [constraints, setConstraints] = useState<string[]>([]);
	const [requirements, setRequirements] = useState<string[]>([]);
	const [currentConstraint, setCurrentConstraint] = useState("");
	const [currentRequirement, setCurrentRequirement] = useState("");
	const [estimatedComplexity, setEstimatedComplexity] = useState("medium");
	const [selectedWorker, setSelectedWorker] = useState<string>("");

	// API hooks
	const { createProjectAsync, isLoading, error, reset } = useCreateProject();
	const { data: systemState } = useSystemState();
	
	// Extract active workers from system state
	const activeWorkers = systemState?.instances?.filter((instance: any) => 
		instance.roles?.includes("worker") || 
		instance.roles?.includes("relay") ||
		instance.id?.startsWith("worker-")
	) || [];
	
	// Set default worker when available
	useEffect(() => {
		if (activeWorkers.length > 0 && !selectedWorker) {
			setSelectedWorker(activeWorkers[0].id);
		}
	}, [activeWorkers, selectedWorker]);

	// Handlers
	const handleAddConstraint = () => {
		if (currentConstraint.trim()) {
			setConstraints([...constraints, currentConstraint.trim()]);
			setCurrentConstraint("");
		}
	};

	const handleRemoveConstraint = (index: number) => {
		setConstraints(constraints.filter((_, i) => i !== index));
	};

	const handleAddRequirement = () => {
		if (currentRequirement.trim()) {
			setRequirements([...requirements, currentRequirement.trim()]);
			setCurrentRequirement("");
		}
	};

	const handleRemoveRequirement = (index: number) => {
		setRequirements(requirements.filter((_, i) => i !== index));
	};

	const handleSubmit = async () => {
		if (!projectDescription.trim()) {
			return;
		}

		try {
			const result = await createProjectAsync({
				project: projectDescription,
				priority,
				constraints: constraints.length > 0 ? constraints : undefined,
				requirements: requirements.length > 0 ? requirements : undefined,
				metadata: {
					estimatedComplexity,
				},
			});

			// Success - call callback and close
			onSuccess?.(result.projectId, result.taskId);
			handleClose();
		} catch (err) {
			// Error is handled by the hook's toast notification
			console.error("Failed to create project:", err);
		}
	};

	const handleClose = () => {
		// Reset form
		setProjectDescription("");
		setPriority(75);
		setConstraints([]);
		setRequirements([]);
		setCurrentConstraint("");
		setCurrentRequirement("");
		setEstimatedComplexity("medium");
		reset();
		onClose();
	};

	// Priority color helper
	const getPriorityColor = (value: number) => {
		if (value >= 80) return "text-red-500";
		if (value >= 60) return "text-orange-500";
		if (value >= 40) return "text-yellow-500";
		return "text-green-500";
	};

	// Priority label helper
	const getPriorityLabel = (value: number) => {
		if (value >= 80) return "Critical";
		if (value >= 60) return "High";
		if (value >= 40) return "Medium";
		return "Low";
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleClose}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FolderPlus className="h-5 w-5" />
						Create New Project
					</DialogTitle>
					<DialogDescription>
						Create a new project that will be automatically decomposed into subtasks by specialist agents.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Project Description */}
					<div className="space-y-2">
						<Label htmlFor="project-description">
							Project Description <span className="text-red-500">*</span>
						</Label>
						<Textarea
							id="project-description"
							placeholder="Describe what you want to build..."
							value={projectDescription}
							onChange={(e) => setProjectDescription(e.target.value)}
							className="min-h-[100px]"
							disabled={isLoading}
						/>
						<p className="text-xs text-muted-foreground">
							Be specific about features, technologies, and expected outcomes.
						</p>
					</div>

					{/* Priority */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="priority">Priority</Label>
							<div className="flex items-center gap-2">
								<span className={cn("font-medium", getPriorityColor(priority))}>
									{getPriorityLabel(priority)}
								</span>
								<Badge variant="outline" className={cn("tabular-nums", getPriorityColor(priority))}>
									{priority}
								</Badge>
							</div>
						</div>
						<Slider
							id="priority"
							min={0}
							max={100}
							step={5}
							value={[priority]}
							onValueChange={([value]) => setPriority(value)}
							disabled={isLoading}
							className="py-2"
						/>
					</div>

					{/* Complexity Estimate */}
					<div className="space-y-2">
						<Label htmlFor="complexity">Estimated Complexity</Label>
						<Select value={estimatedComplexity} onValueChange={setEstimatedComplexity} disabled={isLoading}>
							<SelectTrigger id="complexity">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="simple">Simple (1-2 hours)</SelectItem>
								<SelectItem value="medium">Medium (2-4 hours)</SelectItem>
								<SelectItem value="complex">Complex (4-8 hours)</SelectItem>
								<SelectItem value="very-complex">Very Complex (8+ hours)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Constraints */}
					<div className="space-y-2">
						<Label htmlFor="constraints">
							Constraints
							<span className="text-xs text-muted-foreground ml-2">(Optional)</span>
						</Label>
						<div className="flex gap-2">
							<Input
								id="constraints"
								placeholder="Add a constraint..."
								value={currentConstraint}
								onChange={(e) => setCurrentConstraint(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleAddConstraint();
									}
								}}
								disabled={isLoading}
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={handleAddConstraint}
								disabled={!currentConstraint.trim() || isLoading}
							>
								<Plus className="h-4 w-4" />
							</Button>
						</div>
						{constraints.length > 0 && (
							<div className="flex flex-wrap gap-1 mt-2">
								{constraints.map((constraint, index) => (
									<Badge key={index} variant="secondary" className="gap-1 pr-1">
										{constraint}
										<button
											type="button"
											onClick={() => handleRemoveConstraint(index)}
											className="ml-1 hover:bg-muted rounded p-0.5"
											disabled={isLoading}
										>
											<X className="h-3 w-3" />
										</button>
									</Badge>
								))}
							</div>
						)}
						<p className="text-xs text-muted-foreground">
							Technical or business constraints that must be followed.
						</p>
					</div>

					{/* Requirements */}
					<div className="space-y-2">
						<Label htmlFor="requirements">
							Requirements
							<span className="text-xs text-muted-foreground ml-2">(Optional)</span>
						</Label>
						<div className="flex gap-2">
							<Input
								id="requirements"
								placeholder="Add a requirement..."
								value={currentRequirement}
								onChange={(e) => setCurrentRequirement(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleAddRequirement();
									}
								}}
								disabled={isLoading}
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={handleAddRequirement}
								disabled={!currentRequirement.trim() || isLoading}
							>
								<Plus className="h-4 w-4" />
							</Button>
						</div>
						{requirements.length > 0 && (
							<div className="flex flex-wrap gap-1 mt-2">
								{requirements.map((requirement, index) => (
									<Badge key={index} variant="outline" className="gap-1 pr-1">
										{requirement}
										<button
											type="button"
											onClick={() => handleRemoveRequirement(index)}
											className="ml-1 hover:bg-muted rounded p-0.5"
											disabled={isLoading}
										>
											<X className="h-3 w-3" />
										</button>
									</Badge>
								))}
							</div>
						)}
						<p className="text-xs text-muted-foreground">
							Specific features or capabilities that must be included.
						</p>
					</div>

					{/* Error Alert */}
					{error && (
						<Alert variant="destructive">
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>{error.message}</AlertDescription>
						</Alert>
					)}

					{/* Info Alert */}
					<Alert>
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>
							Once created, the project will be automatically decomposed into subtasks and assigned to specialist agents based on the requirements.
						</AlertDescription>
					</Alert>
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={handleSubmit}
						disabled={!projectDescription.trim() || isLoading}
					>
						{isLoading ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Creating Project...
							</>
						) : (
							<>
								<FolderPlus className="h-4 w-4 mr-2" />
								Create Project
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}