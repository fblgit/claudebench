"""
Prompt builder using Jinja2 templates
"""

import os
from pathlib import Path
from typing import List, Dict, Any
from jinja2 import Environment, FileSystemLoader, select_autoescape

from .models import (
    DecompositionContext,
    ConflictSolution,
    ConflictContext,
    CompletedSubtask
)


class PromptBuilder:
    """
    Builder for constructing prompts using Jinja2 templates
    """
    
    def __init__(self, template_dir: str = None):
        """
        Initialize the prompt builder with Jinja2 environment
        
        Args:
            template_dir: Directory containing templates. Defaults to package templates directory.
        """
        if template_dir is None:
            # Use the templates directory in the package
            package_dir = Path(__file__).parent
            template_dir = package_dir / "templates"
        
        self.env = Environment(
            loader=FileSystemLoader(template_dir),
            autoescape=select_autoescape(disabled_extensions=('j2',)),
            trim_blocks=True,
            lstrip_blocks=True
        )
    
    def build_decomposition_prompt(self, task: str, context: DecompositionContext) -> str:
        """
        Build prompt for task decomposition
        
        Args:
            task: The task to decompose
            context: Decomposition context with specialists and constraints
            
        Returns:
            Generated prompt string
        """
        template = self.env.get_template("decomposition.j2")
        
        # Convert Pydantic models to dicts for template
        specialists_data = [s.model_dump() for s in context.specialists]
        
        return template.render(
            task=task,
            priority=context.priority,
            specialists=specialists_data,
            constraints=context.constraints or []
        )
    
    def build_context_prompt(self, subtaskId: str, specialist: str, subtask: Dict[str, Any]) -> str:
        """
        Build prompt for specialist context generation
        
        Args:
            subtaskId: ID of the subtask
            specialist: Type of specialist
            subtask: Subtask details
            
        Returns:
            Generated prompt string
        """
        template = self.env.get_template("specialist-context.j2")
        
        description = subtask.get('description', 'No description provided')
        dependencies = subtask.get('dependencies', [])
        constraints = subtask.get('context', {}).get('constraints', [])
        
        return template.render(
            subtaskId=subtaskId,
            specialist=specialist,
            description=description,
            dependencies=dependencies,
            constraints=constraints
        )
    
    def build_conflict_prompt(self, solutions: List[ConflictSolution], context: ConflictContext) -> str:
        """
        Build prompt for conflict resolution
        
        Args:
            solutions: List of competing solutions
            context: Conflict context with project details
            
        Returns:
            Generated prompt string
        """
        template = self.env.get_template("conflict-resolution.j2")
        
        # Convert Pydantic models to dicts for template
        solutions_data = [s.model_dump() for s in solutions]
        
        return template.render(
            projectType=context.projectType,
            requirements=context.requirements,
            constraints=context.constraints or [],
            solutions=solutions_data
        )
    
    def build_synthesis_prompt(self, completedSubtasks: List[CompletedSubtask], parentTask: str) -> str:
        """
        Build prompt for progress synthesis
        
        Args:
            completedSubtasks: List of completed subtasks
            parentTask: The parent task description
            
        Returns:
            Generated prompt string
        """
        template = self.env.get_template("progress-synthesis.j2")
        
        # Convert Pydantic models to dicts for template
        subtasks_data = [st.model_dump() for st in completedSubtasks]
        
        return template.render(
            parentTask=parentTask,
            completedSubtasks=subtasks_data
        )