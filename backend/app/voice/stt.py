"""STT via Groq Whisper API. Falls back gracefully when key is absent."""
import httpx
import structlog
import numpy as np
import io
import wave

from ..config import settings

log = structlog.get_logger()

# Singleton HTTP client — reuses connections across requests
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=20.0,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        )
    return _client


_WEBM_MAGIC = b'\x1a\x45\xdf\xa3'  # EBML header — all WebM/MKV files start with this
_OGG_MAGIC  = b'OggS'
_MP4_MAGIC  = b'ftyp'


def _is_encoded_audio(raw: bytes) -> tuple[bool, str]:
    """Return (True, mime_type) if raw bytes are a self-contained encoded audio container."""
    if raw[:4] == _WEBM_MAGIC:
        return True, "audio/webm"
    if raw[:4] == _OGG_MAGIC:
        return True, "audio/ogg"
    if len(raw) >= 8 and raw[4:8] == _MP4_MAGIC:
        return True, "audio/mp4"
    return False, ""


async def transcribe(audio_bytes: bytes | bytearray, filename: str = "audio.wav", language: str | None = None) -> str:
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY not set — STT unavailable")

    raw = bytes(audio_bytes)
    is_encoded, mime_type = _is_encoded_audio(raw)

    if is_encoded:
        ext = mime_type.split("/")[1]  # "webm", "ogg", "mp4"
        send_filename = f"speech.{ext}"
        audio_data = raw
        log.info("stt_encoded_audio", format=ext, size_kb=len(raw) / 1024)
    else:
        # Raw PCM — check energy of the whole clip to prevent noise hallucinations
        samples = np.frombuffer(raw, dtype=np.int16)
        if len(samples) > 0:
            total_energy = np.sqrt(np.mean(samples.astype(np.float32) ** 2))
            if total_energy < 80: # Filter out background noise
                log.info("stt_skipped_low_energy", energy=total_energy)
                return ""

        # Raw PCM — wrap in WAV container for Whisper
        sample_rate = 16000
        # Trim trailing silence logic (optional but helpful)
        trim_samples = int(sample_rate * 0.5)
        if len(raw) > trim_samples * 2:
            last_seg = np.frombuffer(raw[-trim_samples * 2:], dtype=np.int16)
            energy = np.sqrt(np.mean(last_seg.astype(np.float32) ** 2))
            if energy < 50:
                raw = raw[: -trim_samples * 2]

        with io.BytesIO() as wav_io:
            with wave.open(wav_io, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(raw)
            audio_data = wav_io.getvalue()

        send_filename = "speech.wav"
        log.info("stt_pcm_wrapped", size_kb=len(audio_data) / 1024)

    client = _get_client()
    files = {"file": (send_filename, audio_data)}
    
    # Priority: 1. explicit arg, 2. settings (env), 3. auto-detect (if supported by backend)
    lang = language or settings.groq_stt_language.strip()
    if lang == "auto":
        lang = None # Groq auto-detects if language is omitted

    data = {
        "model": "whisper-large-v3",
        "prompt": "Rocky, an alien engineer assistant. Short, technical commands. Transcribe strictly what is heard.",
    }
    if lang:
        data["language"] = lang

    resp = await client.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        files=files,
        data=data,
    )
    
    if resp.status_code != 200:
        log.error("stt_api_error", status=resp.status_code, body=resp.text)
        return ""

    text = resp.json().get("text", "").strip()

    # Filter out common hallucinations based on the prompt or short noise
    hallucinations = [
        "focused on clear transcription.", 
        "conversa em português", 
        "obrigado.", 
        "thank you.",
        "e ai", "e aí",
        "thank you for watching.",
        "please like and subscribe.",
        "ignore portuguese",
        "strictly english",
        "subscribe to the channel",
        "you",
        "bye.",
        "pessoal.", "galera."
    ]
    if text.lower() in hallucinations or len(text) < 2:
        log.info("stt_hallucination_filtered", text=text)
        return ""

    log.info("stt_done", chars=len(text), text=text[:60])
    return text
