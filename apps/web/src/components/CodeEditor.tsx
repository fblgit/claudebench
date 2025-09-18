import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount, type OnChange } from "@monaco-editor/react";
import { useTheme } from "@/hooks/use-theme";
import { Loader2, Copy, Check, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface CodeEditorProps {
	value: string;
	onChange?: (value: string | undefined) => void;
	language?: string;
	readOnly?: boolean;
	height?: string;
	className?: string;
	minimap?: boolean;
	lineNumbers?: "on" | "off" | "relative" | "interval";
	wordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
	fontSize?: number;
	tabSize?: number;
	scrollBeyondLastLine?: boolean;
	formatOnPaste?: boolean;
	formatOnType?: boolean;
	automaticLayout?: boolean;
	folding?: boolean;
	theme?: "light" | "dark" | "auto";
}

export function CodeEditor({
	value,
	onChange,
	language = "json",
	readOnly = false,
	height = "400px",
	className,
	minimap = false,
	lineNumbers = "on",
	wordWrap = "on",
	fontSize = 13,
	tabSize = 2,
	scrollBeyondLastLine = false,
	formatOnPaste = true,
	formatOnType = true,
	automaticLayout = true,
	folding = true,
	theme: propTheme = "auto",
}: CodeEditorProps) {
	const { theme: systemTheme } = useTheme();
	const editorRef = useRef<any>(null);
	const [copied, setCopied] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	// Determine the Monaco theme based on system theme
	const getMonacoTheme = () => {
		const currentTheme = propTheme === "auto" ? systemTheme : propTheme;
		return currentTheme === "dark" ? "vs-dark" : "vs";
	};

	// Handle editor mount
	const handleEditorMount: OnMount = (editor, monaco) => {
		editorRef.current = editor;

		// Define custom theme colors
		monaco.editor.defineTheme("custom-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [
				{ token: "comment", foreground: "6A737D", fontStyle: "italic" },
				{ token: "keyword", foreground: "F97583" },
				{ token: "string", foreground: "9ECBFF" },
				{ token: "number", foreground: "79B8FF" },
			],
			colors: {
				"editor.background": "#0a0a0a",
				"editor.foreground": "#e4e4e7",
				"editor.lineHighlightBackground": "#18181b",
				"editor.selectionBackground": "#3f3f46",
				"editor.inactiveSelectionBackground": "#27272a",
				"editorLineNumber.foreground": "#71717a",
				"editorLineNumber.activeForeground": "#a1a1aa",
				"editorGutter.background": "#0a0a0a",
				"editorWidget.background": "#18181b",
				"editorWidget.border": "#27272a",
				"editorSuggestWidget.background": "#18181b",
				"editorSuggestWidget.border": "#27272a",
				"editorSuggestWidget.selectedBackground": "#27272a",
			},
		});

		monaco.editor.defineTheme("custom-light", {
			base: "vs",
			inherit: true,
			rules: [
				{ token: "comment", foreground: "6A737D", fontStyle: "italic" },
				{ token: "keyword", foreground: "D73A49" },
				{ token: "string", foreground: "032F62" },
				{ token: "number", foreground: "005CC5" },
			],
			colors: {
				"editor.background": "#ffffff",
				"editor.foreground": "#24292e",
				"editor.lineHighlightBackground": "#f6f8fa",
				"editor.selectionBackground": "#b3d6fd",
				"editor.inactiveSelectionBackground": "#e1e4e8",
				"editorLineNumber.foreground": "#959da5",
				"editorLineNumber.activeForeground": "#24292e",
				"editorGutter.background": "#ffffff",
				"editorWidget.background": "#f6f8fa",
				"editorWidget.border": "#e1e4e8",
				"editorSuggestWidget.background": "#f6f8fa",
				"editorSuggestWidget.border": "#e1e4e8",
				"editorSuggestWidget.selectedBackground": "#e1e4e8",
			},
		});

		// Set custom theme
		const theme = getMonacoTheme() === "vs-dark" ? "custom-dark" : "custom-light";
		monaco.editor.setTheme(theme);

		// Format document if it's JSON
		if (language === "json" && !readOnly) {
			setTimeout(() => {
				editor.getAction("editor.action.formatDocument")?.run();
			}, 100);
		}
	};

	// Handle value changes
	const handleEditorChange: OnChange = (value) => {
		if (onChange) {
			onChange(value);
		}
	};

	// Update theme when system theme changes
	useEffect(() => {
		if (editorRef.current && (window as any).monaco) {
			const theme = getMonacoTheme() === "vs-dark" ? "custom-dark" : "custom-light";
			(window as any).monaco.editor.setTheme(theme);
		}
	}, [systemTheme, propTheme]);

	// Detect language from value if not specified
	const detectLanguage = () => {
		if (language !== "auto") return language;
		
		try {
			// Try to parse as JSON
			JSON.parse(value);
			return "json";
		} catch {
			// Check for common patterns
			if (value.includes("function") || value.includes("const") || value.includes("=>")) {
				return "javascript";
			}
			if (value.includes("interface") || value.includes(": string") || value.includes(": number")) {
				return "typescript";
			}
			if (value.includes("def ") || value.includes("import ")) {
				return "python";
			}
			if (value.includes("package main") || value.includes("func ")) {
				return "go";
			}
			if (value.includes("cargo") || value.includes("fn ") || value.includes("let mut")) {
				return "rust";
			}
			return "plaintext";
		}
	};

	const editorLanguage = detectLanguage();

	// Handle copy to clipboard
	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy:", err);
		}
	};

	// Handle fullscreen toggle
	const handleFullscreen = () => {
		setIsFullscreen(!isFullscreen);
	};

	return (
		<div className={cn(
			"border rounded-lg overflow-hidden flex flex-col",
			isFullscreen && "fixed inset-4 z-50 bg-background",
			className
		)}>
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-muted-foreground">
						{editorLanguage.toUpperCase()}
					</span>
					{value && (
						<span className="text-xs text-muted-foreground">
							{value.split('\n').length} lines
						</span>
					)}
				</div>
				<div className="flex items-center gap-1">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleCopy}
									className="h-7 px-2"
								>
									{copied ? (
										<Check className="h-3.5 w-3.5 text-green-500" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>{copied ? "Copied!" : "Copy to clipboard"}</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleFullscreen}
									className="h-7 px-2"
								>
									{isFullscreen ? (
										<Minimize2 className="h-3.5 w-3.5" />
									) : (
										<Maximize2 className="h-3.5 w-3.5" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</p>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>
			</div>
			<Editor
				height={height}
				language={editorLanguage}
				value={value}
				onChange={handleEditorChange}
				onMount={handleEditorMount}
				loading={
					<div className="flex items-center justify-center h-full">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						<span className="ml-2 text-sm text-muted-foreground">Loading editor...</span>
					</div>
				}
				options={{
					readOnly,
					minimap: {
						enabled: minimap,
					},
					lineNumbers,
					wordWrap,
					fontSize,
					tabSize,
					scrollBeyondLastLine,
					formatOnPaste,
					formatOnType,
					automaticLayout,
					folding,
					scrollbar: {
						vertical: "auto",
						horizontal: "auto",
						verticalScrollbarSize: 10,
						horizontalScrollbarSize: 10,
					},
					padding: {
						top: 10,
						bottom: 10,
					},
					renderWhitespace: "selection",
					cursorBlinking: "smooth",
					smoothScrolling: true,
					contextmenu: !readOnly,
					suggestOnTriggerCharacters: !readOnly,
					quickSuggestions: !readOnly,
					parameterHints: {
						enabled: !readOnly,
					},
					hover: {
						enabled: true,
						delay: 300,
					},
					overviewRulerLanes: 0,
					hideCursorInOverviewRuler: true,
					overviewRulerBorder: false,
					fixedOverflowWidgets: true,
				}}
			/>
		</div>
	);
}

// Export a read-only variant for viewing code
export function CodeViewer(props: Omit<CodeEditorProps, "onChange" | "readOnly">) {
	return <CodeEditor {...props} readOnly={true} />;
}