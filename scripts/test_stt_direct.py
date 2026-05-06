#!/usr/bin/env python3
import asyncio
import httpx
import argparse
import os
import sys
import wave
from dotenv import load_dotenv

# Load .env from root
load_dotenv()

def mask_key(key):
    if not key:
        return "MISSING"
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}****{key[-4:]}"

async def test_stt(wav_path):
    api_key = os.getenv("GROQ_API_KEY")
    masked_key = mask_key(api_key)
    
    print("\n" + "="*50)
    print(" GROQ STT DIRECT DIAGNOSTIC")
    print("="*50)
    print(f"Context:          Standalone Script")
    print(f"GROQ_API_KEY:     {masked_key}")
    
    if not api_key:
        print("\nERROR: STT_CONFIG_MISSING")
        print("Please set GROQ_API_KEY in your .env file.")
        return False

    if not os.path.exists(wav_path):
        print(f"\nERROR: WAV file not found: {wav_path}")
        return False

    # WAV Diagnostics
    try:
        with wave.open(wav_path, 'rb') as wf:
            params = wf.getparams()
            print(f"WAV File:         {os.path.basename(wav_path)}")
            print(f"  Channels:       {params.nchannels}")
            print(f"  Sample Rate:    {params.framerate}Hz")
            print(f"  Sample Width:   {params.sampwidth*8}-bit")
            print(f"  Frames:         {params.nframes}")
            
            if params.framerate != 16000 or params.nchannels != 1:
                print("  WARNING: Non-standard format (Expected 16kHz Mono). Groq may still work but results vary.")
    except Exception as e:
        print(f"ERROR: Could not read WAV: {e}")
        return False

    model = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    print(f"Model:            {model}")
    print(f"Endpoint:         https://api.groq.com/openai/v1/audio/transcriptions")

    async with httpx.AsyncClient(timeout=30.0) as client:
        with open(wav_path, "rb") as f:
            files = {"file": ("speech.wav", f)}
            data = {
                "model": model,
                "prompt": "Rocky, an assistant. Transcribe strictly.",
                "language": "en"
            }
            
            headers = {"Authorization": f"Bearer {api_key}"}
            
            print("\nSending request to Groq...")
            try:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    files=files,
                    data=data,
                    headers=headers
                )
                
                if resp.status_code == 200:
                    result = resp.json()
                    transcript = result.get("text", "").strip()
                    print("\n" + "-"*30)
                    print("RESULT: SUCCESS")
                    print(f"Transcript: '{transcript}'")
                    print("-" * 30)
                    return True
                elif resp.status_code == 401:
                    print("\nERROR: STT_UNAUTHORIZED")
                    print("Message: Invalid or missing GROQ_API_KEY.")
                    print(f"Response: {resp.text}")
                    return False
                elif resp.status_code == 429:
                    print("\nERROR: STT_RATE_LIMIT")
                    print("Message: Rate limit exceeded or quota exhausted.")
                    return False
                else:
                    print(f"\nERROR: HTTP {resp.status_code}")
                    print(f"Response: {resp.text[:200]}...")
                    return False
            except httpx.ConnectError:
                print("\nERROR: NETWORK_ERROR")
                print("Could not connect to api.groq.com. Check internet/proxy.")
                return False
            except Exception as e:
                print(f"\nERROR: {type(e).__name__}")
                print(f"Message: {e}")
                return False

async def main():
    parser = argparse.ArgumentParser(description="Test Groq STT Directly")
    parser.add_argument("--wav", required=True, help="Path to WAV file")
    args = parser.parse_args()

    success = await test_stt(args.wav)
    print("="*50 + "\n")
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    asyncio.run(main())
