import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, X, Shield } from "lucide-react";

interface Role {
	id: string;
	label: string;
	description?: string;
}

interface RoleSelectorProps {
	roles?: Role[];
	selectedRoles: string[];
	onRolesChange: (roles: string[]) => void;
	placeholder?: string;
	className?: string;
	multiple?: boolean;
}

// Default roles if none provided
const DEFAULT_ROLES: Role[] = [
	{ id: "worker", label: "Worker", description: "Can claim and process tasks" },
	{ id: "validator", label: "Validator", description: "Can validate task results" },
	{ id: "supervisor", label: "Supervisor", description: "Can manage other instances" },
	{ id: "scheduler", label: "Scheduler", description: "Can assign tasks to instances" },
	{ id: "monitor", label: "Monitor", description: "Read-only access for monitoring" },
	{ id: "admin", label: "Admin", description: "Full system access" },
];

export function RoleSelector({
	roles = DEFAULT_ROLES,
	selectedRoles,
	onRolesChange,
	placeholder = "Select roles...",
	className,
	multiple = true,
}: RoleSelectorProps) {
	const [open, setOpen] = useState(false);

	const handleSelect = (roleId: string) => {
		if (multiple) {
			// Toggle role in selection
			const newRoles = selectedRoles.includes(roleId)
				? selectedRoles.filter((r) => r !== roleId)
				: [...selectedRoles, roleId];
			onRolesChange(newRoles);
		} else {
			// Single selection - replace
			onRolesChange([roleId]);
			setOpen(false);
		}
	};

	const handleRemove = (roleId: string, e: React.MouseEvent) => {
		e.stopPropagation();
		onRolesChange(selectedRoles.filter((r) => r !== roleId));
	};

	const getSelectedLabels = () => {
		return selectedRoles
			.map((roleId) => {
				const role = roles.find((r) => r.id === roleId);
				return role?.label || roleId;
			})
			.join(", ");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={cn("justify-between", className)}
				>
					<div className="flex items-center gap-2 flex-1 text-left">
						{selectedRoles.length === 0 ? (
							<span className="text-muted-foreground">{placeholder}</span>
						) : multiple ? (
							<div className="flex flex-wrap gap-1">
								{selectedRoles.map((roleId) => {
									const role = roles.find((r) => r.id === roleId);
									return (
										<Badge
											key={roleId}
											variant="secondary"
											className="text-xs"
											onClick={(e) => e.stopPropagation()}
										>
											<Shield className="h-3 w-3 mr-1" />
											{role?.label || roleId}
											<button
												onClick={(e) => handleRemove(roleId, e)}
												className="ml-1 hover:text-destructive"
											>
												<X className="h-3 w-3" />
											</button>
										</Badge>
									);
								})}
							</div>
						) : (
							<div className="flex items-center gap-2">
								<Shield className="h-4 w-4" />
								{getSelectedLabels()}
							</div>
						)}
					</div>
					<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[300px] p-0">
				<Command>
					<CommandInput placeholder="Search roles..." />
					<CommandList>
						<CommandEmpty>No role found.</CommandEmpty>
						<CommandGroup>
							{roles.map((role) => (
								<CommandItem
									key={role.id}
									value={role.id}
									onSelect={() => handleSelect(role.id)}
								>
									<Check
										className={cn(
											"mr-2 h-4 w-4",
											selectedRoles.includes(role.id)
												? "opacity-100"
												: "opacity-0"
										)}
									/>
									<div className="flex-1">
										<div className="flex items-center gap-2">
											<Shield className="h-4 w-4" />
											<span className="font-medium">{role.label}</span>
										</div>
										{role.description && (
											<p className="text-xs text-muted-foreground mt-1">
												{role.description}
											</p>
										)}
									</div>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}