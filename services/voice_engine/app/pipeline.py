import asyncio
import os
import numpy as np
from typing import AsyncGenerator

from pipecat.frames.frames import AudioRawFrame, TextFrame, TranscriptionFrame, Frame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.groq.stt import GroqSTTService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.audio.vad.silero import SileroVADAnalyzer

from .processors.voice_effects import VoiceEffectsProcessor, SAMPLE_RATE
from .processors.disfluency import DisfluencyInjector
from .processors.brain_processor import RockyBrainProcessor

class VoiceEffectsFrameProcessor(FrameProcessor):
    def __init__(self, emotional_state: str = "neutral"):
        super().__init__()
        self._fx = VoiceEffectsProcessor(emotional_state=emotional_state, sample_rate=SAMPLE_RATE)

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        
        # log.debug("pipeline_frame", type=type(frame).__name__)

        if isinstance(frame, AudioRawFrame):
            # Apply effects to the audio samples
            samples = np.frombuffer(frame.audio, dtype=np.int16).astype(np.float32) / 32768.0
            processed = self._fx.apply_to_float(samples)
            processed_bytes = (np.clip(processed, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
            await self.push_frame(AudioRawFrame(audio=processed_bytes, sample_rate=SAMPLE_RATE, num_channels=1))
        elif isinstance(frame, TextFrame):
            log.info("pipeline_text_frame", text=frame.text)
            await self.push_frame(frame)
        elif isinstance(frame, TranscriptionFrame):
            log.info("pipeline_transcription_frame", text=frame.text, final=frame.user_id) # user_id is often used for meta
            await self.push_frame(frame)
        else:
            await self.push_frame(frame)

class InputLogger(FrameProcessor):
    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, AudioRawFrame):
            log.info("audio_frame_received", size=len(frame.audio))
            pass
        elif isinstance(frame, TranscriptionFrame):
            log.info("stt_frame_received", text=frame.text)
        await self.push_frame(frame)

async def run_voice_pipeline(websocket, sid: str = "default", emotional_state: str = "neutral"):
    # 1. Transport
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_out_enabled=True,
            audio_in_enabled=True,
            vad_enabled=False, # Let frontend handle VAD for now to avoid conflicts
            add_wav_header=False
        )
    )

    # 2. Services
    stt = GroqSTTService(api_key=os.getenv("GROQ_API_KEY"))
    
    # Brain (Backend Bridge)
    brain = RockyBrainProcessor(sid=sid, backend_url=os.getenv("BACKEND_URL", "http://127.0.0.1:8000"))
    
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

    # 4. Pipeline setup
    pipeline = Pipeline([
        transport.input(),   # Receive audio chunks
        input_logger,        # Log input
        stt,                 # Transcription
        brain,               # Chat logic (Backend)
        disfluency,          # Personality
        tts,                 # Synthesis
        effects,             # Effects
        transport.output()   # Send back
    ])

    task = PipelineTask(pipeline)
    runner = PipelineRunner()
    
    try:
        await runner.run(task)
    finally:
        await brain.cleanup()
