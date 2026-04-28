import aiortc
from typing import Optional, Any
from vision_agents.core.edge.edge_transport import EdgeTransport
from vision_agents.core.edge.types import Connection, User
from vision_agents.core.edge.call import Call
from getstream.video.rtc import AudioStreamTrack

class DummyConnection(Connection):
    async def close(self) -> None:
        pass
    async def wait_for_participant(self, timeout: Optional[float] = None) -> None:
        pass
    def idle_since(self) -> float:
        return 0.0

class DummyEdge(EdgeTransport):
    async def authenticate(self, user: User) -> None:
        pass
    async def create_call(self, call_id: str, **kwargs) -> Call:
        return Call(id=call_id)
    def create_audio_track(self) -> AudioStreamTrack:
        # Return a track that does nothing or we can use it to hook into Socket.io later
        return AudioStreamTrack()
    async def close(self):
        pass
    def open_demo(self, *args, **kwargs):
        pass
    async def join(self, agent: Any, call: Call, **kwargs) -> Connection:
        return DummyConnection()
    async def publish_tracks(self, audio_track: Optional[aiortc.MediaStreamTrack], video_track: Optional[aiortc.MediaStreamTrack]):
        pass
    async def create_conversation(self, call: Call, user: User, instructions: str):
        pass
    def add_track_subscriber(self, track_id: str) -> Optional[aiortc.VideoStreamTrack]:
        return None
    async def send_custom_event(self, data: dict[str, Any]) -> None:
        pass
