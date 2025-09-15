import { createLazyFileRoute } from "@tanstack/react-router";

export const Route = createLazyFileRoute("/system")({
  component: SystemComponent,
});

function SystemComponent() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">System Health & Metrics</h1>
        <p className="text-muted-foreground">
          Monitor ClaudeBench system health, performance metrics, and infrastructure status
        </p>
      </div>
      
      <div className="grid gap-6">
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-2">Redis Status</h2>
          <div className="text-center text-muted-foreground">
            Redis connection and metrics will be displayed here
          </div>
        </div>
        
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-2">PostgreSQL Status</h2>
          <div className="text-center text-muted-foreground">
            Database connection and metrics will be displayed here
          </div>
        </div>
        
        <div className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-2">Performance Metrics</h2>
          <div className="text-center text-muted-foreground">
            System performance charts will be displayed here
          </div>
        </div>
      </div>
    </div>
  );
}