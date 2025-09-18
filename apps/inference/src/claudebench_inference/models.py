"""
Pydantic models for ClaudeBench Inference Server
"""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, field_validator
from enum import Enum


class SpecialistType(str, Enum):
    """Enumeration of specialist types"""
    FRONTEND = "frontend"
    BACKEND = "backend"
    TESTING = "testing"
    DOCS = "docs"


class ExecutionStrategy(str, Enum):
    """Enumeration of execution strategies"""
    PARALLEL = "parallel"
    SEQUENTIAL = "sequential"
    MIXED = "mixed"


class IntegrationStatus(str, Enum):
    """Enumeration of integration statuses"""
    READY = "ready_for_integration"
    NEEDS_FIXES = "requires_fixes"
    INTEGRATED = "integrated"


# Request Models
class Specialist(BaseModel):
    """Specialist worker information"""
    id: str
    type: str
    capabilities: List[str]
    currentLoad: int = Field(ge=0)
    maxCapacity: int = Field(gt=0)
    
    @field_validator('currentLoad')
    @classmethod
    def validate_load(cls, v: int, info) -> int:
        if 'maxCapacity' in info.data and v > info.data['maxCapacity']:
            raise ValueError('currentLoad cannot exceed maxCapacity')
        return v


class DecompositionContext(BaseModel):
    """Context for task decomposition"""
    specialists: List[Specialist]
    priority: int = Field(ge=0, le=100)
    constraints: Optional[List[str]] = Field(default_factory=list)


class DecompositionRequest(BaseModel):
    """Request for task decomposition"""
    sessionId: str
    task: str = Field(min_length=1, max_length=1000)
    context: DecompositionContext


class ContextRequest(BaseModel):
    """Request for specialist context generation"""
    sessionId: str
    subtaskId: str
    specialist: str
    subtask: Dict[str, Any]


class ConflictSolution(BaseModel):
    """A proposed solution from a specialist"""
    instanceId: str
    approach: str
    reasoning: str
    code: Optional[str] = None


class ConflictContext(BaseModel):
    """Context for conflict resolution"""
    projectType: str
    requirements: List[str]
    constraints: Optional[List[str]] = Field(default_factory=list)


class ConflictRequest(BaseModel):
    """Request for conflict resolution"""
    sessionId: str
    solutions: List[ConflictSolution] = Field(min_length=2)
    context: ConflictContext


class CompletedSubtask(BaseModel):
    """A completed subtask from a specialist"""
    id: str
    specialist: str
    output: str
    artifacts: Optional[List[str]] = Field(default_factory=list)


class SynthesisRequest(BaseModel):
    """Request for progress synthesis"""
    sessionId: str
    completedSubtasks: List[CompletedSubtask] = Field(min_length=1)
    parentTask: str


# Response Models
class SubtaskContext(BaseModel):
    """Context information for a subtask"""
    files: List[str] = Field(default_factory=list)
    patterns: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)


class Subtask(BaseModel):
    """A decomposed subtask"""
    id: str
    description: str
    specialist: SpecialistType
    dependencies: List[str] = Field(default_factory=list)
    complexity: int = Field(ge=1, le=10)
    context: SubtaskContext
    estimatedMinutes: int = Field(gt=0)


class DecompositionResponse(BaseModel):
    """Response containing decomposed subtasks"""
    subtasks: List[Subtask]
    executionStrategy: ExecutionStrategy
    totalComplexity: int = Field(ge=0)
    reasoning: str


class MandatoryReading(BaseModel):
    """A required reading for context"""
    title: str
    path: str


class RelatedWork(BaseModel):
    """Related work from other specialists"""
    instanceId: str
    status: str
    summary: str


class SpecialistContextResponse(BaseModel):
    """Context for specialist execution"""
    taskId: str
    description: str
    scope: str
    mandatoryReadings: List[MandatoryReading] = Field(default_factory=list)
    architectureConstraints: List[str] = Field(default_factory=list)
    relatedWork: List[RelatedWork] = Field(default_factory=list)
    successCriteria: List[str] = Field(default_factory=list)


class ResolutionResponse(BaseModel):
    """Conflict resolution decision"""
    chosenSolution: str
    instanceId: str
    justification: str
    recommendations: List[str] = Field(default_factory=list)
    modifications: Optional[List[str]] = Field(default_factory=list)


class IntegrationResponse(BaseModel):
    """Progress synthesis and integration result"""
    status: IntegrationStatus
    integrationSteps: List[str] = Field(default_factory=list)
    potentialIssues: List[str] = Field(default_factory=list)
    nextActions: List[str] = Field(default_factory=list)
    mergedCode: Optional[str] = None


# Health Check Models
class HealthStatus(BaseModel):
    """Health check response"""
    status: str
    service: str
    version: str
    timestamp: str
    uptime: float
    requests_processed: int = 0