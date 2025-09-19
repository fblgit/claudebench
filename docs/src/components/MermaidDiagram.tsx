import React from 'react';
import Mermaid from '@theme/Mermaid';

export default function MermaidDiagram({children}: {children: string}) {
  return <Mermaid value={children} />;
}