import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/docusaurus")({
	component: DocusaurusComponent,
});

function DocusaurusComponent() {
	const [loading, setLoading] = useState(true);
	const iframeRef = useRef<HTMLIFrameElement>(null);

	useEffect(() => {
		// Handle iframe load event
		const handleLoad = () => {
			setLoading(false);
		};

		const iframe = iframeRef.current;
		if (iframe) {
			iframe.addEventListener('load', handleLoad);
			return () => iframe.removeEventListener('load', handleLoad);
		}
	}, []);

	return (
		<div className="flex flex-col h-full w-full">
			{/* Optional header if you want to add controls later */}
			<div className="flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2">
				<h1 className="text-lg font-semibold">ClaudeBench Documentation</h1>
			</div>
			
			{/* Iframe container */}
			<div className="flex-1 relative">
				{loading && (
					<div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
						<div className="flex flex-col items-center gap-2">
							<Loader2 className="h-8 w-8 animate-spin text-primary" />
							<p className="text-sm text-muted-foreground">Loading documentation...</p>
						</div>
					</div>
				)}
				<iframe
					ref={iframeRef}
					src="http://localhost:3002"
					className="w-full h-full border-0"
					title="ClaudeBench Documentation"
					sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
				/>
			</div>
		</div>
	);
}