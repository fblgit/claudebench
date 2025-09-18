import React, { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  User,
  Flag,
  CheckCircle,
  XCircle,
  PlayCircle,
  AlertCircle,
  Calendar,
  Hash,
  Paperclip,
  X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface Task {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  priority: number;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
  metadata?: Record<string, any>;
  assignedTo?: string;
  result?: any;
  error?: any;
  attachmentCount?: number;
}

interface TaskExpandableCardProps {
  tasks: Task[];
  onUpdate?: (taskId: string, updates: any) => void;
  onComplete?: (taskId: string) => void;
  onAssign?: (taskId: string, instanceId: string) => void;
  onDelete?: (taskId: string) => void;
  instances?: Array<{ id: string; roles: string[] }>;
}

export function TaskExpandableCards({
  tasks,
  onUpdate,
  onComplete,
  onAssign,
  onDelete,
  instances = [],
}: TaskExpandableCardProps) {
  const [active, setActive] = useState<Task | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActive(null);
      }
    }

    if (active) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  useOutsideClick(ref, () => setActive(null));

  const getPriorityColor = (priority: number) => {
    if (priority >= 80) return "text-red-500 border-red-500";
    if (priority >= 60) return "text-orange-500 border-orange-500";
    if (priority >= 40) return "text-yellow-500 border-yellow-500";
    if (priority >= 20) return "text-blue-500 border-blue-500";
    return "text-gray-500 border-gray-500";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "in_progress":
        return <PlayCircle className="h-4 w-4 text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "success";
      case "failed":
        return "destructive";
      case "in_progress":
        return "default";
      default:
        return "secondary";
    }
  };

  return (
    <>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 h-full w-full z-10"
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {active ? (
          <div className="fixed inset-0 grid place-items-center z-[100]">
            <motion.button
              key={`button-${active.id}-${id}`}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.05 } }}
              className="flex absolute top-2 right-2 lg:hidden items-center justify-center bg-white dark:bg-neutral-900 rounded-full h-8 w-8 z-50"
              onClick={() => setActive(null)}
            >
              <X className="h-4 w-4" />
            </motion.button>
            <motion.div
              layoutId={`card-${active.id}-${id}`}
              ref={ref}
              className="w-full max-w-[600px] h-full md:h-fit md:max-h-[90%] flex flex-col bg-white dark:bg-neutral-900 sm:rounded-3xl overflow-hidden"
            >
              <motion.div layoutId={`content-${active.id}-${id}`}>
                <div className="p-6 border-b dark:border-neutral-800">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-neutral-700 dark:text-neutral-200">
                        {active.text}
                      </h3>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
                        ID: {active.id}
                      </p>
                    </div>
                    <Badge variant={getStatusColor(active.status)} className="ml-4">
                      <span className="flex items-center gap-1">
                        {getStatusIcon(active.status)}
                        {active.status.replace("_", " ")}
                      </span>
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="flex items-center gap-2">
                      <Flag className={cn("h-4 w-4", getPriorityColor(active.priority))} />
                      <span className="text-sm">Priority: {active.priority}</span>
                    </div>
                    {active.assignedTo && (
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        <span className="text-sm">{active.assignedTo}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm">
                        {formatDistanceToNow(new Date(active.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    {active.attachmentCount && active.attachmentCount > 0 && (
                      <div className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4" />
                        <span className="text-sm">{active.attachmentCount} attachments</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-6 max-h-[400px] overflow-y-auto">
                  {active.metadata && Object.keys(active.metadata).length > 0 && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold mb-2 text-neutral-600 dark:text-neutral-400">
                        Metadata
                      </h4>
                      <pre className="text-xs bg-neutral-100 dark:bg-neutral-800 p-3 rounded-lg overflow-x-auto">
                        {JSON.stringify(active.metadata, null, 2)}
                      </pre>
                    </div>
                  )}

                  {active.result && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold mb-2 text-neutral-600 dark:text-neutral-400">
                        Result
                      </h4>
                      <pre className="text-xs bg-green-50 dark:bg-green-900/20 p-3 rounded-lg overflow-x-auto">
                        {JSON.stringify(active.result, null, 2)}
                      </pre>
                    </div>
                  )}

                  {active.error && (
                    <div className="mb-6">
                      <h4 className="text-sm font-semibold mb-2 text-red-600 dark:text-red-400">
                        Error
                      </h4>
                      <pre className="text-xs bg-red-50 dark:bg-red-900/20 p-3 rounded-lg overflow-x-auto">
                        {JSON.stringify(active.error, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="flex gap-2 mt-6">
                    {active.status === "pending" && onAssign && (
                      <Button
                        size="sm"
                        onClick={() => {
                          onAssign(active.id, "worker-1");
                          setActive(null);
                        }}
                      >
                        Claim Task
                      </Button>
                    )}
                    {active.status === "in_progress" && onComplete && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          onComplete(active.id);
                          setActive(null);
                        }}
                      >
                        Complete
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          onDelete(active.id);
                          setActive(null);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tasks.map((task) => (
          <motion.div
            layoutId={`card-${task.id}-${id}`}
            key={`card-${task.id}-${id}`}
            onClick={() => setActive(task)}
            className="p-4 rounded-xl cursor-pointer bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 border dark:border-neutral-800 transition-colors"
          >
            <motion.div layoutId={`content-${task.id}-${id}`}>
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200 line-clamp-2 flex-1">
                  {task.text}
                </h3>
                <Badge variant={getStatusColor(task.status)} className="ml-2 shrink-0">
                  {getStatusIcon(task.status)}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
                <div className="flex items-center gap-1">
                  <Flag className={cn("h-3 w-3", getPriorityColor(task.priority))} />
                  <span>{task.priority}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
                </div>
              </div>

              {task.assignedTo && (
                <div className="flex items-center gap-1 mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <User className="h-3 w-3" />
                  <span>{task.assignedTo}</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        ))}
      </div>
    </>
  );
}