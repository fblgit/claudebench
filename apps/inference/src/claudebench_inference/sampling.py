"""
Sampling engine using claude-code-sdk
"""

import json
import re
import logging
from typing import Dict, Any, Optional
from claude_code_sdk import query, ClaudeCodeOptions, AssistantMessage, TextBlock

logger = logging.getLogger(__name__)


class SamplingEngine:
    """
    Engine for performing LLM sampling using claude-code-sdk
    """
    
    def __init__(self, system_prompt: Optional[str] = None):
        """
        Initialize the sampling engine
        
        Args:
            system_prompt: Default system prompt to use
        """
        self.default_system_prompt = system_prompt or (
            "You are an expert assistant helping with software architecture and task coordination. "
            "You MUST respond ONLY with valid JSON matching the requested structure. "
            "Do not include any explanatory text outside the JSON."
        )
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "total_tokens": 0
        }
    
    async def sample(
        self,
        prompt: str,
        max_tokens: int = 2000,  # Note: not directly used by SDK
        temperature: float = 0.7,  # Note: not directly used by SDK
        system_prompt: Optional[str] = None
    ) -> str:
        """
        Perform sampling using claude-code-sdk
        
        Args:
            prompt: The prompt to send to Claude
            max_tokens: Maximum tokens in response (not used by SDK)
            temperature: Sampling temperature (not used by SDK)
            system_prompt: Override the default system prompt
            
        Returns:
            The response text from Claude
            
        Raises:
            Exception: If sampling fails
        """
        try:
            self.stats["total_requests"] += 1
            
            options = ClaudeCodeOptions(
                max_turns=1,
                system_prompt=system_prompt or self.default_system_prompt
            )
            
            response_text = ""
            async for message in query(prompt=prompt, options=options):
                # Check if it's an AssistantMessage and extract text
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            response_text += block.text
            
            self.stats["successful_requests"] += 1
            return response_text
            
        except Exception as e:
            self.stats["failed_requests"] += 1
            logger.error(f"Sampling failed: {str(e)}")
            raise Exception(f"Sampling failed: {str(e)}")
    
    def extract_json(self, response: str) -> Dict[str, Any]:
        """
        Extract JSON from Claude's response
        
        Args:
            response: The response text from Claude
            
        Returns:
            Parsed JSON as a dictionary
            
        Raises:
            ValueError: If no valid JSON found
        """
        # Try to find JSON in markdown code block
        json_match = re.search(r'```json\n?([\s\S]*?)\n?```', response)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Try to find raw JSON (look for outermost braces)
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
            else:
                # Fallback to entire response
                json_str = response.strip()
        
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from response: {json_str[:500]}...")
            raise ValueError(f"Invalid JSON in response: {str(e)}")
    
    async def sample_json(
        self,
        prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.7,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Sample and parse JSON response
        
        Args:
            prompt: The prompt to send to Claude
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature
            system_prompt: Override the default system prompt
            
        Returns:
            Parsed JSON response as dictionary
            
        Raises:
            Exception: If sampling or parsing fails
        """
        response = await self.sample(prompt, max_tokens, temperature, system_prompt)
        return self.extract_json(response)
    
    def get_stats(self) -> Dict[str, Any]:
        """Get sampling statistics"""
        return self.stats.copy()
    
    def reset_stats(self) -> None:
        """Reset sampling statistics"""
        self.stats = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "total_tokens": 0
        }