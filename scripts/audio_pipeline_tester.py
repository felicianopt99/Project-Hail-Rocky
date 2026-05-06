#!/usr/bin/env python3
import asyncio
import time
import argparse
import sys
import os
import wave
import numpy as np
import socketio
from datetime import datetime

PIPELINE_STAGES = [
    "backend_connected",
    "manual_activation_observed",
    "audio_chunk_relayed",
    "manual_stop_received",
    "end_of_turn_sent",
    "bridge_started",
    "voice_engine_audio_received",
    "end_of_turn_received",
    "stt_started"
]

class AudioPipelineTester:
    def __init__(self, backend_url, verbose=False):
        self.backend_url = backend_url
        self.verbose = verbose
        self.sio = socketio.AsyncClient()
        self.stages = {s: False for s in PIPELINE_STAGES}
        self.error = None
        self.events_received = []
        
        # States
        self.connected = False
        self.transcript_received = False
        self.chat_received = False
        self.voice_error_received = False
        
        self.start_time = None
        self.chunks_sent = 0
        self.total_bytes_sent = 0
        self.last_transcript = ""

    def log(self, msg):
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{timestamp}] {msg}")

    def debug(self, msg):
        if self.verbose:
            self.log(f"DEBUG: {msg}")

    async def connect(self):
        try:
            self.log(f"Connecting to {self.backend_url}...")
            await self.sio.connect(self.backend_url)
            self.connected = True
            self.stages["backend_connected"] = True
            self.log(f"Connected. Session ID: {self.sio.sid}")
            
            # Register handlers
            @self.sio.on("voice_debug")
            async def on_voice_debug(data):
                stage = data.get("stage")
                if stage in self.stages:
                    self.stages[stage] = True
                self.log(f"DEBUG STAGE: {stage} | {data}")

            @self.sio.on("voice_error")
            async def on_voice_error(data):
                code = data.get("code", "UNKNOWN_ERROR")
                msg = data.get("message", "No message")
                self.log(f"!!! VOICE ERROR: {code} !!!")
                self.log(f"Message: {msg}")
                self.error = code
                self.voice_error_received = True

            @self.sio.on("*")
            async def catch_all(event, data):
                self.events_received.append((time.time(), event, data))
                if event not in ["voice_debug", "voice_error"]:
                    self.log(f"EVENT: {event} | Data: {str(data)[:100]}{'...' if len(str(data)) > 100 else ''}")
                
                if event == "transcript_result":
                    self.transcript_received = True
                    self.last_transcript = data
                elif event in ["chat_token", "chat_response"]:
                    self.chat_received = True

        except Exception as e:
            self.log(f"Connection failed: {e}")
            return False
        return True

    def load_wav(self, file_path):
        self.log(f"Loading WAV: {file_path}")
        with wave.open(file_path, 'rb') as wf:
            params = wf.getparams()
            if params.nchannels != 1 or params.sampwidth != 2 or params.framerate != 16000:
                self.log(f"WARNING: WAV format mismatch. Expected 16kHz Mono S16LE. Got {params.framerate}Hz {params.nchannels}ch.")
            
            frames = wf.readframes(params.nframes)
            return frames

    def generate_pcm_audio(self, duration=1.0, sample_rate=16000):
        self.log(f"Generating {duration}s of 440Hz sine wave (Transport Test Only)...")
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        tone = np.sin(440 * t * 2 * np.pi)
        audio_int16 = (tone * 32767).astype(np.int16)
        return audio_int16.tobytes()

    async def run_test(self, wav_path=None, audio_duration=2.0):
        if not await self.connect():
            return False

        self.start_time = time.time()
        
        # 1. Manual Activation
        self.log("Emitting 'manual_activation'...")
        await self.sio.emit("manual_activation")
        
        # Wait for acknowledgement via debug stage or timeout
        wait_start = time.time()
        while not self.stages["manual_activation_observed"] and time.time() - wait_start < 2:
            await asyncio.sleep(0.1)

        # 2. Prepare Audio
        if wav_path:
            if not os.path.exists(wav_path):
                self.log(f"ERROR: WAV file not found: {wav_path}")
                await self.sio.disconnect()
                return False
            pcm_data = self.load_wav(wav_path)
            mode = "WAV (STT Validation)"
        else:
            pcm_data = self.generate_pcm_audio(duration=audio_duration)
            mode = "SINE (Transport Only)"

        # 3. Send Audio Chunks
        chunk_size_samples = 1024
        chunk_size_bytes = chunk_size_samples * 2 
        
        self.log(f"Mode: {mode} | Sending {len(pcm_data)} bytes in chunks...")
        for i in range(0, len(pcm_data), chunk_size_bytes):
            if self.error: break
            chunk = pcm_data[i:i + chunk_size_bytes]
            await self.sio.emit("audio_chunk", chunk)
            self.chunks_sent += 1
            self.total_bytes_sent += len(chunk)
            if self.chunks_sent % 10 == 0:
                self.debug(f"Sent {self.chunks_sent} chunks ({self.total_bytes_sent} bytes)")
            await asyncio.sleep(0.06) 

        # 4. Manual Stop
        if not self.error:
            self.log("Emitting 'manual_stop'...")
            await self.sio.emit("manual_stop")

        # 5. Wait for pipeline completion
        self.log("Waiting for pipeline stages (timeout 20s)...")
        wait_start = time.time()
        while time.time() - wait_start < 20:
            if self.error: break
            # For Sine mode, we don't necessarily expect transcript
            if wav_path:
                if self.transcript_received and self.chat_received:
                    self.log("Success! Received transcript and chat response.")
                    break
            else:
                # In sine mode, if we see 'end_of_turn_sent' and 'stt_started', transport is likely OK
                if self.stages["end_of_turn_sent"] and self.stages["stt_started"]:
                    self.log("Transport OK. (STT not expected for sine wave)")
                    break

            if self.voice_error_received:
                self.log("Error received from server.")
                break
            await asyncio.sleep(0.5)
        
        if time.time() - wait_start >= 20:
             self.log("Timeout reached.")

        await asyncio.sleep(1) # Final catch
        await self.sio.disconnect()
        self.print_report(mode)
        
        if self.error: return False
        if wav_path:
            return self.transcript_received and self.chat_received
        else:
            return self.stages["stt_started"]

    def print_report(self, mode):
        duration = time.time() - self.start_time if self.start_time else 0
        
        print("\n" + "="*50)
        print(" AUDIO PIPELINE DIAGNOSTIC REPORT")
        print("="*50)
        print(f"Mode:             {mode}")
        print(f"Backend URL:      {self.backend_url}")
        print(f"Total Duration:   {duration:.2f}s")
        
        print("\nCHECKLIST:")
        for stage in PIPELINE_STAGES:
            status = "[x]" if self.stages.get(stage) else "[ ]"
            print(f"  {status} {stage}")
        
        if self.transcript_received:
            print(f"\nTranscript:       '{self.last_transcript}'")
        
        if self.error:
            print(f"\nRESULT:           FAIL ({self.error})")
        elif mode == "SINE (Transport Only)":
            # In sine mode, we are happy if we reached stt_started
            success = self.stages.get("stt_started")
            print(f"\nRESULT:           {'PASS' if success else 'FAIL (Transport Incomplete)'}")
        else:
            success = self.transcript_received and self.chat_received
            print(f"\nRESULT:           {'PASS' if success else 'FAIL (Flow Incomplete)'}")
        print("="*50 + "\n")

async def main():
    parser = argparse.ArgumentParser(description="Rocky Audio Pipeline Tester")
    parser.add_argument("--backend-url", default="http://localhost:8000", help="Backend URL")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose logging")
    parser.add_argument("--duration", type=float, default=2.0, help="Audio duration for sine wave")
    parser.add_argument("--wav", help="Path to WAV file for real STT test")
    args = parser.parse_args()

    tester = AudioPipelineTester(args.backend_url, args.verbose)
    success = await tester.run_test(wav_path=args.wav, audio_duration=args.duration)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
