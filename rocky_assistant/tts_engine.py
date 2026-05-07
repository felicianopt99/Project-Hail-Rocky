import asyncio
import edge_tts
import pygame
import tempfile
import os
from . import config

class TTSEngine:
    def __init__(self):
        pygame.mixer.init()

    def speak(self, text):
        """Synthesizes text and plays it."""
        if not text:
            return

        print(f"[TTS] Rocky: {text}")
        
        if config.TTS_PROVIDER == "edge-tts":
            asyncio.run(self._edge_speak(text))
        else:
            self._pyttsx3_speak(text)

    async def _edge_speak(self, text):
        communicate = edge_tts.Communicate(text, config.EDGE_VOICE)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp:
            await communicate.save(tmp.name)
            tmp_path = tmp.name

        try:
            pygame.mixer.music.load(tmp_path)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                await asyncio.sleep(0.1)
        finally:
            pygame.mixer.music.unload()
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def _pyttsx3_speak(self, text):
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.say(text)
            engine.runAndWait()
        except ImportError:
            print("[!] pyttsx3 não instalado.")
