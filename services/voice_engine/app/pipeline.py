import asyncio
import os
import json
import time
import numpy as np
from typing import AsyncGenerator

from pipecat.frames.frames import (
    AudioRawFrame,
    CancelFrame,
    ControlFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    StartFrame,
    TextFrame,
    TranscriptionFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.groq.stt import GroqSTTService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.aggregators.llm_context import LLMContext
from .processors.raw_audio_serializer import RawAudioSerializer

import structlog
log = structlog.get_logger()

from .processors.voice_effects import VoiceEffectsProcessor, SAMPLE_RATE
from .processors.disfluency import DisfluencyInjector
from .processors.brain_processor import RockyBrainProcessor



class VoiceEffectsFrameProcessor(FrameProcessor):
    def __init__(self, emotional_state: str = "neutral"):
        super().__init__()
        self._fx = VoiceEffectsProcessor(emotional_state=emotional_state, sample_rate=SAMPLE_RATE)

    async def process_frame(self, frame: Frame, direction):
        if isinstance(frame, AudioRawFrame):
            # Apply effects to the audio samples
            samples = np.frombuffer(frame.audio, dtype=np.int16).astype(np.float32) / 32768.0
            processed = self._fx.apply_to_float(samples)
            processed_bytes = (np.clip(processed, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
            await self.push_frame(AudioRawFrame(audio=processed_bytes, sample_rate=SAMPLE_RATE, num_channels=1), direction)
        elif isinstance(frame, TextFrame):
            log.info("pipeline_text_frame", text=frame.text)
            await self.push_frame(frame, direction)
        elif isinstance(frame, TranscriptionFrame):
            log.info("pipeline_transcription_frame", text=frame.text, final=frame.user_id) # user_id is often used for meta
            await self.push_frame(frame, direction)
        else:
            await self.push_frame(frame, direction)

class JsonMessageRelay(FrameProcessor):
    """Relays non-audio frames as JSON control messages over the websocket."""
    def __init__(self, websocket):
        super().__init__()
        self._ws = websocket

    async def process_frame(self, frame: Frame, direction):
        if isinstance(frame, TranscriptionFrame):
            # Some STT services don't set 'final' correctly, we assume final if it reaches here
            await self._ws.send_text(json.dumps({"type": "transcript", "text": frame.text}))
        elif isinstance(frame, TextFrame):
            # Relay tokens to the frontend so the user sees the response forming
            await self._ws.send_text(json.dumps({"type": "chat_token", "token": frame.text}))
        elif isinstance(frame, TTSStartedFrame):
            await self._ws.send_text(json.dumps({"type": "tts_start", "sampleRate": SAMPLE_RATE}))
        elif isinstance(frame, TTSStoppedFrame):
            await self._ws.send_text(json.dumps({"type": "tts_end"}))
        elif isinstance(frame, Frame) and hasattr(frame, "type") and frame.type == "voice_debug":
            # Pass through any manual voice_debug frames if we add them later
            pass
        
        await self.push_frame(frame, direction)

class InputLogger(FrameProcessor):
    async def process_frame(self, frame: Frame, direction):
        if isinstance(frame, AudioRawFrame):
            # log.debug("audio_frame_in", size=len(frame.audio))
            pass
        elif isinstance(frame, TranscriptionFrame):
            log.info("stt_transcript_received", text=frame.text, user_id=frame.user_id)
        
        await self.push_frame(frame, direction)

class VoiceDebugProcessor(FrameProcessor):
    """Diagnostic processor to track pipeline stages."""
    def __init__(self, websocket):
        super().__init__()
        self._ws = websocket
        self._stt_started = False
        self._total_bytes = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        try:
            if isinstance(frame, StartFrame):
                log.info("voice_debug_start_frame_received")

            # Only process audio/transcript in the forward direction (input)
            if direction == FrameDirection.DOWNSTREAM:
                if isinstance(frame, AudioRawFrame):
                    self._total_bytes += len(frame.audio)
                    # Periodic audio receipt check (every ~16KB)
                    if self._total_bytes % 16384 < len(frame.audio):
                        log.info("voice_debug_sending_audio_received", bytes=self._total_bytes)
                        await self._ws.send_text(json.dumps({
                            "type": "voice_debug", 
                            "stage": "voice_engine_audio_received", 
                            "bytes": self._total_bytes,
                            "timestamp": time.time()
                        }))
                    
                    # Check for silence/EOT (if backend sent a chunk of zeros)
                    if len(frame.audio) >= 3200 and all(b == 0 for b in frame.audio):
                         log.info("voice_debug_sending_eot_received")
                         await self._ws.send_text(json.dumps({
                            "type": "voice_debug", 
                            "stage": "end_of_turn_received",
                            "timestamp": time.time()
                        }))

                    # STT Trigger
                    if not self._stt_started and self._total_bytes > 0:
                        self._stt_started = True
                        await self._ws.send_text(json.dumps({
                            "type": "voice_debug", 
                            "stage": "stt_started",
                            "timestamp": time.time()
                        }))

                elif isinstance(frame, TranscriptionFrame):
                    await self._ws.send_text(json.dumps({
                        "type": "voice_debug", 
                        "stage": "transcript_emitted",
                        "text": frame.text,
                        "timestamp": time.time()
                    }))

            await self.push_frame(frame, direction)
        except Exception as e:
            log.error("voice_debug_processor_error", error=str(e))
            await self.push_frame(frame, direction)

class SpeakerTracker(FrameProcessor):
    """Pushes TTS status frames upstream so the brain can track speaking state."""
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, (TTSStartedFrame, TTSStoppedFrame)):
            log.debug("speaker_status_upstream", frame=type(frame).__name__)
            await self.push_frame(frame, FrameDirection.UPSTREAM)
        await self.push_frame(frame, direction)

class ErrorRelay(FrameProcessor):
    """Processor to relay pipeline errors to the frontend."""
    def __init__(self, websocket):
        super().__init__()
        self._ws = websocket

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, (StartFrame, EndFrame, CancelFrame, ControlFrame)):
            await self.push_frame(frame, direction)
            return

        try:
            if isinstance(frame, ErrorFrame):
                error_msg = str(frame.error)
                log.error("pipeline_error_detected", error=error_msg)

                code = "PIPELINE_ERROR"
                user_msg = f"Voice Pipeline Error: {error_msg}"

                if "401" in error_msg or "unauthorized" in error_msg.lower():
                    code = "STT_UNAUTHORIZED"
                    user_msg = "Groq STT unauthorized. Check GROQ_API_KEY."
                elif "429" in error_msg or "rate limit" in error_msg.lower():
                    code = "STT_RATE_LIMIT"
                    user_msg = "Groq STT rate limited. Please wait."

                try:
                    await self._ws.send_text(json.dumps({
                        "type": "voice_error",
                        "code": code,
                        "message": user_msg
                    }))
                except Exception:
                    pass
                # Consume the error frame — don't propagate downstream
                return

            await self.push_frame(frame, direction)
        except Exception as e:
            log.error("error_relay_exception", error=str(e))
            await self.push_frame(frame, direction)

async def run_voice_pipeline(websocket, sid: str = "default", emotional_state: str = "neutral"):
    log.info("voice_pipeline_starting", sid=sid, state=emotional_state)
    # 1. Transport
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_out_enabled=True,
            audio_out_sample_rate=SAMPLE_RATE,
            audio_in_enabled=True,
            audio_in_sample_rate=16000,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(params=VADParams(confidence=0.4)),
            vad_audio_passthrough=True,
            add_wav_header=False,
            serializer=RawAudioSerializer(),
        )
    )

    # 2. Services
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        log.error("stt_config_missing", status="STT will fail")
        # Emit a debug event immediately if possible
        await websocket.send_text(json.dumps({
            "type": "voice_error",
            "code": "STT_CONFIG_MISSING",
            "message": "Groq API key is missing. Check GROQ_API_KEY in .env"
        }))
    else:
        # Masked key logging: gsk_****abcd
        masked = f"{groq_key[:4]}****{groq_key[-4:]}" if len(groq_key) > 8 else "****"
        log.info("groq_api_key_present", length=len(groq_key), key=masked)

    stt = GroqSTTService(
        api_key=groq_key,
        model=os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
        language="en",
        initial_prompt="Rocky, a digital assistant for technical mission control. Clear English transcription."
    )
    
    # Brain (Backend Bridge)
    brain = RockyBrainProcessor(sid=sid, websocket=websocket, backend_url=os.getenv("BACKEND_URL", "http://127.0.0.1:8000"))
    
    # Kokoro for TTS
    tts = KokoroTTSService(
        model_path=os.path.join(os.getenv("MODELS_DIR", "/models"), "kokoro-v1.0.onnx"),
        voices_path=os.path.join(os.getenv("MODELS_DIR", "/models"), "voices-v1.0.bin"),
        voice="am_michael"
    )
    
    # 3. Processors
    effects = VoiceEffectsFrameProcessor(emotional_state=emotional_state)
    disfluency = DisfluencyInjector(probability=0.2)
    input_logger = InputLogger()
    voice_debug = VoiceDebugProcessor(websocket)
    error_relay = ErrorRelay(websocket)

    # 3. Context & Aggregators
    # Simple VAD-based turn detection — Silero fires UserStoppedSpeakingFrame
    # which triggers LLMContextFrame → brain processor.
    context = LLMContext(messages=[])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)
    
    # 5. Pipeline setup
    # Ordering is critical for interruption handling
    pipeline = Pipeline([
        transport.input(),           # Receive audio chunks
        voice_debug,                 # Diagnostics (Input)
        input_logger,                # Log input
        stt,                         # Transcription
        user_aggregator,             # Groups transcription into turns
        brain,                       # Chat logic (Backend Bridge)
        JsonMessageRelay(websocket), # Relay transcripts & tokens
        disfluency,                  # Personality
        tts,                         # Synthesis
        SpeakerTracker(),            # Feedback loop for speaking state
        JsonMessageRelay(websocket), # Relay TTS lifecycle (start/end)
        effects,                     # Audio effects
        error_relay,                 # Catch any pipeline errors before output
        transport.output(),          # Send back to client
        assistant_aggregator         # Track assistant responses for context
    ])

    # disable_rtvi: Rocky uses a custom WebSocket bridge (pipecat_bridge.py),
    # not an RTVI-compatible client. Enabling RTVI (the default in Pipecat 1.x)
    # injects RTVIProcessor which waits for a client-ready handshake before
    # passing audio — causing an idle timeout when raw PCM arrives instead.
    task = PipelineTask(pipeline, enable_rtvi=False)

    runner = PipelineRunner()
    
    try:
        await runner.run(task)
    finally:
        await brain.cleanup()
