#!/usr/bin/env python3
"""
Rocky Voice Debugger — Automated Interaction & Performance Tester.
Simulates a user via Socket.io, measures TTS latency, and validates audio stream.
"""
import socketio
import time
import sys
import os
import json
import subprocess
from datetime import datetime

# Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
RESET = "\033[0m"

import asyncio

class RockyTester:
    def __init__(self, url="http://127.0.0.1:8000"):
        self.sio = socketio.AsyncClient(logger=False, engineio_logger=False)
        self.url = url
        self.start_time = 0
        self.first_chunk_time = 0
        self.last_chunk_time = 0
        self.chunk_count = 0
        self.total_bytes = 0
        self.response_text = ""
        self.is_done = False

        # Register events
        self.sio.on('connect', self.on_connect)
        self.sio.on('chat_token', self.on_token)
        self.sio.on('chat_response', self.on_response)
        self.sio.on('tts_chunk', self.on_audio_chunk)
        self.sio.on('disconnect', self.on_disconnect)

    async def on_connect(self):
        print(f"{GREEN}[CONNECTED]{RESET} to Rocky Backend at {self.url}")

    async def on_token(self, token):
        print(token, end="", flush=True)

    async def on_response(self, data):
        self.response_text = data.get('text', '')
        print(f"\n{BLUE}[ROCKY FULL]:{RESET} {self.response_text}")
        self.is_done = True

    async def on_audio_chunk(self, data):
        if self.chunk_count == 0:
            self.first_chunk_time = time.time()
            latency = (self.first_chunk_time - self.start_time) * 1000
            print(f"\n{MAGENTA}[LATENCY]{RESET} Time to First Audio Chunk: {latency:.2f}ms")
        
        self.chunk_count += 1
        if isinstance(data, dict) and 'chunk' in data:
            self.total_bytes += len(data['chunk'])
        else:
            self.total_bytes += len(data)
        self.last_chunk_time = time.time()

    async def on_disconnect(self):
        print(f"{YELLOW}[DISCONNECTED]{RESET} from server")

    async def run_test(self, message):
        print(f"\n{BLUE}==> Starting Automated Interaction Test{RESET}")
        print(f"{YELLOW}User:{RESET} {message}")
        
        try:
            await self.sio.connect(self.url, wait_timeout=10)
            self.start_time = time.time()
            await self.sio.emit('chat_request', {"content": message})
            
            # Wait for response (timeout 60s)
            timeout = 60
            wait_start = time.time()
            while not self.is_done and (time.time() - wait_start < timeout):
                await asyncio.sleep(0.1)
            
            if not self.is_done:
                print(f"\n{RED}Timed out waiting for response!{RESET}")

            self.report()
            await self.sio.disconnect()
        except Exception as e:
            print(f"\n{RED}[ERROR]{RESET} Test failed: {e}")

    def report(self):
        print("\n" + "="*50)
        print(f"{GREEN}DEBUG REPORT - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
        print("="*50)
        
        if self.chunk_count == 0:
            print(f"{RED}FAILED:{RESET} No audio received.")
            return

        ttfb = (self.first_chunk_time - self.start_time) * 1000
        total_time = (self.last_chunk_time - self.start_time) * 1000
        
        print(f"• Message Length:    {len(self.response_text)} chars")
        print(f"• Audio Chunks:      {self.chunk_count}")
        print(f"• Total Audio Size:  {self.total_bytes / 1024:.2f} KB")
        print(f"• Latency (TTFB):    {ttfb:.2f} ms")
        print(f"• Total Time:        {total_time:.2f} ms")
        
        print("\n" + "-"*20)
        if ttfb < 1000:
            print(f"Performance: {GREEN}EXCELLENT{RESET}")
        elif ttfb < 3000:
            print(f"Performance: {YELLOW}ACCEPTABLE{RESET}")
        else:
            print(f"Performance: {RED}SLOW{RESET}")
        print("-"*20)

if __name__ == "__main__":
    import asyncio
    tester = RockyTester()
    test_msg = "Hello Rocky, introduce yourself in one short sentence."
    if len(sys.argv) > 1:
        test_msg = " ".join(sys.argv[1:])
    
    asyncio.run(tester.run_test(test_msg))
