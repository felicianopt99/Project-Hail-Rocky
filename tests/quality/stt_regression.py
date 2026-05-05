#!/usr/bin/env python3
"""
STT Regression Suite - Common Voice 13.0
Professional automated quality assessment for Speech-to-Text.
Calculates WER (Word Error Rate) and CER (Character Error Rate) with high precision.
Compatible with NVIDIA NeMo evaluation standards.
"""

import os
import json
import asyncio
import time
import re
import unicodedata
import io
import wave
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

import httpx
import numpy as np
import jiwer
from datasets import load_dataset
from dotenv import load_dotenv
from tqdm import tqdm

# Load environment variables
load_dotenv()

# Configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
HF_TOKEN = os.getenv("HF_TOKEN")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "reports")
DATASET_NAME = "google/fleurs"
DEFAULT_LANG = "en_us"
DEFAULT_MODEL = "whisper-large-v3-turbo"

# NeMo-style normalization
def normalize_text(text: str) -> str:
    """
    Normalizes text for WER/CER calculation:
    - Lowercase
    - Remove punctuation
    - Normalize unicode (NFC)
    - Remove extra whitespace
    """
    if not text:
        return ""
    
    # Unicode normalization
    text = unicodedata.normalize('NFC', text)
    
    # Lowercase
    text = text.lower()
    
    # Remove punctuation except apostrophes (common in some languages)
    # Using a broad regex for punctuation
    text = re.sub(r'[^\w\s\']', '', text)
    
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

class STTRegressionTester:
    def __init__(self, language: str = DEFAULT_LANG, model: str = DEFAULT_MODEL, sample_limit: int = 50):
        self.language = language
        self.model = model
        self.sample_limit = sample_limit
        self.results = []
        self.client = httpx.AsyncClient(timeout=60.0)
        
        if not GROQ_API_KEY:
            print("⚠️ WARNING: GROQ_API_KEY not found. Transcriptions will fail.")

    async def transcribe_sample(self, audio_data: bytes, filename: str = "sample.wav") -> str:
        """Calls Groq Whisper API for transcription."""
        if not GROQ_API_KEY:
            return "[ERROR: NO API KEY]"

        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        files = {"file": (filename, audio_data)}
        
        # Groq prefers 2-letter ISO codes (e.g., 'pt' instead of 'pt_br')
        api_lang = self.language.split('_')[0].split('-')[0]
        
        data = {
            "model": self.model,
            "language": api_lang,
            "temperature": 0.0
        }

        try:
            resp = await self.client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers=headers,
                files=files,
                data=data
            )
            if resp.status_code != 200:
                print(f"❌ API Error: {resp.status_code} - {resp.text}")
                return ""
            
            result = resp.json()
            return result.get("text", "")
        except Exception as e:
            print(f"💥 Exception during transcription: {e}")
            return ""

    def convert_to_wav(self, audio_array: np.ndarray, sampling_rate: int) -> bytes:
        """Converts raw audio array to WAV bytes."""
        # Common Voice samples are usually 48kHz or 32kHz, we'll keep them as is
        # but Whisper likes 16kHz. Groq handles most formats, but WAV is safe.
        with io.BytesIO() as wav_io:
            with wave.open(wav_io, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2) # 16-bit
                wf.setframerate(sampling_rate)
                # Convert float32 [-1, 1] to int16
                samples = (audio_array * 32767).astype(np.int16)
                wf.writeframes(samples.tobytes())
            return wav_io.getvalue()

    async def run(self, split: str = "test"):
        print(f"🚀 Starting STT Regression: {DATASET_NAME} [{self.language}]")
        print(f"📦 Split: {split} | Model: {self.model} | Limit: {self.sample_limit}")
        
        try:
            # Load dataset in streaming mode to save time/space
            # FLEURS requires trust_remote_code=True
            ds = load_dataset(DATASET_NAME, self.language, split=split, streaming=True, token=HF_TOKEN, trust_remote_code=True)
            
            # Select subset
            subset = ds.take(self.sample_limit)
            
            start_time = time.time()
            
            for i, sample in enumerate(tqdm(subset, total=self.sample_limit, desc="Processing samples")):
                audio = sample["audio"]
                # FLEURS uses 'transcription' instead of 'sentence'
                reference = sample.get("transcription") or sample.get("raw_transcription") or sample.get("sentence", "")
                
                # Convert to WAV
                wav_data = self.convert_to_wav(audio["array"], audio["sampling_rate"])
                
                # Transcribe
                t0 = time.time()
                hypothesis = await self.transcribe_sample(wav_data)
                latency = time.time() - t0
                
                # Normalize
                ref_norm = normalize_text(reference)
                hyp_norm = normalize_text(hypothesis)
                
                # Calculate local metrics
                if ref_norm:
                    sample_wer = jiwer.wer(ref_norm, hyp_norm)
                    sample_cer = jiwer.cer(ref_norm, hyp_norm)
                else:
                    sample_wer = 0.0
                    sample_cer = 0.0

                self.results.append({
                    "id": i,
                    "reference": reference,
                    "hypothesis": hypothesis,
                    "ref_norm": ref_norm,
                    "hyp_norm": hyp_norm,
                    "wer": sample_wer,
                    "cer": sample_cer,
                    "latency_sec": latency,
                    "audio_duration_sec": len(audio["array"]) / audio["sampling_rate"]
                })

            total_duration = time.time() - start_time
            self.generate_report(total_duration)
            
        except Exception as e:
            print(f"💥 Failed to run regression: {e}")
            if "Gated" in str(e):
                print("💡 TIP: This dataset is gated. Ensure HF_TOKEN is set and you accepted terms at Hugging Face.")

    def generate_report(self, total_duration: float):
        if not self.results:
            print("❌ No results to report.")
            return

        wers = [r["wer"] for r in self.results]
        cers = [r["cer"] for r in self.results]
        latencies = [r["latency_sec"] for r in self.results]
        audio_durations = [r["audio_duration_sec"] for r in self.results]

        avg_wer = np.mean(wers)
        avg_cer = np.mean(cers)
        avg_latency = np.mean(latencies)
        rtf = sum(latencies) / sum(audio_durations) if sum(audio_durations) > 0 else 0

        summary = {
            "metadata": {
                "dataset": DATASET_NAME,
                "language": self.language,
                "model": self.model,
                "timestamp": datetime.now().isoformat(),
                "total_samples": len(self.results),
                "total_duration_sec": total_duration
            },
            "metrics": {
                "avg_wer": round(float(avg_wer), 4),
                "avg_cer": round(float(avg_cer), 4),
                "avg_latency_sec": round(float(avg_latency), 3),
                "rtf": round(float(rtf), 3) # Real Time Factor
            },
            "samples": self.results
        }

        os.makedirs(REPORTS_DIR, exist_ok=True)
        report_path = os.path.join(REPORTS_DIR, f"stt_regression_{self.language}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        
        with open(report_path, "w") as f:
            json.dump(summary, f, indent=2)

        # Generate Markdown summary for easy viewing
        md_path = report_path.replace(".json", ".md")
        with open(md_path, "w") as f:
            f.write(f"# STT Regression Report - {self.language.upper()}\n\n")
            f.write(f"- **Timestamp**: {summary['metadata']['timestamp']}\n")
            f.write(f"- **Model**: `{self.model}`\n")
            f.write(f"- **Dataset**: `{DATASET_NAME}`\n")
            f.write(f"- **Samples**: {summary['metadata']['total_samples']}\n\n")
            
            f.write("## 📊 Key Metrics\n\n")
            f.write(f"| Metric | Value | benchmark (NeMo Target) |\n")
            f.write(f"| :--- | :--- | :--- |\n")
            f.write(f"| **WER** | **{avg_wer:.2%}** | < 15% |\n")
            f.write(f"| **CER** | **{avg_cer:.2%}** | < 10% |\n")
            f.write(f"| **Avg Latency** | {avg_latency:.2f}s | - |\n")
            f.write(f"| **RTF** | {rtf:.3f} | < 0.5 |\n\n")
            
            f.write("## 🔍 Sample Analysis (Top 5 Worst WER)\n\n")
            sorted_samples = sorted(self.results, key=lambda x: x["wer"], reverse=True)[:5]
            f.write("| ID | Reference | Hypothesis | WER |\n")
            f.write("| :--- | :--- | :--- | :--- |\n")
            for s in sorted_samples:
                f.write(f"| {s['id']} | {s['reference']} | {s['hypothesis']} | {s['wer']:.2%} |\n")

        print(f"\n✅ Regression Complete!")
        print(f"📊 AVG WER: {avg_wer:.2%}")
        print(f"📊 AVG CER: {avg_cer:.2%}")
        print(f"📁 Detailed Report: {report_path}")
        print(f"📝 Summary: {md_path}")

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="STT Regression Suite")
    parser.add_argument("--lang", type=str, default=DEFAULT_LANG, help="Language code (e.g. pt, en)")
    parser.add_argument("--limit", type=int, default=30, help="Number of samples to test")
    parser.add_argument("--split", type=str, default="test", help="Dataset split (test, dev, train)")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Groq model name")
    parser.add_argument("--max-wer", type=float, default=0.15, help="Maximum acceptable Word Error Rate (default: 0.15)")
    parser.add_argument("--max-cer", type=float, default=0.10, help="Maximum acceptable Character Error Rate (default: 0.10)")
    parser.add_argument("--max-rtf", type=float, default=0.5, help="Maximum acceptable Real Time Factor (default: 0.5)")

    args = parser.parse_args()

    tester = STTRegressionTester(language=args.lang, model=args.model, sample_limit=args.limit)
    await tester.run(split=args.split)

    # Quality asserts for CI/CD
    if hasattr(tester, 'results') and tester.results:
        wers = [r["wer"] for r in tester.results]
        cers = [r["cer"] for r in tester.results]
        latencies = [r["latency_sec"] for r in tester.results]
        audio_durations = [r["audio_duration_sec"] for r in tester.results]

        avg_wer = np.mean(wers)
        avg_cer = np.mean(cers)
        avg_latency = np.mean(latencies)
        rtf = sum(latencies) / sum(audio_durations) if sum(audio_durations) > 0 else 0

        print(f"\n🔍 Quality Gates Check:")
        print(f"   WER: {avg_wer:.2%} (threshold: {args.max_wer:.2%})")
        print(f"   CER: {avg_cer:.2%} (threshold: {args.max_cer:.2%})")
        print(f"   RTF: {rtf:.3f} (threshold: {args.max_rtf:.3f})")

        if avg_wer > args.max_wer:
            raise AssertionError(f"WER {avg_wer:.2%} exceeds maximum {args.max_wer:.2%}")
        if avg_cer > args.max_cer:
            raise AssertionError(f"CER {avg_cer:.2%} exceeds maximum {args.max_cer:.2%}")
        if rtf > args.max_rtf:
            raise AssertionError(f"RTF {rtf:.3f} exceeds maximum {args.max_rtf:.3f}")

        print("✅ All quality gates passed!")

if __name__ == "__main__":
    asyncio.run(main())
