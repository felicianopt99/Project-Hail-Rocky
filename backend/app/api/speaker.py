"""
Speaker management endpoints.

GET  /api/speaker/profiles          — list enrolled speakers
POST /api/speaker/profiles          — create profile (body: {name})
POST /api/speaker/profiles/{id}/enroll — enroll audio (body: raw PCM bytes)
DELETE /api/speaker/profiles/{id}   — remove profile
"""
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from ..bridges import azure_speaker
from ..config import settings
from .auth import get_current_user

router = APIRouter()


class CreateProfileRequest(BaseModel):
    name: str


@router.get("")
async def list_profiles():
    if not settings.has_speaker_id():
        return {"available": False, "note": "Set AZURE_SPEAKER_KEY in .env to enable speaker recognition."}
    profiles = await azure_speaker.list_profiles()
    return {"available": True, "profiles": profiles}


@router.post("")
async def create_profile(body: CreateProfileRequest, _user: dict = Depends(get_current_user)):
    if not settings.has_speaker_id():
        raise HTTPException(503, "Azure Speaker Recognition not configured.")
    profile_id = await azure_speaker.create_profile(body.name.strip())
    if not profile_id:
        raise HTTPException(500, "Failed to create profile in Azure.")
    return {"profile_id": profile_id, "name": body.name, "status": "created"}


@router.post("/{profile_id}/enroll")
async def enroll(profile_id: str, request: Request):
    """
    Send raw PCM audio (16kHz, 16-bit mono) as request body.
    Azure needs ~20 seconds of speech total across one or more calls.
    Returns enrollment status and remaining seconds needed.
    """
    if not settings.has_speaker_id():
        raise HTTPException(503, "Azure Speaker Recognition not configured.")
    pcm = await request.body()
    if len(pcm) < 8000:
        raise HTTPException(400, "Audio too short — send at least 0.5 seconds of speech.")
    result = await azure_speaker.enroll(profile_id, pcm)
    if result.get("status") == "error":
        raise HTTPException(500, result.get("error", "Enrollment failed."))
    return result


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str, _user: dict = Depends(get_current_user)):
    if not settings.has_speaker_id():
        raise HTTPException(503, "Azure Speaker Recognition not configured.")
    ok = await azure_speaker.delete_profile(profile_id)
    if not ok:
        raise HTTPException(500, "Failed to delete profile.")
    return {"deleted": profile_id}
