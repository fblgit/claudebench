import { createFileRoute } from "@tanstack/react-router";
import { TaskKanban } from "@/components/TaskKanban";

export const Route = createFileRoute("/tasks")({
	component: TasksComponent,
});

function TasksComponent() {
	return (
		<div className="w-full px-4 py-4 h-full flex flex-col">
			<div className="mb-4 flex-shrink-0">
				<h1 className="text-2xl font-bold">Task Management</h1>
				<p className="text-muted-foreground">
					Drag and drop tasks between columns to update their status
				</p>
			</div>
			<TaskKanban className="flex-1 min-h-0" />
		</div>
	);
}