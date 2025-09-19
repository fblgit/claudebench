import { createLazyFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SystemOverview } from "@/components/SystemOverview";
import { RedisExplorer } from "@/components/RedisExplorer";
import { DatabaseExplorer } from "@/components/DatabaseExplorer";
import { Metrics } from "@/components/Metrics";

export const Route = createLazyFileRoute("/system")({
  component: SystemComponent,
});

function SystemComponent() {
  return (
    <div className="container mx-auto px-4 py-4 h-full flex flex-col">
      <div className="mb-6 flex-shrink-0">
        <h1 className="text-2xl font-bold">System Management</h1>
        <p className="text-muted-foreground">
          Monitor system health, explore Redis and PostgreSQL databases, and analyze performance metrics
        </p>
      </div>

      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="redis">Redis Explorer</TabsTrigger>
          <TabsTrigger value="database">Database Explorer</TabsTrigger>
          <TabsTrigger value="metrics">Advanced Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 flex-1 min-h-0">
          <SystemOverview className="h-full" />
        </TabsContent>

        <TabsContent value="redis" className="mt-4 flex-1 min-h-0">
          <RedisExplorer className="h-full" />
        </TabsContent>

        <TabsContent value="database" className="mt-4 flex-1 min-h-0">
          <DatabaseExplorer className="h-full" />
        </TabsContent>

        <TabsContent value="metrics" className="mt-4 flex-1 min-h-0">
          <Metrics className="h-full" />
        </TabsContent>
      </Tabs>
    </div>
  );
}