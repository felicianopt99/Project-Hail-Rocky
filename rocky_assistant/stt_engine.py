import speech_recognition as sr
import io
from . import config

class STTEngine:
    def __init__(self):
        self.recognizer = sr.Recognizer()

    def transcribe(self, audio_bytes):
        """Transcribes audio bytes to text."""
        audio_data = io.BytesIO(audio_bytes)
        with sr.AudioFile(audio_data) as source:
            audio = self.recognizer.record(source)
        
        try:
            if config.STT_MODEL == "google":
                text = self.recognizer.recognize_google(audio, language=config.GOOGLE_LANGUAGE)
                print(f"[STT] Google: {text}")
                return text
            else:
                # Placeholder for other models (like local whisper)
                print("[!] Modelo STT não suportado configurado.")
                return ""
        except sr.UnknownValueError:
            print("[STT] Não entendi o áudio.")
            return ""
        except sr.RequestError as e:
            print(f"[STT] Erro na API do Google: {e}")
            return ""
