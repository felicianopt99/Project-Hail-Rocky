import asyncio
import os
import json
import numpy as np
from typing import AsyncGenerator

from pipecat.frames.frames import AudioRawFrame, TextFrame, TranscriptionFrame, Frame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.groq.stt import GroqSTTService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.turns.user_mute import AlwaysUserMuteStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat_flows import FlowManager
from .flow_config import get_flow_config

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
        
        await self.push_frame(frame, direction)

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
    log.info("voice_pipeline_starting", sid=sid, state=emotional_state)
    # 1. Transport
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_out_enabled=True,
            audio_out_sample_rate=SAMPLE_RATE,
            audio_in_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(params=VADParams(confidence=0.95)), # Extremely strict to ignore speaker-to-mic leakage
            vad_audio_passthrough=False,
            add_wav_header=False
        )
    )

    # 2. Services
    stt = GroqSTTService(
        api_key=os.getenv("GROQ_API_KEY"),
        model=os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
        language="en", 
        initial_prompt="Rocky, a digital assistant for technical mission control. Clear English transcription."
    )
    
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

    # 3. Context & Aggregators
    # Standard Pipecat pattern for robust turn-taking and interruption handling
    context = LLMContext(messages=[])
    user_params = LLMUserAggregatorParams(
        user_mute_strategies=[AlwaysUserMuteStrategy()], # Native echo prevention
        user_turn_strategies=UserTurnStrategies()
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context, user_params=user_params)
    
    # 5. Pipeline setup
    # Ordering is critical for interruption handling
    pipeline = Pipeline([
        transport.input(),           # Receive audio chunks
        input_logger,                # Log input
        stt,                         # Transcription
        user_aggregator,             # Groups transcription into turns
        brain,                       # Chat logic (Backend Bridge)
        JsonMessageRelay(websocket), # Relay transcripts & tokens
        disfluency,                  # Personality
        tts,                         # Synthesis
        effects,                     # Audio effects
        transport.output(),          # Send back to client
        assistant_aggregator         # Track assistant responses for context
    ])

    task = PipelineTask(pipeline)

    # 4. Flow Management
    # Initialize the FlowManager with our nodes
    flow_manager = FlowManager(
        task=task,
        llm=None, # The backend handles the LLM
        context_aggregator=user_aggregator
    )
    await flow_manager.initialize(get_flow_config())
    brain.set_flow_manager(flow_manager)

    runner = PipelineRunner()
    
    try:
        await runner.run(task)
    finally:
        await brain.cleanup()
