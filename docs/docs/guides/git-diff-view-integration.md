---
id: git-diff-view-integration
title: Git Diff View Integration Guide
sidebar_label: Git Diff View
description: Comprehensive guide for integrating @git-diff-view/react library into ClaudeBench
---

# Git Diff View Integration Guide

## Overview

The `@git-diff-view/react` library provides a GitHub-style diff viewing component for React applications. It offers professional diff visualization with split/unified views, syntax highlighting, and customizable themes. This guide covers how to integrate it into ClaudeBench's AttachmentViewer component to display git commit diffs with enhanced formatting.

## Installation

Install the required packages:

```bash
bun add @git-diff-view/react @git-diff-view/file @git-diff-view/core
bun add parse-diff  # For parsing git diff strings
```

## Core Concepts

### Data Structure

The DiffView component expects data in a specific structure:

```typescript
interface DiffData {
  oldFile?: {
    fileName?: string | null;
    fileLang?: string | null;  // e.g., 'typescript', 'javascript'
    content?: string | null;
  };
  newFile?: {
    fileName?: string | null;
    fileLang?: string | null;
    content?: string | null;
  };
  hunks: string[];  // Array of hunk strings from git diff
}
```

### View Modes

The library supports two primary view modes:

1. **Split View**: Shows old and new code side-by-side
2. **Unified View**: Shows changes inline with additions/deletions

## Basic Usage

### 1. Import Required Components

```typescript
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import { DiffFile, generateDiffFile } from "@git-diff-view/file";
import parseDiff from "parse-diff";

// Import styles (choose one)
import "@git-diff-view/react/styles/diff-view.css";  // With default CSS
// OR
import "@git-diff-view/react/styles/diff-view-pure.css";  // Without conflicting styles
```

### 2. Simple Implementation with Direct Data

```typescript
const GitDiffViewer: React.FC<{ diff: string }> = ({ diff }) => {
  // Parse the git diff string
  const files = parseDiff(diff);
  
  return (
    <div>
      {files.map((file, index) => (
        <DiffView
          key={index}
          data={{
            oldFile: {
              fileName: file.from,
              fileLang: detectLanguage(file.from),
              content: null  // Not needed when using hunks
            },
            newFile: {
              fileName: file.to,
              fileLang: detectLanguage(file.to),
              content: null
            },
            hunks: file.chunks.map(chunk => chunk.content)
          }}
          diffViewMode={DiffModeEnum.Split}
          diffViewTheme="light"
          diffViewHighlight={true}
          diffViewWrap={true}
          diffViewFontSize={14}
        />
      ))}
    </div>
  );
};

// Helper function to detect file language
const detectLanguage = (fileName?: string | null): string => {
  if (!fileName) return 'plaintext';
  
  const ext = fileName.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'css': 'css',
    'scss': 'scss',
    'html': 'html',
    'json': 'json',
    'md': 'markdown',
    'yaml': 'yaml',
    'yml': 'yaml'
  };
  
  return langMap[ext || ''] || 'plaintext';
};
```

### 3. Advanced Implementation with File Generation

For more control over the diff rendering, use the `generateDiffFile` function:

```typescript
import { DiffFile, generateDiffFile } from "@git-diff-view/file";

const AdvancedDiffViewer: React.FC<{ 
  oldContent: string;
  newContent: string;
  fileName: string;
}> = ({ oldContent, newContent, fileName }) => {
  const [diffFile, setDiffFile] = useState<DiffFile | null>(null);
  
  useEffect(() => {
    // Generate the diff file
    const file = generateDiffFile(
      fileName,           // Old file name
      oldContent,         // Old file content
      fileName,           // New file name
      newContent,         // New file content
      detectLanguage(fileName),  // Old file language
      detectLanguage(fileName)   // New file language
    );
    
    // Initialize and build diff lines
    file.initTheme('light');
    file.init();
    file.buildSplitDiffLines();
    file.buildUnifiedDiffLines();
    
    setDiffFile(file);
  }, [oldContent, newContent, fileName]);
  
  if (!diffFile) return <div>Loading diff...</div>;
  
  return (
    <DiffView
      diffFile={diffFile}
      diffViewMode={DiffModeEnum.Split}
      diffViewTheme="light"
      diffViewHighlight={true}
    />
  );
};
```

## Parsing Git Diff Strings

To convert a git diff string into the required format, use the `parse-diff` library:

```typescript
import parseDiff from 'parse-diff';

interface ParsedFile {
  from?: string;      // Old file name
  to?: string;        // New file name
  chunks: Array<{     // Hunks
    content: string;
    changes: Array<{
      type: 'add' | 'del' | 'normal';
      content: string;
      ln?: number;    // Line number in new file
      ln1?: number;   // Line number in old file
    }>;
  }>;
  additions: number;
  deletions: number;
}

const parseGitDiff = (diffString: string): ParsedFile[] => {
  return parseDiff(diffString);
};

// Example usage with DiffView
const GitDiffFromString: React.FC<{ diffString: string }> = ({ diffString }) => {
  const files = parseGitDiff(diffString);
  
  return (
    <>
      {files.map((file, index) => {
        // Extract hunks as strings
        const hunks = file.chunks.map(chunk => {
          return chunk.changes
            .map(change => {
              const prefix = change.type === 'add' ? '+' : 
                           change.type === 'del' ? '-' : ' ';
              return prefix + change.content;
            })
            .join('\n');
        });
        
        return (
          <DiffView
            key={index}
            data={{
              oldFile: {
                fileName: file.from || 'Unknown',
                fileLang: detectLanguage(file.from)
              },
              newFile: {
                fileName: file.to || 'Unknown',
                fileLang: detectLanguage(file.to)
              },
              hunks
            }}
            diffViewMode={DiffModeEnum.Split}
            diffViewTheme="light"
            diffViewHighlight={true}
          />
        );
      })}
    </>
  );
};
```

## Integration with AttachmentViewer

Here's how to integrate the git-diff-view library into ClaudeBench's existing AttachmentViewer component:

```typescript
// Updated renderGitCommitFormatted function
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import parseDiff from "parse-diff";
import "@git-diff-view/react/styles/diff-view-pure.css";

const renderGitCommitDiff = (diffString: string) => {
  const files = parseDiff(diffString);
  
  if (files.length === 0) {
    return (
      <div className="p-4 text-muted-foreground">
        No changes to display
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {files.map((file, index) => {
        // Build hunks array from parsed chunks
        const hunks = file.chunks.map(chunk => {
          const header = chunk.header || '';
          const changes = chunk.changes
            .map(change => {
              const prefix = change.type === 'add' ? '+' :
                           change.type === 'del' ? '-' : ' ';
              return prefix + (change.content || '');
            })
            .join('\n');
          return header + '\n' + changes;
        });
        
        return (
          <div key={index} className="border rounded-lg overflow-hidden">
            <div className="bg-muted px-4 py-2 border-b">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">
                  {file.from} → {file.to}
                </span>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600">+{file.additions}</span>
                  <span className="text-red-600">-{file.deletions}</span>
                </div>
              </div>
            </div>
            
            <DiffView
              data={{
                oldFile: {
                  fileName: file.from,
                  fileLang: detectLanguage(file.from),
                  content: null
                },
                newFile: {
                  fileName: file.to,
                  fileLang: detectLanguage(file.to),
                  content: null
                },
                hunks
              }}
              diffViewMode={DiffModeEnum.Split}
              diffViewTheme="light"
              diffViewHighlight={true}
              diffViewWrap={true}
              diffViewFontSize={13}
              diffViewAddWidget={false}
            />
          </div>
        );
      })}
    </div>
  );
};

// Replace the CodeViewer section in renderGitCommitFormatted
// Instead of:
// <CodeViewer value={data.diff} language="diff" ... />
// Use:
// {renderGitCommitDiff(data.diff)}
```

## Complete Props Reference

### DiffView Component Props

| Prop | Type | Description | Default |
|------|------|-------------|---------|
| `data` | `DiffData` | Main data structure with oldFile, newFile, and hunks | Required |
| `diffFile` | `DiffFile` | Alternative to data prop, use with generateDiffFile | - |
| `diffViewMode` | `DiffModeEnum` | Split or Unified view mode | `Split` |
| `diffViewTheme` | `'light' \| 'dark'` | Color theme | `'light'` |
| `diffViewHighlight` | `boolean` | Enable syntax highlighting | `true` |
| `diffViewWrap` | `boolean` | Enable line wrapping | `false` |
| `diffViewFontSize` | `number` | Font size in pixels | `14` |
| `diffViewAddWidget` | `boolean` | Show add comment widget | `false` |
| `onAddWidgetClick` | `function` | Handler for widget clicks | - |
| `renderWidgetLine` | `function` | Custom widget renderer | - |
| `renderExtendLine` | `function` | Custom line extension renderer | - |
| `extendData` | `object` | Additional data for lines | - |

### DiffModeEnum Values

```typescript
enum DiffModeEnum {
  Split = 1,    // Side-by-side view
  Unified = 2   // Inline view
}
```

## Advanced Features

### 1. Custom Widget Lines

Add interactive elements to diff lines:

```typescript
<DiffView
  data={diffData}
  diffViewAddWidget={true}
  onAddWidgetClick={({ side, lineNumber }) => {
    console.log(`Widget clicked on ${side} at line ${lineNumber}`);
  }}
  renderWidgetLine={({ onClose, side, lineNumber }) => (
    <div className="p-2 bg-blue-50 border-l-4 border-blue-500">
      <input 
        placeholder="Add a comment..."
        className="w-full p-1 border rounded"
      />
      <button onClick={onClose}>Close</button>
    </div>
  )}
/>
```

### 2. Extended Line Data

Attach custom data to specific lines:

```typescript
<DiffView
  data={diffData}
  extendData={{
    oldFile: {
      10: { data: 'Coverage: 85%' },
      20: { data: 'TODO: Refactor this' }
    },
    newFile: {
      15: { data: 'New feature added' }
    }
  }}
  renderExtendLine={({ data }) => (
    <div className="text-xs text-muted-foreground px-2">
      {data}
    </div>
  )}
/>
```

### 3. Performance Optimization

For large diffs, use the experimental fast diff template:

```typescript
import { setEnableFastDiffTemplate } from '@git-diff-view/core';

// Enable fast diff (experimental)
setEnableFastDiffTemplate(true);
```

## Complete Integration Example

Here's a complete example integrating all features into AttachmentViewer:

```typescript
import React, { useState, useMemo } from 'react';
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import parseDiff from "parse-diff";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SplitSquareHorizontal, AlignJustify } from "lucide-react";
import "@git-diff-view/react/styles/diff-view-pure.css";

interface GitDiffViewerProps {
  diff: string;
  stats?: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
}

export const GitDiffViewer: React.FC<GitDiffViewerProps> = ({ diff, stats }) => {
  const [viewMode, setViewMode] = useState<DiffModeEnum>(DiffModeEnum.Split);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  const parsedFiles = useMemo(() => parseDiff(diff), [diff]);
  
  if (parsedFiles.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        No changes to display
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-4">
          <ToggleGroup 
            type="single" 
            value={viewMode.toString()}
            onValueChange={(value) => value && setViewMode(parseInt(value))}
          >
            <ToggleGroupItem value={DiffModeEnum.Split.toString()}>
              <SplitSquareHorizontal className="h-4 w-4 mr-2" />
              Split
            </ToggleGroupItem>
            <ToggleGroupItem value={DiffModeEnum.Unified.toString()}>
              <AlignJustify className="h-4 w-4 mr-2" />
              Unified
            </ToggleGroupItem>
          </ToggleGroup>
          
          <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(value) => value && setTheme(value as 'light' | 'dark')}
          >
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </div>
        
        {stats && (
          <div className="flex gap-4 text-sm">
            <span className="text-green-600">+{stats.additions}</span>
            <span className="text-red-600">-{stats.deletions}</span>
            <span className="text-muted-foreground">{stats.filesChanged} files</span>
          </div>
        )}
      </div>
      
      {/* Diff Views */}
      {parsedFiles.map((file, index) => {
        const hunks = file.chunks.map(chunk => {
          const lines = chunk.changes
            .map(change => {
              const prefix = change.type === 'add' ? '+' :
                           change.type === 'del' ? '-' : ' ';
              return prefix + (change.content || '');
            });
          
          return [chunk.header || '', ...lines].join('\n');
        });
        
        return (
          <div key={index} className="border rounded-lg overflow-hidden">
            <div className="bg-muted px-4 py-2 border-b flex items-center justify-between">
              <code className="text-sm">
                {file.from === file.to ? file.to : `${file.from} → ${file.to}`}
              </code>
              <div className="flex gap-3 text-sm font-mono">
                <span className="text-green-600">+{file.additions}</span>
                <span className="text-red-600">-{file.deletions}</span>
              </div>
            </div>
            
            <DiffView
              data={{
                oldFile: {
                  fileName: file.from,
                  fileLang: detectLanguage(file.from),
                  content: null
                },
                newFile: {
                  fileName: file.to,
                  fileLang: detectLanguage(file.to),
                  content: null
                },
                hunks
              }}
              diffViewMode={viewMode}
              diffViewTheme={theme}
              diffViewHighlight={true}
              diffViewWrap={true}
              diffViewFontSize={13}
              diffViewAddWidget={false}
            />
          </div>
        );
      })}
    </div>
  );
};
```

## Troubleshooting

### Common Issues and Solutions

#### 1. TypeScript Errors with Data Structure

**Problem**: TypeScript complains about the data prop structure.

**Solution**: Ensure the data matches the exact interface:
```typescript
interface DiffData {
  oldFile?: { fileName?: string | null; fileLang?: string | null; content?: string | null };
  newFile?: { fileName?: string | null; fileLang?: string | null; content?: string | null };
  hunks: string[];
}
```

#### 2. CSS Conflicts

**Problem**: Styles conflict with existing Tailwind CSS.

**Solution**: Use the pure CSS version:
```typescript
import "@git-diff-view/react/styles/diff-view-pure.css";
```

#### 3. Empty Diff Display

**Problem**: Diff shows but appears empty.

**Solution**: Ensure hunks are properly formatted with prefixes:
- Lines starting with `+` for additions
- Lines starting with `-` for deletions  
- Lines starting with ` ` (space) for context

#### 4. Performance with Large Diffs

**Problem**: Large diffs cause performance issues.

**Solution**: 
1. Enable fast diff template (experimental)
2. Implement pagination for multiple files
3. Use virtualization for extremely large files

## Migration from CodeViewer

To migrate from the existing CodeViewer implementation:

1. **Install dependencies**:
   ```bash
   bun add @git-diff-view/react parse-diff
   ```

2. **Update imports** in AttachmentViewer.tsx:
   ```typescript
   import { DiffView, DiffModeEnum } from "@git-diff-view/react";
   import parseDiff from "parse-diff";
   import "@git-diff-view/react/styles/diff-view-pure.css";
   ```

3. **Replace the diff rendering section** (around line 305-326):
   ```typescript
   // Old code:
   // <CodeViewer value={data.diff} language="diff" ... />
   
   // New code:
   {renderGitCommitDiff(data.diff)}
   ```

4. **Add the new rendering function** before the component return:
   ```typescript
   const renderGitCommitDiff = (diffString: string) => {
     // Implementation from above
   };
   ```

## Conclusion

The @git-diff-view/react library provides a professional, GitHub-style diff viewing experience that significantly enhances the presentation of git diffs in ClaudeBench. With support for syntax highlighting, multiple view modes, and extensive customization options, it offers a superior alternative to generic code viewers for displaying version control changes.

Key benefits:
- **Professional appearance**: GitHub-style UI that developers are familiar with
- **Better readability**: Clear separation of additions/deletions with color coding
- **Flexible viewing**: Toggle between split and unified views
- **Performance**: Optimized for large diffs with optional fast rendering mode
- **Extensibility**: Support for custom widgets and line extensions

For ClaudeBench's git commit attachments, this library provides the ideal solution for presenting code changes in a clear, professional manner that enhances the developer experience.