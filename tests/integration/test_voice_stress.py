import pytest
import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

# Add the voice_engine app to path
voice_engine_path = os.path.join(os.getcwd(), "services/voice_engine")
if voice_engine_path not in sys.path:
    sys.path.append(voice_engine_path)

try:
    from app.pipeline import ErrorRelay
    from pipecat.frames.frames import StartFrame, AudioRawFrame, EndFrame, ErrorFrame
    from pipecat.processors.frame_processor import FrameDirection
except ImportError:
    # Fallback for when pipecat is not installed in the current environment
    # This allows the script to be created even if dependencies are missing locally
    # but it will fail if run without them.
    pass

ASSETS_DIR = Path("tests/assets/massive_set")

def get_all_audio_files():
    if not ASSETS_DIR.exists():
        return []
    return list(ASSETS_DIR.glob("**/*.wav"))

@pytest.mark.asyncio
@pytest.mark.parametrize("audio_path", get_all_audio_files(), ids=lambda p: p.name)
async def test_error_relay_stability(audio_path):
    """
    Validates that the ErrorRelay processor correctly handles lifecycle frames
    and doesn't block StartFrame, even when processing a large variety of audio.
    """
    # 1. Setup Mock WebSocket and ErrorRelay
    mock_ws = AsyncMock()
    relay = ErrorRelay(websocket=mock_ws)
    
    # Track yielded frames
    yielded_frames = []
    
    # Helper to push frames through the relay
    async def process_and_collect(frame):
        async for f in relay.process_frame(frame, FrameDirection.DOWNSTREAM):
            yielded_frames.append(f)

    # 2. Simulate Pipeline Lifecycle
    
    # A. Push StartFrame (CRITICAL: Must not block)
    start_frame = StartFrame()
    await process_and_collect(start_frame)
    
    assert len(yielded_frames) == 1
    assert isinstance(yielded_frames[0], StartFrame), "ErrorRelay blocked StartFrame!"
    
    # B. Push Audio Frame (Should pass through)
    with open(audio_path, "rb") as f:
        audio_data = f.read()
    
    audio_frame = AudioRawFrame(audio=audio_data, sample_rate=16000, num_channels=1)
    await process_and_collect(audio_frame)
    
    assert len(yielded_frames) == 2
    assert isinstance(yielded_frames[1], AudioRawFrame)
    
    # C. Simulate an ErrorFrame (Should be caught and relayed)
    error_frame = ErrorFrame(error="Test simulated error")
    await process_and_collect(error_frame)
    
    # ErrorRelay is supposed to consume ErrorFrames (not yield them)
    # but send a message over the websocket.
    assert len(yielded_frames) == 2 # Still 2, ErrorFrame was consumed
    mock_ws.send_text.assert_called()
    last_call = mock_ws.send_text.call_args[0][0]
    assert "voice_error" in last_call
    
    # D. Push EndFrame
    end_frame = EndFrame()
    await process_and_collect(end_frame)
    
    assert len(yielded_frames) == 3
    assert isinstance(yielded_frames[-1], EndFrame)

@pytest.mark.asyncio
async def test_massive_set_coverage():
    """Verifies that we have at least 100 test files generated."""
    files = get_all_audio_files()
    assert len(files) >= 100, f"Expected at least 100 files, found {len(files)}"
    
    # Check if all categories are present
    categories = {p.parent.name for p in files}
    expected_categories = {"comandos_curtos", "questoes_complexas", "disfluencias_ruido", "hail_mary"}
    assert expected_categories.issubset(categories), f"Missing categories: {expected_categories - categories}"
