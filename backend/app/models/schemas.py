from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

class ChatRequest(BaseModel):
    content: str

class ControlDeviceRequest(BaseModel):
    device: str
    action: str
    params: Optional[Dict[str, Any]] = Field(default_factory=dict)

class SetModeRequest(BaseModel):
    mode: str

class SystemStateUpdate(BaseModel):
    messages: List[Dict[str, Any]]
    logs: List[Dict[str, Any]]
    lights: Dict[str, Any]
    systemMode: str
    availableDevices: List[str]
    protocols: List[Dict[str, Any]]
    weather: Dict[str, Any]
