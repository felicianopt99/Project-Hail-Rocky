import json
from pipecat.frames.frames import (
    CancelFrame,
    Frame,
    InputAudioRawFrame,
    InputTransportMessageFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer

SAMPLE_RATE = 16000


class RawAudioSerializer(FrameSerializer):
    """
    Serializer for the Rocky voice engine WebSocket transport.

    Incoming messages:
      - bytes  → InputAudioRawFrame (raw 16kHz mono int16 PCM from backend bridge)
      - text   → control frame decoded from JSON {"type": "cancel"|"end_of_turn"}

    Outgoing messages (serialize):
      - AudioRawFrame → bytes
      - anything else → None (dropped; JSON events go via JsonMessageRelay instead)
    """

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            if not data:
                return None
            return InputAudioRawFrame(
                audio=data,
                sample_rate=SAMPLE_RATE,
                num_channels=1,
            )

        # Text → JSON control message
        try:
            msg = json.loads(data)
            msg_type = msg.get("type")
            if msg_type == "cancel":
                return CancelFrame()
            if msg_type == "end_of_turn":
                return UserStoppedSpeakingFrame()
            # Unknown control messages forwarded as transport messages
            return InputTransportMessageFrame(message=msg)
        except Exception:
            return None

    async def serialize(self, frame: Frame) -> str | bytes | None:
        from pipecat.frames.frames import AudioRawFrame
        if isinstance(frame, AudioRawFrame):
            return frame.audio
        return None
