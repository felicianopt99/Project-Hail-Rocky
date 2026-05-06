from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict

class ChatResponse(BaseModel):
    text: str

class ChatError(BaseModel):
    message: str

class SpeakerIdentified(BaseModel):
    name: str

class SpeakerChanged(BaseModel):
    from_name: str = Field(alias="from")
    to: str

    class Config:
        populate_by_name = True

class TimerFired(BaseModel):
    label: str

class ServiceStatus(BaseModel):
    service: str
    ok: bool

class UiHint(BaseModel):
    type: str
    value: Any

class TtsStart(BaseModel):
    sampleRate: int

class SystemStateUpdate(BaseModel):
    emotional_state: Optional[str] = None
    intimacy: Optional[float] = None
    intimacy_label: Optional[str] = None
    logs: Optional[List[Dict[str, Any]]] = None
    lights: Optional[Dict[str, Any]] = None
    areas: Optional[Dict[str, str]] = None
    weather: Optional[Dict[str, Any]] = None
    protocols: Optional[List[Dict[str, Any]]] = None

class DeviceUpdated(BaseModel):
    device: str
    state: Dict[str, Any]

class ProtocolUpdated(BaseModel):
    id: str
    settings: Dict[str, Any]

class ProtocolDeleted(BaseModel):
    id: str
