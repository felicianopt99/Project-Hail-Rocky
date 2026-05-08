import sys
import os
import asyncio
import time
import json
import structlog
from pipecat.frames.frames import Frame, TextFrame, TranscriptionFrame, LLMContextFrame, CancelFrame
from pipecat.processors.frame_processor import FrameProcessor

# Add repository root to sys.path to allow importing from backend
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from backend.app.rocky.graph.workflow import rocky_brain_graph
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

log = structlog.get_logger()

class RockyBrainProcessor(FrameProcessor):
    """
    Pipecat Processor that bridges to the Backend's brain using LangGraph.
    It receives a TranscriptionFrame/LLMContextFrame and emits TextFrames via streaming.
    """

    def __init__(self, sid: str, websocket=None, backend_url: str = None):
        super().__init__()
        self._sid = sid
        self._ws = websocket
        # backend_url is kept for signature compatibility but unused
        self._flow_manager = None
        self._is_processing = False
        self._cancel_event = asyncio.Event()

    def set_flow_manager(self, flow_manager):
        self._flow_manager = flow_manager

    async def process_frame(self, frame: Frame, direction):
        if isinstance(frame, CancelFrame):
            self._cancel_event.set()
            await self.push_frame(frame, direction)
            return

        if isinstance(frame, LLMContextFrame):
            # Get the last user message
            user_msg = frame.context.messages[-1]
            if user_msg["role"] != "user" or self._is_processing:
                await self.push_frame(frame, direction)
                return

            self._is_processing = True
            self._cancel_event.clear()
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
                    "i'll see you in the next one", "hope you enjoyed", "be sure to like",
                    "legendado por", "transcrito por", "obrigado por assistir"
                ]
                
                if (any(phrase in text_lc for phrase in leakage_phrases) or 
                    text_lc in ["you", "bye", "obrigado", "e ai", "e aí", "pessoal", "galera", "boa tarde", "bom dia", "boa noite", 
                                "oi", "olá", "ola", "tudo bem", "com licença", "por favor", "sim", "não", "nao"]):
                    log.info("brain_input_filtered", text=text, reason="non_english_or_artifact")
                    return
                
                # Convert Pipecat context to LangChain messages
                messages = []
                for m in frame.context.messages:
                    role = m.get("role")
                    content = m.get("content")
                    if role == "user":
                        messages.append(HumanMessage(content=content))
                    elif role == "assistant":
                        messages.append(AIMessage(content=content))
                    elif role == "system":
                        messages.append(SystemMessage(content=content))

                initial_state = {
                    "messages": messages,
                    "sid": self._sid,
                    "tools_called": []
                }

                if self._ws:
                    await self._ws.send_text(json.dumps({
                        "type": "voice_debug", 
                        "stage": "graph_started",
                        "text": text,
                        "timestamp": time.time()
                    }))

                full_response = ""
                text_buffer = ""

                # Consuming the graph via streaming events
                async for event in rocky_brain_graph.astream_events(initial_state, version='v2'):
                    if self._cancel_event.is_set():
                        log.info("brain_stream_interrupted_by_cancel_frame")
                        break

                    # 1. Handle Streaming Tokens
                    if event['event'] == 'on_chat_model_stream':
                        chunk = event['data']['chunk']
                        # chunk is typically an AIMessageChunk
                        if hasattr(chunk, 'content') and chunk.content:
                            content = chunk.content
                            full_response += content
                            text_buffer += content
                            
                            # Aggregation logic: push to TTS only when we have a natural break
                            if any(p in content for p in " .?!,;:\n\r\t"):
                                await self.push_frame(TextFrame(text=text_buffer), direction)
                                text_buffer = ""

                    # 2. Handle Tool Starts (for UI animations)
                    elif event['event'] == 'on_tool_start':
                        log.info("brain_tool_started", tool=event['name'])
                        if self._ws:
                            await self._ws.send_text(json.dumps({
                                "type": "voice_debug",
                                "stage": "tool_start",
                                "tool": event['name'],
                                "timestamp": time.time()
                            }))

                # Flush any remaining text in the buffer
                if text_buffer.strip():
                    await self.push_frame(TextFrame(text=text_buffer), direction)
                
                # Post-process response for Flow transitions
                if self._flow_manager and full_response:
                    fr_lc = full_response.lower()
                    if "entering situation room" in fr_lc or "status report" in fr_lc:
                        await self._flow_manager.transition_to("situation_room")
                    elif "standby" in fr_lc or "idle" in fr_lc:
                        await self._flow_manager.transition_to("idle")
                    elif "executing command" in fr_lc or "changing system" in fr_lc:
                        await self._flow_manager.transition_to("active_command")

            except Exception as e:
                log.error("brain_graph_error", error=str(e), text=text)
                await self.push_frame(TextFrame(text="Rocky's brain encountered a graph error. Checking internal systems."), direction)
            finally:
                self._is_processing = False
        else:
            await self.push_frame(frame, direction)

    async def cleanup(self):
        # httpx client removed, nothing specific to clean up here for now
        pass
