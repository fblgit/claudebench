import { createFileRoute } from "@tanstack/react-router";
import { EventStream } from "@/components/EventStream";
import { TaskQueue } from "@/components/TaskQueue";
import { InstanceHealth } from "@/components/InstanceHealth";
import { Metrics } from "@/components/Metrics";
import HandlerManager from "@/components/HandlerManager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

const TITLE_TEXT = `
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗██████╗ ███████╗███╗   ██╗ ██████╗██╗  ██╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝██╔══██╗██╔════╝████╗  ██║██╔════╝██║  ██║
██║     ██║     ███████║██║   ██║██║  ██║█████╗  ██████╔╝█████╗  ██╔██╗ ██║██║     ███████║
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  ██╔══██╗██╔══╝  ██║╚██╗██║██║     ██╔══██║
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗██████╔╝███████╗██║ ╚████║╚██████╗██║  ██║
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝
`;

function HomeComponent() {
  return (
    <div className="container mx-auto px-4 py-4 h-full flex flex-col">
      <div className="mb-6 flex-shrink-0">
        <pre className="overflow-x-auto font-mono text-xs sm:text-sm text-center">{TITLE_TEXT}</pre>
        <p className="text-center text-muted-foreground mt-2">
          -=- Claude Code Bench: tasking and routing workspace -=-
        </p>
      </div>
      
      <Tabs defaultValue="events" className="w-full flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="handlers">Handlers</TabsTrigger>
        </TabsList>
        
        <TabsContent value="events" className="mt-4 flex-1 min-h-0">
          <EventStream className="h-full" />
        </TabsContent>
        
        <TabsContent value="tasks" className="mt-4 flex-1 min-h-0">
          <TaskQueue className="h-full" />
        </TabsContent>
        
        <TabsContent value="system" className="mt-4 flex-1 min-h-0">
          <InstanceHealth className="h-full" />
        </TabsContent>
        
        <TabsContent value="metrics" className="mt-4 flex-1 min-h-0">
          <Metrics className="h-full" />
        </TabsContent>
        
        <TabsContent value="handlers" className="mt-4 flex-1 min-h-0">
          <HandlerManager className="h-full" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
