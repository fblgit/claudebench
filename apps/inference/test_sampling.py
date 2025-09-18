#!/usr/bin/env python3
"""
Test script for the sampling engine
"""

import asyncio
import sys
import os
sys.path.insert(0, 'src')

from claudebench_inference.sampling import SamplingEngine

async def test_sampling():
    """Test the sampling engine directly"""
    engine = SamplingEngine()
    
    # Test prompt
    prompt = """Respond with a simple JSON object that has this exact structure:
{
  "message": "Hello from Claude",
  "status": "success"
}"""
    
    try:
        print("Testing sampling engine...")
        response = await engine.sample(
            prompt=prompt,
            system_prompt="You are a helpful assistant that always responds with valid JSON."
        )
        print(f"Response received: {response}")
        
        # Try to extract JSON
        json_result = engine.extract_json(response)
        print(f"Parsed JSON: {json_result}")
        
        print("\n✅ Sampling engine test successful!")
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_sampling())