import asyncio
import signal
import sys
from .audio_engine import AudioEngine
from .stt_engine import STTEngine
from .llm_engine import LLMEngine
from .tts_engine import TTSEngine
from . import config

class RockyAssistant:
    def __init__(self):
        self.audio = AudioEngine()
        self.stt = STTEngine()
        self.llm = LLMEngine()
        self.tts = TTSEngine()
        self.running = True

    def stop(self, signum, frame):
        print("\n[*] Desligando Rocky...")
        self.running = False
        self.audio.stop_stream()
        sys.exit(0)

    async def run(self):
        print("--- Rocky Voice Assistant Started ---")
        signal.signal(signal.SIGINT, self.stop)
        
        self.audio.start_stream()

        while self.running:
            # 1. Passive Listening
            if self.audio.listen_for_wake_word():
                # 2. Feedback (Beep)
                self.audio.play_audio(config.BEEP_PATH)
                
                # 3. Capture Command (Active Listening with VAD)
                audio_command = self.audio.record_command()
                
                # 4. Transcribe (STT)
                text_command = self.stt.transcribe(audio_command)
                
                if text_command:
                    # 5. Process (LLM)
                    response_text = await self.llm.get_response(text_command)
                    
                    # 6. Speak (TTS)
                    if response_text:
                        self.tts.speak(response_text)
                else:
                    print("[*] Nenhum comando detectado.")

if __name__ == "__main__":
    assistant = RockyAssistant()
    asyncio.run(assistant.run())
