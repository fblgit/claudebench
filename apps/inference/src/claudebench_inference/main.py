"""
Main FastAPI application for ClaudeBench Inference Server
"""

import os
import time
import logging
from datetime import datetime
from typing import Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from .models import (
    DecompositionRequest, DecompositionResponse,
    ContextRequest, SpecialistContextResponse,
    ConflictRequest, ResolutionResponse,
    SynthesisRequest, IntegrationResponse,
    HealthStatus
)
from .sampling import SamplingEngine
from .prompts import PromptBuilder

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global variables
sampling_engine: SamplingEngine = None
prompt_builder: PromptBuilder = None
start_time: float = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    global sampling_engine, prompt_builder, start_time
    
    # Startup
    logger.info("Starting ClaudeBench Inference Server...")
    start_time = time.time()
    sampling_engine = SamplingEngine()
    prompt_builder = PromptBuilder()
    logger.info("Inference server ready!")
    
    yield
    
    # Shutdown
    logger.info("Shutting down ClaudeBench Inference Server...")


# Create FastAPI app
app = FastAPI(
    title="ClaudeBench Inference Server",
    description="LLM sampling service for ClaudeBench swarm coordination using claude-code-sdk",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handlers
@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": str(exc)}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"}
    )


# Health check endpoint
@app.get("/health", response_model=HealthStatus)
async def health_check():
    """Health check endpoint"""
    uptime = time.time() - start_time if start_time else 0
    stats = sampling_engine.get_stats() if sampling_engine else {}
    
    return HealthStatus(
        status="healthy",
        service="claudebench-inference",
        version="0.1.0",
        timestamp=datetime.utcnow().isoformat(),
        uptime=uptime,
        requests_processed=stats.get("total_requests", 0)
    )


# Decomposition endpoint
@app.post("/api/v1/decompose", response_model=DecompositionResponse)
async def decompose_task(request: DecompositionRequest):
    """
    Decompose a complex task into subtasks for parallel specialist execution
    """
    logger.info(f"Decomposition request for session {request.sessionId}: {request.task[:50]}...")
    
    try:
        # Build the prompt
        prompt = prompt_builder.build_decomposition_prompt(
            task=request.task,
            context=request.context
        )
        
        # Perform sampling
        result = await sampling_engine.sample_json(
            prompt=prompt,
            max_tokens=2500,
            temperature=0.7
        )
        
        # Validate and return response
        response = DecompositionResponse(**result)
        logger.info(f"Decomposed into {len(response.subtasks)} subtasks")
        return response
        
    except ValueError as e:
        logger.error(f"Decomposition validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Decomposition failed: {e}")
        raise HTTPException(status_code=500, detail=f"Decomposition failed: {str(e)}")


# Context generation endpoint
@app.post("/api/v1/context", response_model=SpecialistContextResponse)
async def generate_context(request: ContextRequest):
    """
    Generate execution context for a specialist subtask
    """
    logger.info(f"Context generation for subtask {request.subtaskId}")
    
    try:
        # Build the prompt
        prompt = prompt_builder.build_context_prompt(
            subtaskId=request.subtaskId,
            specialist=request.specialist,
            subtask=request.subtask
        )
        
        # Perform sampling
        result = await sampling_engine.sample_json(
            prompt=prompt,
            max_tokens=1500,
            temperature=0.5  # Lower temperature for more focused context
        )
        
        # Validate and return response
        response = SpecialistContextResponse(**result)
        return response
        
    except ValueError as e:
        logger.error(f"Context generation validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Context generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Context generation failed: {str(e)}")


# Conflict resolution endpoint
@app.post("/api/v1/resolve", response_model=ResolutionResponse)
async def resolve_conflict(request: ConflictRequest):
    """
    Resolve conflicts between competing specialist solutions
    """
    logger.info(f"Conflict resolution for {len(request.solutions)} solutions")
    
    try:
        # Build the prompt
        prompt = prompt_builder.build_conflict_prompt(
            solutions=request.solutions,
            context=request.context
        )
        
        # Perform sampling
        result = await sampling_engine.sample_json(
            prompt=prompt,
            max_tokens=1000,
            temperature=0.3  # Low temperature for decision-making
        )
        
        # Validate and return response
        response = ResolutionResponse(**result)
        logger.info(f"Resolved conflict: chose {response.instanceId}")
        return response
        
    except ValueError as e:
        logger.error(f"Conflict resolution validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Conflict resolution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Conflict resolution failed: {str(e)}")


# Synthesis endpoint
@app.post("/api/v1/synthesize", response_model=IntegrationResponse)
async def synthesize_progress(request: SynthesisRequest):
    """
    Synthesize completed subtasks into an integrated solution
    """
    logger.info(f"Synthesizing {len(request.completedSubtasks)} completed subtasks")
    
    try:
        # Build the prompt
        prompt = prompt_builder.build_synthesis_prompt(
            completedSubtasks=request.completedSubtasks,
            parentTask=request.parentTask
        )
        
        # Perform sampling
        result = await sampling_engine.sample_json(
            prompt=prompt,
            max_tokens=2000,
            temperature=0.6
        )
        
        # Validate and return response
        response = IntegrationResponse(**result)
        logger.info(f"Synthesis complete: status={response.status}")
        return response
        
    except ValueError as e:
        logger.error(f"Synthesis validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


# Stats endpoint
@app.get("/api/v1/stats")
async def get_stats():
    """Get inference server statistics"""
    stats = sampling_engine.get_stats() if sampling_engine else {}
    uptime = time.time() - start_time if start_time else 0
    
    return {
        "uptime": uptime,
        "sampling_stats": stats,
        "timestamp": datetime.utcnow().isoformat()
    }


def main():
    """Main entry point for the server"""
    host = os.environ.get("INFERENCE_HOST", "0.0.0.0")
    port = int(os.environ.get("INFERENCE_PORT", "8000"))
    reload = os.environ.get("INFERENCE_RELOAD", "false").lower() == "true"
    
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(
        "claudebench_inference.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info"
    )


if __name__ == "__main__":
    main()