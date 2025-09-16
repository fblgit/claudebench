#!/usr/bin/env python3
"""
Claude Event Relay for ClaudeBench
===================================

An event relay (antenna/telephone) that subscribes to ClaudeBench events and 
forwards them to Claude Code. This creates a bidirectional communication channel
between the Redis event bus and Claude Code instances.

This worker does NOT process tasks - it only relays events.

Environment Variables:
    CLAUDEBENCH_RPC_URL: Server endpoint (default: http://localhost:3000/rpc)
    REDIS_URL: Redis connection URL (default: redis://localhost:6379/0)
    CLAUDE_INSTANCE_ID: Unique instance identifier (auto-generated if not set)
    CLAUDE_SESSION_ID: Session identifier
    RELAY_ROLES: Comma-separated roles (default: "observer,relay")
    HEARTBEAT_INTERVAL: Seconds between heartbeats (default: 15)
    EVENT_CHANNELS: Comma-separated channels to subscribe (default: "task.*,hook.*,system.*")
    DEBUG: Enable debug logging (default: false)

Usage:
    python3 claude_event_relay.py
"""

import asyncio
import json
import os
import signal
import sys
import time
import traceback
from datetime import datetime
from typing import Dict, Any, Optional, List, Set
from urllib import request, error
from urllib.parse import urlparse

# Redis import - try to import, but make it optional
try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    print("Warning: redis package not installed. Install with: pip install redis", file=sys.stderr)


class ClaudeEventRelay:
    """Event relay/antenna for Claude Code instances in ClaudeBench"""
    
    def __init__(self):
        # Configuration from environment
        self.rpc_url = os.environ.get('CLAUDEBENCH_RPC_URL', 'http://localhost:3000/rpc')
        self.redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
        self.instance_id = os.environ.get(
            'CLAUDE_INSTANCE_ID', 
            f"claude-relay-{int(time.time() * 1000) % 1000000}"
        )
        self.session_id = os.environ.get('CLAUDE_SESSION_ID', f'session-{int(time.time())}')
        self.roles = os.environ.get('RELAY_ROLES', 'observer,relay').split(',')
        
        # Timing configuration
        self.heartbeat_interval = int(os.environ.get('HEARTBEAT_INTERVAL', '15'))
        
        # Event subscription configuration
        default_channels = "task.*,hook.*,system.*,instance.*"
        self.event_channels = os.environ.get('EVENT_CHANNELS', default_channels).split(',')
        
        # Features
        self.debug = os.environ.get('DEBUG', '').lower() in ('true', '1', 'yes')
        
        # State
        self.running = False
        self.registered = False
        self.request_counter = 0
        self.redis_client = None
        self.pubsub = None
        self.subscribed_channels = set()
        
        # Metrics for monitoring
        self.metrics = {
            'events_received': 0,
            'events_forwarded': 0,
            'heartbeats_sent': 0,
            'errors': 0,
            'started_at': datetime.now().isoformat()
        }
    
    def log(self, level: str, message: str, **kwargs):
        """Structured logging output"""
        timestamp = datetime.now().isoformat()
        data = {
            'timestamp': timestamp,
            'level': level,
            'instance_id': self.instance_id,
            'component': 'event_relay',
            'message': message,
            **kwargs
        }
        
        # Always output as JSON for Claude Code to parse
        output = json.dumps(data)
        print(output, file=sys.stderr if level in ('ERROR', 'WARN') else sys.stdout)
    
    def forward_event(self, channel: str, event_data: Any):
        """Forward event to Claude Code via stdout"""
        # Filter out events from our own instance to reduce noise
        if isinstance(event_data, dict):
            payload = event_data.get('payload', {})
            if isinstance(payload, dict):
                # Check if this event is from our own instance
                event_instance_id = payload.get('instanceId')
                event_session_id = payload.get('sessionId')
                
                # Skip events that originated from this relay instance
                if event_instance_id == self.instance_id:
                    if self.debug:
                        self.log('DEBUG', f"Filtered own instance event from {channel}", event_type=event_data.get('type'))
                    return
                
                # Also filter relay script events (existing logic)
                params = payload.get('params', {})
                if isinstance(params, dict):
                    command = params.get('command', '')
                    if 'claude_event_relay.py' in command:
                        # Skip forwarding events about the relay itself
                        if self.debug:
                            self.log('DEBUG', f"Filtered self-referential relay event from {channel}")
                        return
        
        # This is the critical function - it sends events to Claude Code
        event = {
            'timestamp': datetime.now().isoformat(),
            'data': event_data
        }
        
        # Output to stdout for Claude Code to receive
        print(json.dumps(event), flush=True)
        self.metrics['events_forwarded'] += 1
        
        if self.debug:
            self.log('DEBUG', f"Forwarded event from {channel}", event_type=event_data.get('type'))
    
    async def make_jsonrpc_request(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make async JSONRPC 2.0 request to ClaudeBench server"""
        self.request_counter += 1
        request_id = self.request_counter
        
        jsonrpc_request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": request_id
        }
        
        if self.debug:
            self.log('DEBUG', f"Request to {method}", request=jsonrpc_request)
        
        # Use asyncio's run_in_executor for blocking I/O
        loop = asyncio.get_event_loop()
        
        def blocking_request():
            req = request.Request(
                self.rpc_url,
                data=json.dumps(jsonrpc_request).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                method='POST'
            )
            
            try:
                with request.urlopen(req, timeout=5) as response:
                    return json.loads(response.read().decode('utf-8'))
            except error.HTTPError as e:
                error_body = e.read().decode('utf-8')
                try:
                    return json.loads(error_body)
                except json.JSONDecodeError:
                    raise Exception(f"HTTP {e.code}: {error_body}")
            except Exception as e:
                raise Exception(f"Request failed: {str(e)}")
        
        try:
            response = await loop.run_in_executor(None, blocking_request)
            
            if 'error' in response:
                raise Exception(f"JSONRPC Error: {response['error']}")
            
            return response.get('result', {})
            
        except Exception as e:
            self.metrics['errors'] += 1
            self.log('ERROR', f"Request to {method} failed: {str(e)}")
            raise
    
    async def register(self) -> bool:
        """Register relay with ClaudeBench"""
        try:
            if self.debug:
                self.log('INFO', f"Registering event relay with roles: {self.roles}")
            
            result = await self.make_jsonrpc_request('system.register', {
                'id': self.instance_id,
                'roles': self.roles
            })
            
            if result.get('registered'):
                self.registered = True
                if self.debug:
                    self.log('INFO', "Successfully registered with ClaudeBench")
                
                # Notify Claude Code that we're online
                self.forward_event('system.relay_ready', {
                    'type': 'relay_ready',
                    'instance_id': self.instance_id,
                    'roles': self.roles,
                    'subscribed_channels': list(self.event_channels)
                })
                
                return True
            else:
                self.log('ERROR', "Registration failed", result=result)
                return False
                
        except Exception as e:
            self.log('ERROR', f"Registration error: {str(e)}")
            return False
    
    async def unregister(self):
        """Unregister relay from ClaudeBench"""
        if not self.registered:
            return
            
        try:
            self.log('INFO', "Unregistering from ClaudeBench")
            
            # Notify Claude Code we're going offline
            self.forward_event('system.relay_stopping', {
                'type': 'relay_stopping',
                'instance_id': self.instance_id,
                'reason': 'shutdown'
            })
            
            result = await self.make_jsonrpc_request('system.unregister', {
                'instanceId': self.instance_id,
                'sessionId': self.session_id,
                'timestamp': int(time.time() * 1000)
            })
            
            self.registered = False
            self.log('INFO', "Successfully unregistered")
            
        except Exception as e:
            self.log('ERROR', f"Unregistration error: {str(e)}")
    
    async def heartbeat_loop(self):
        """Send periodic heartbeats to maintain registration with auto-reconnect"""
        consecutive_failures = 0
        max_consecutive_failures = 3
        
        while self.running:
            try:
                result = await self.make_jsonrpc_request('system.heartbeat', {
                    'instanceId': self.instance_id
                })
                
                self.metrics['heartbeats_sent'] += 1
                consecutive_failures = 0  # Reset failure counter on success
                
                if not result.get('alive'):
                    self.log('WARN', "Heartbeat indicated instance not alive, re-registering")
                    self.registered = False
                    if await self.register():
                        self.log('INFO', "Successfully re-registered after heartbeat failure")
                
                if self.debug and self.metrics['heartbeats_sent'] % 4 == 0:  # Log every 4th heartbeat
                    self.log('DEBUG', f"Heartbeat #{self.metrics['heartbeats_sent']}")
                
            except Exception as e:
                consecutive_failures += 1
                self.log('ERROR', f"Heartbeat error ({consecutive_failures}/{max_consecutive_failures}): {str(e)}")
                
                # After multiple consecutive failures, try to re-register
                if consecutive_failures >= max_consecutive_failures:
                    self.log('WARN', f"Too many heartbeat failures, attempting re-registration")
                    self.registered = False
                    
                    # Wait a bit before re-registration attempt
                    await asyncio.sleep(5)
                    
                    if await self.register():
                        self.log('INFO', "Successfully re-registered after connection issues")
                        consecutive_failures = 0
                    else:
                        self.log('ERROR', "Re-registration failed, will retry on next heartbeat")
            
            # Wait for next heartbeat
            await asyncio.sleep(self.heartbeat_interval)
    
    async def setup_redis_subscription(self):
        """Setup Redis pub/sub subscriptions"""
        if not REDIS_AVAILABLE:
            self.log('WARN', "Redis package not available, running without event subscription")
            return False
        
        try:
            # Parse Redis URL
            parsed = urlparse(self.redis_url)
            host = parsed.hostname or 'localhost'
            port = parsed.port or 6379
            db = int(parsed.path[1:]) if parsed.path and len(parsed.path) > 1 else 0
            
            # Create Redis client
            self.redis_client = redis.Redis(
                host=host,
                port=port,
                db=db,
                decode_responses=True
            )
            
            # Test connection
            await self.redis_client.ping()
            if self.debug:
                self.log('INFO', f"Connected to Redis at {host}:{port}/{db}")
            
            # Create pub/sub and subscribe to channels
            self.pubsub = self.redis_client.pubsub()
            
            # Subscribe to pattern channels
            for pattern in self.event_channels:
                if '*' in pattern:
                    await self.pubsub.psubscribe(pattern)
                    self.subscribed_channels.add(pattern)
                    if self.debug:
                        self.log('INFO', f"Subscribed to pattern: {pattern}")
                else:
                    await self.pubsub.subscribe(pattern)
                    self.subscribed_channels.add(pattern)
                    if self.debug:
                        self.log('INFO', f"Subscribed to channel: {pattern}")
            
            return True
            
        except Exception as e:
            self.log('ERROR', f"Redis setup failed: {str(e)}")
            return False
    
    async def event_subscription_loop(self):
        """Listen for Redis events and forward to Claude Code with auto-reconnect"""
        reconnect_delay = 1  # Start with 1 second delay
        max_reconnect_delay = 30  # Max 30 seconds between reconnections
        
        while self.running:
            try:
                if not self.pubsub:
                    self.log('INFO', "Setting up Redis subscription...")
                    if not await self.setup_redis_subscription():
                        self.log('WARN', f"Redis setup failed, retrying in {reconnect_delay}s")
                        await asyncio.sleep(reconnect_delay)
                        reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay)
                        continue
                
                if self.debug:
                    self.log('INFO', "Starting event subscription loop")
                
                # Reset reconnect delay on successful connection
                reconnect_delay = 1
                
                async for message in self.pubsub.listen():
                    if not self.running:
                        break
                        
                    if message['type'] in ('message', 'pmessage'):
                        self.metrics['events_received'] += 1
                        
                        # Parse the event data
                        channel = message.get('channel') or message.get('pattern')
                        data_str = message.get('data')
                        
                        try:
                            # Try to parse as JSON
                            event_data = json.loads(data_str) if isinstance(data_str, str) else data_str
                        except json.JSONDecodeError:
                            # If not JSON, forward as string
                            event_data = {'raw': data_str}
                        
                        # Forward to Claude Code
                        self.forward_event(channel, event_data)
                        
                    elif message['type'] == 'subscribe':
                        if self.debug:
                            self.log('DEBUG', f"Subscribed to {message['channel']}")
                    elif message['type'] == 'psubscribe':
                        if self.debug:
                            self.log('DEBUG', f"Pattern subscribed to {message['channel']}")
                        
            except asyncio.CancelledError:
                self.log('INFO', "Event subscription loop cancelled")
                break
            except Exception as e:
                self.log('ERROR', f"Event subscription error: {str(e)}")
                self.metrics['errors'] += 1
                
                # Clean up broken connections
                if self.pubsub:
                    try:
                        await self.pubsub.close()
                    except:
                        pass
                    self.pubsub = None
                
                if self.redis_client:
                    try:
                        await self.redis_client.close()
                    except:
                        pass
                    self.redis_client = None
                
                # Re-register with ClaudeBench after Redis reconnection
                if self.running:
                    self.log('INFO', f"Attempting Redis reconnection in {reconnect_delay}s")
                    await asyncio.sleep(reconnect_delay)
                    reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay)
                    
                    # Re-register after reconnection
                    self.registered = False
                    if await self.register():
                        self.log('INFO', "Successfully re-registered after Redis reconnection")
                    else:
                        self.log('WARN', "Failed to re-register after Redis reconnection")
    
    async def shutdown(self):
        """Graceful shutdown procedure"""
        self.log('INFO', "Starting graceful shutdown")
        self.running = False
        
        # Close Redis connections
        if self.pubsub:
            await self.pubsub.unsubscribe()
            await self.pubsub.close()
        
        if self.redis_client:
            await self.redis_client.close()
        
        # Unregister from system
        await self.unregister()
        
        # Log final metrics
        self.log('INFO', "Final metrics", metrics=self.metrics)
    
    async def run(self):
        """Main orchestration of relay operations"""
        if self.debug:
            self.log('INFO', f"Starting Claude Event Relay: {self.instance_id}")
        self.running = True
        
        # Register with ClaudeBench
        if not await self.register():
            self.log('ERROR', "Failed to register, exiting")
            return
        
        # Setup Redis subscriptions
        redis_available = await self.setup_redis_subscription()
        
        # Create concurrent tasks
        tasks = [
            asyncio.create_task(self.heartbeat_loop()),
        ]
        
        if redis_available:
            tasks.append(asyncio.create_task(self.event_subscription_loop()))
        else:
            # Without Redis, we can still forward HTTP-based events
            self.log('WARN', "Running in limited mode without Redis event subscription")
        
        try:
            # Run all tasks concurrently
            await asyncio.gather(*tasks)
            
        except asyncio.CancelledError:
            self.log('INFO', "Relay tasks cancelled")
        except Exception as e:
            self.log('ERROR', f"Unexpected error: {str(e)}", traceback=traceback.format_exc())
        finally:
            await self.shutdown()


async def main():
    """Main entry point with signal handling"""
    relay = ClaudeEventRelay()
    
    # Setup signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        relay.log('INFO', f"Received signal {sig}, initiating shutdown")
        relay.running = False
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        await relay.run()
    except KeyboardInterrupt:
        relay.log('INFO', "Keyboard interrupt received")
    finally:
        relay.log('INFO', "Event relay stopped")
        sys.exit(0)


if __name__ == '__main__':
    # Check Python version
    if sys.version_info < (3, 7):
        print("Error: Python 3.7 or higher required", file=sys.stderr)
        sys.exit(1)
    
    print("""
    ╔══════════════════════════════════════════════════════════╗
    ║           Claude Event Relay for ClaudeBench            ║
    ║                                                          ║
    ║  This relay forwards ClaudeBench events to Claude Code  ║
    ║  Events are output as JSON to stdout for processing     ║
    ╚══════════════════════════════════════════════════════════╝
    """, file=sys.stderr)
    
    # Run the relay
    asyncio.run(main())