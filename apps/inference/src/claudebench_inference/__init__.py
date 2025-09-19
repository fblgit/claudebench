"""
ClaudeBench Inference Server
============================

A FastAPI-based inference server that provides LLM sampling capabilities
for the ClaudeBench swarm coordination system using the claude-code-sdk.
"""

__version__ = "0.1.0"
__author__ = "ClaudeBench Team"

from .models import (
    DecompositionRequest,
    DecompositionResponse,
    ContextRequest,
    SpecialistContextResponse,
    ConflictRequest,
    ResolutionResponse,
    SynthesisRequest,
    IntegrationResponse,
)

from .sampling import SamplingEngine

__all__ = [
    "DecompositionRequest",
    "DecompositionResponse",
    "ContextRequest",
    "SpecialistContextResponse",
    "ConflictRequest",
    "ResolutionResponse",
    "SynthesisRequest",
    "IntegrationResponse",
    "SamplingEngine",
]