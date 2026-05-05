import httpx
import asyncio
import structlog
from pipecat.frames.frames import Frame, TextFrame, TranscriptionFrame, LLMContextFrame
from pipecat.processors.frame_processor import FrameProcessor

log = structlog.get_logger()

class RockyBrainProcessor(FrameProcessor):
    """
    Pipecat Processor that bridges to the Backend's brain (Letta + Tools).
    It receives a TranscriptionFrame (from STT) and emits TextFrames (to TTS).
    """

    def __init__(self, sid: str, backend_url: str = "http://127.0.0.1:8000"):
        super().__init__()
        self._sid = sid
        self._backend_url = backend_url
        self._client = httpx.AsyncClient(timeout=60.0)
        self._flow_manager = None
        self._is_processing = False

    def set_flow_manager(self, flow_manager):
        self._flow_manager = flow_manager

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMContextFrame):
            # Get the last user message
            user_msg = frame.context.messages[-1]
            if user_msg["role"] != "user" or self._is_processing:
                await self.push_frame(frame)
                return

            self._is_processing = True
            try:
                text = user_msg["content"]
                log.info("brain_received_context", text=text, context_len=len(frame.context.messages))
                
                # Hardened Hallucination filter (catches Whisper artifacts and instruction leakage)
                text_lc = text.strip().lower().strip(" .?!")
                leakage_phrases = [
                    "ignore portuguese", "strictly english", "thank you for watching", 
                    "like and subscribe", "please subscribe", "thanks for watching",
                    "subscribe to the channel", "transcription by", "subtitle by",
                    "you for watching", "watching for watching", "you.", "bye.",
                    "i'll see you in the next one", "hope you enjoyed", "be sure to like"
                ]
                
                # Filter if it contains leakage phrases OR is just a single common word/artifact OR is too short
                if (any(phrase in text_lc for phrase in leakage_phrases) or 
                    text_lc in ["you", "bye", "obrigado", "e ai", "e aí", "pessoal", "galera", "boa tarde", "bom dia", "boa noite"] or 
                    len(text_lc) < 3):
                    log.info("brain_leakage_filtered", text=text)
                    return
                
                # Prepare context for backend
                # We send the full context (including system prompts from the Flow)
                backend_payload = {
                    "sid": self._sid,
                    "content": text,
                    "context": frame.context.messages # Pass the full Pipecat context to Letta
                }

                max_retries = 2
                for attempt in range(max_retries):
                    try:
                        async with self._client.stream(
                            "POST",
                            f"{self._backend_url}/api/brain/chat",
                            json=backend_payload,
                            timeout=30.0
                        ) as resp:
                            resp.raise_for_status()
                            full_response = ""
                            text_buffer = ""
                            async for chunk in resp.aiter_text():
                                if chunk:
                                    full_response += chunk
                                    text_buffer += chunk
                                    
                                    # Aggregation logic: push to TTS only when we have a natural break (word or sentence)
                                    # to ensure Rocky finishes words properly and intonation is better.
                                    if any(p in chunk for p in " .?!,;:\n\r\t"):
                                        await self.push_frame(TextFrame(text=text_buffer))
                                        text_buffer = ""
                            
                            # Flush any remaining text in the buffer
                            if text_buffer.strip():
                                await self.push_frame(TextFrame(text=text_buffer))
                            
                            # Post-process response for Flow transitions
                            # If Rocky says specific keywords, we trigger the FlowManager
                            if self._flow_manager:
                                if "entering situation room" in full_response.lower() or "status report" in full_response.lower():
                                    await self._flow_manager.transition_to("situation_room")
                                elif "standby" in full_response.lower() or "idle" in full_response.lower():
                                    await self._flow_manager.transition_to("idle")
                                elif "executing command" in full_response.lower() or "changing system" in full_response.lower():
                                    await self._flow_manager.transition_to("active_command")

                        break # Success
                    except Exception as e:
                        if attempt == max_retries - 1:
                            log.error("brain_error_final", error=str(e), text=text)
                            await self.push_frame(TextFrame(text="Rocky brain hurt. Sorry."))
                        else:
                            log.warning("brain_retry", attempt=attempt+1, error=str(e))
                            await asyncio.sleep(0.5)
            finally:
                self._is_processing = False
        else:
            await self.push_frame(frame)

    async def cleanup(self):
        await self._client.aclose()
