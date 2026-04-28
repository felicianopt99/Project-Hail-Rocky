import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, List, Optional, Union

import httpx
import numpy as np
from faster_whisper import WhisperModel
from getstream.video.rtc.track_util import PcmData

from vision_agents.core.llm.events import LLMResponseChunkEvent, LLMResponseCompletedEvent
from vision_agents.core.llm.llm import LLM, LLMResponseEvent
from vision_agents.core.stt.events import STTTranscriptEvent
from vision_agents.core.stt.stt import STT
from vision_agents.core.stt.events import TranscriptResponse
from vision_agents.core.tts.events import TTSAudioEvent
from vision_agents.core.tts.tts import TTS
from vision_agents.core.edge.types import Participant
from vision_agents.core.turn_detection import TurnStartedEvent, TurnEndedEvent
from vision_agents.core.vad.silero import SileroVADSessionPool

logger = logging.getLogger("Rocky-Extensions")

class LocalWhisperSTT(STT):
    """
    High-performance Local Whisper STT with integrated Silero VAD and Turn Detection.
    Aligns with Vision Agents v0.5.5 streaming patterns.
    """
    turn_detection: bool = True

    def __init__(self, model_size: str = "base", model_dir: str = "./models"):
        super().__init__(provider_name="local-whisper")
        logger.info(f"Loading Local Whisper model: {model_size} (Amaze!)...")
        self._model = WhisperModel(model_size, device="cpu", compute_type="int8")
        self.model_dir = model_dir
        self._vad_session = None
        self._audio_buffer = bytearray()
        self._is_speaking = False
        self._silence_count_ms = 0
        self._speech_count_ms = 0
        
        # Thresholds
        self._vad_threshold = 0.4
        self._min_speech_ms = 150
        self._min_silence_ms = 800
        
        logger.info("Local Whisper STT initialized.")

    async def start(self):
        await super().start()
        pool = await SileroVADSessionPool.load(self.model_dir)
        self._vad_session = pool.session()
        logger.info("Silero VAD started for Local Whisper. Listening for turns!")

    async def process_audio(self, pcm_data: PcmData, participant: Participant):
        if not self._vad_session or self.closed:
            if not self._vad_session:
                logger.error("[VAD] VAD session not initialized!")
            return

        # 16kHz PCM mono is 32 bytes per ms (16 bits = 2 bytes)
        # Each chunk from Agent is typically 20ms (640 bytes)
        chunk_bytes = pcm_data.to_bytes()
        self._audio_buffer.extend(chunk_bytes)
        chunk_ms = len(chunk_bytes) // 32

        if len(self._audio_buffer) == len(chunk_bytes):  # First chunk
            logger.info(f"[VAD] FIRST AUDIO RECEIVED - {len(chunk_bytes)} bytes")

        if len(self._audio_buffer) % (32 * 500) < 32 * 100:  # Log roughly every 500ms
            logger.info(f"[VAD] Buffer size: {len(self._audio_buffer)} bytes")
        
        # Check VAD
        score = self._vad_session.predict_speech(pcm_data)
        
        if score > self._vad_threshold:
            self._speech_count_ms += chunk_ms
            self._silence_count_ms = 0
            if not self._is_speaking and self._speech_count_ms >= self._min_speech_ms:
                self._is_speaking = True
                logger.info("👉 Turn Started (User Speaking)")
                self._emit_turn_started_event(participant=participant)
        else:
            self._silence_count_ms += chunk_ms
            if self._is_speaking and self._silence_count_ms >= self._min_silence_ms:
                self._is_speaking = False
                logger.info(f"👈 Turn Ended (Silence: {self._silence_count_ms}ms). Transcribing...")
                await self._transcribe_and_emit(participant)

    async def _transcribe_and_emit(self, participant: Participant):
        if not self._audio_buffer:
            return
            
        try:
            # Prepare audio for Whisper (normalized float32)
            audio_data = np.frombuffer(self._audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
            
            # Offload to thread to keep loop interactive
            segments, _ = await asyncio.to_thread(self._model.transcribe, audio_data, beam_size=5)
            text = " ".join([segment.text for segment in segments]).strip()
            
            if text:
                logger.info(f"🎙️ STT Final: {text}")
                
                # Metadata for Agent metrics
                response_metadata = TranscriptResponse(
                    confidence=0.9,
                    language="auto",
                    audio_duration_ms=len(self._audio_buffer) // 32,
                    model_name="whisper-local"
                )
                
                # Emit events in correct order for Agent.py
                self._emit_transcript_event(text, participant, response_metadata)
                self._emit_turn_ended_event(participant=participant)
            else:
                logger.info("🤫 Empty turn (no speech detected by Whisper).")
            
        except Exception as e:
            logger.error(f"❌ Transcription error: {e}")
        finally:
            self.clear_buffer()

    def clear_buffer(self):
        self._audio_buffer = bytearray()
        self._speech_count_ms = 0
        self._silence_count_ms = 0

    async def transcribe(self, pcm_data: PcmData) -> str:
        """Manual fallback."""
        audio_data = np.frombuffer(pcm_data.to_bytes(), dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = await asyncio.to_thread(self._model.transcribe, audio_data, beam_size=5)
        return " ".join([segment.text for segment in segments]).strip()

    async def clear(self):
        self.clear_buffer()

    async def close(self):
        await super().close()

class OllamaLLM(LLM):
    def __init__(self, base_url: str, model: str):
        super().__init__()
        self.base_url = base_url
        self.model = model
        self._client = httpx.AsyncClient()

    async def simple_response(self, text: str, participant: Optional[Any] = None) -> LLMResponseEvent:
        try:
            payload = {
                "model": self.model,
                "prompt": text,
                "system": self._instructions,
                "stream": True
            }
            
            full_text = ""
            async with self._client.stream("POST", f"{self.base_url}/api/generate", json=payload, timeout=60) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line: continue
                    chunk = json.loads(line)
                    delta = chunk.get("response", "")
                    if delta:
                        full_text += delta
                        self.events.send(LLMResponseChunkEvent(
                            plugin_name="ollama",
                            delta=delta,
                            item_id="ollama-res",
                            output_index=0,
                            sequence_number=0
                        ))
                    if chunk.get("done"):
                        break
            
            self.events.send(LLMResponseCompletedEvent(
                plugin_name="ollama",
                text=full_text,
                original={},
                item_id="ollama-res"
            ))
            return LLMResponseEvent(original={}, text=full_text)
        except Exception as e:
            logger.error(f"Ollama error: {e}")
            raise

    async def close(self):
        await self._client.close()

class GeminiLLM(LLM):
    def __init__(self, api_key: str, model: str):
        super().__init__()
        self.api_key = api_key
        self.model = model
        self._client = httpx.AsyncClient()

    async def simple_response(self, text: str, participant: Optional[Any] = None) -> LLMResponseEvent:
        url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self._instructions},
                {"role": "user", "content": text}
            ],
            "stream": True
        }
        
        full_text = ""
        try:
            async with self._client.stream("POST", url, headers=headers, json=payload, timeout=60) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "): continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]": break
                    
                    chunk = json.loads(data_str)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        full_text += delta
                        self.events.send(LLMResponseChunkEvent(
                            plugin_name="gemini",
                            delta=delta,
                            item_id=chunk.get("id", "gemini-res"),
                            output_index=0,
                            sequence_number=0
                        ))
            
            return LLMResponseEvent(original={}, text=full_text)
        except Exception as e:
            logger.error(f"Gemini error: {e}")
            raise

class FallbackLLM(LLM):
    def __init__(self, llms: List[LLM]):
        super().__init__()
        self.llms = llms

    @property
    def metadata(self):
        if self.llms:
            return self.llms[0].metadata
        return {}

    def set_instructions(self, instructions: Any) -> None:
        super().set_instructions(instructions)
        for llm in self.llms:
            llm.set_instructions(instructions)

    def register_function(self, name=None, description=None):
        def decorator(f):
            for llm in self.llms:
                llm.register_function(name, description)(f)
            return f
        return decorator

    async def simple_response(self, text: str, participant: Optional[Any] = None) -> LLMResponseEvent:
        return await self._proxy_call("simple_response", text, participant)


    async def _proxy_call(self, method_name: str, *args, **kwargs):
        last_error = None
        for i, llm in enumerate(self.llms):
            try:
                if not hasattr(llm, method_name):
                    continue
                    
                logger.info(f"Attempting LLM {i+1} ({type(llm).__name__}) method: {method_name}")
                
                async def bubble_event(event):
                    self.events.send(event)
                
                token = llm.events.subscribe(bubble_event)
                try:
                    method = getattr(llm, method_name)
                    return await method(*args, **kwargs)
                finally:
                    llm.events.unsubscribe(token)
                    
            except Exception as e:
                logger.warning(f"LLM {type(llm).__name__} failed on {method_name}: {e}")
                last_error = e
                continue
        
        raise last_error or Exception(f"No LLMs available for {method_name}")

    async def close(self):
        for llm in self.llms:
            await llm.close()

class KokoroTTS(TTS):
    def __init__(self, url: str, voice: str = "am_adam"):
        super().__init__()
        self.url = url
        self.voice = voice
        self._client = httpx.AsyncClient()

    async def stream_audio(self, text: str, *args, **kwargs) -> PcmData:
        if not text:
            raise ValueError("Cannot synthesize empty text")
        try:
            res = await self._client.post(
                self.url,
                json={"text": text, "voice": self.voice, "response_format": "pcm"},
                timeout=15
            )
            res.raise_for_status()
            return PcmData.from_bytes(res.content)
        except Exception as e:
            logger.error(f"Kokoro TTS failed: {e}")
            raise


    async def stop_audio(self) -> None:
        pass

    async def close(self):
        await self._client.close()

class WyomingWakeWord:
    def __init__(self, host: str = "127.0.0.1", port: int = 10400):
        self.host = host
        self.port = port
        self.writer = None
        self.reader = None
        self._connected = False
        self._callback = None

    def set_callback(self, cb):
        self._callback = cb


    async def connect(self):
        if self._connected:
            return
        try:
            log_ext = logging.getLogger("WyomingClient")
            log_ext.info(f"Connecting to Wyoming Wake Word at {self.host}:{self.port}...")
            # Use a timeout to avoid hanging startup
            self.reader, self.writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), 
                timeout=5.0
            )
            self._connected = True
            
            # Start background listener for detection events
            asyncio.create_task(self._listen())
            
            # Send initial audio-start event
            start_evt = {"type": "audio-start", "data": {"rate": 16000, "width": 2, "channels": 1}}
            self.writer.write((json.dumps(start_evt) + "\n").encode())
            await self.writer.drain()
            log_ext.info("Wyoming connection established. Listening for Rocky! Amaze!")
        except Exception as e:
            logging.getLogger("WyomingClient").error(f"Wyoming connection failed (check if wakeword container is running): {e}")
            self._connected = False

    async def _listen(self):
        from app.api.socket_server import sio
        try:
            while self._connected:
                line = await self.reader.readline()
                if not line:
                    break
                event = json.loads(line.decode())
                if event.get("type") == "detection":
                    data = event.get("data", {})
                    name = data.get("name", "unknown")
                    logging.getLogger("WyomingClient").info(f"WAKE WORD DETECTED: {name}")
                    # Trigger callback if set
                    await self._on_wake_word_fired(name)
                    # Notify frontend
                    await sio.emit("wake_word_detected", {"name": name})
                    await sio.emit("status_update", "listening")
        except Exception as e:
            logging.getLogger("WyomingClient").error(f"Wyoming listener error: {e}")
        finally:
            self._connected = False

    async def _on_wake_word_fired(self, name: str):
        if self._callback:
            await self._callback()


    async def send_audio(self, pcm_bytes: bytes):
        if not self._connected:
            await self.connect()
            if not self._connected:
                return

        try:
            chunk_evt = {
                "type": "audio-chunk",
                "data": {"rate": 16000, "width": 2, "channels": 1},
                "payload_length": len(pcm_bytes)
            }
            self.writer.write((json.dumps(chunk_evt) + "\n").encode())
            self.writer.write(pcm_bytes)
            await self.writer.drain()
        except Exception as e:
            logging.getLogger("WyomingClient").error(f"Error sending audio to Wyoming: {e}")
            self._connected = False

    async def close(self):
        if self._connected:
            self._connected = False
            self.writer.close()
            await self.writer.wait_closed()
