import { createFileRoute } from "@tanstack/react-router";
import { EventStream } from "@/components/EventStream";
import { TaskQueue } from "@/components/TaskQueue";
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
    <div className="container mx-auto px-4 py-4">
      <div className="mb-6">
        <pre className="overflow-x-auto font-mono text-xs sm:text-sm text-center">{TITLE_TEXT}</pre>
        <p className="text-center text-muted-foreground mt-2">
          Redis-first event-driven architecture for Claude Code
        </p>
      </div>
      
      <Tabs defaultValue="events" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="handlers">Handlers</TabsTrigger>
        </TabsList>
        
        <TabsContent value="events" className="mt-4">
          <div className="h-[600px]">
            <EventStream />
          </div>
        </TabsContent>
        
        <TabsContent value="tasks" className="mt-4">
          <div className="h-[600px]">
            <TaskQueue />
          </div>
        </TabsContent>
        
        <TabsContent value="system" className="mt-4">
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            System Health component coming soon (T060)
          </div>
        </TabsContent>
        
        <TabsContent value="handlers" className="mt-4">
          <div className="rounded-lg border p-8 text-center text-muted-foreground">
            Handler Manager component coming soon (T062)
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
