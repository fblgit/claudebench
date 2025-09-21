import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ProjectList } from "@/components/ProjectList";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { ProjectCreationDialog } from "@/components/ProjectCreationDialog";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/projects")({
	component: ProjectsPage,
});

function ProjectsPage() {
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [showCreateDialog, setShowCreateDialog] = useState(false);

	// Handlers
	const handleProjectSelect = (projectId?: string, taskId?: string) => {
		setSelectedProjectId(projectId || null);
		setSelectedTaskId(taskId || null);
	};

	const handleBack = () => {
		setSelectedProjectId(null);
		setSelectedTaskId(null);
	};

	const handleProjectCreated = (projectId: string, taskId: string) => {
		// Navigate to the newly created project
		setSelectedProjectId(projectId);
		setSelectedTaskId(taskId);
		setShowCreateDialog(false);
	};

	return (
		<div className="container mx-auto py-6 px-4">
			{selectedProjectId || selectedTaskId ? (
				// Project Detail View
				<ProjectDetailView
					projectId={selectedProjectId || undefined}
					taskId={selectedTaskId || undefined}
					onBack={handleBack}
				/>
			) : (
				// Projects List View
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-3xl font-bold tracking-tight">Projects</h1>
							<p className="text-muted-foreground mt-1">
								Manage and monitor your project decompositions
							</p>
						</div>
						<Button onClick={() => setShowCreateDialog(true)}>
							<Plus className="h-4 w-4 mr-2" />
							New Project
						</Button>
					</div>

					<ProjectList
						onCreateProject={() => setShowCreateDialog(true)}
					/>
				</div>
			)}

			{/* Project Creation Dialog */}
			<ProjectCreationDialog
				isOpen={showCreateDialog}
				onClose={() => setShowCreateDialog(false)}
				onSuccess={handleProjectCreated}
			/>
		</div>
	);
}