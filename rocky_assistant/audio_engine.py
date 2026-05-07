import pyaudio
import numpy as np
import openwakeword
from openwakeword.model_manager import ModelManager
import webrtcvad
import wave
import time
import io
import os
from . import config

class AudioEngine:
    def __init__(self):
        self.pa = pyaudio.PyAudio()
        self.vad = webrtcvad.Vad(config.VAD_AGGRESSIVENESS)
        
        # Initialize openWakeWord
        self.model_manager = ModelManager(
            inference_framework="onnx",
            models=[config.WAKE_WORD_MODEL_PATH]
        )
        self.wake_word_name = list(self.model_manager.models.keys())[0]
        
        self.stream = None

    def start_stream(self):
        self.stream = self.pa.open(
            format=pyaudio.paInt16,
            channels=config.CHANNELS,
            rate=config.RATE,
            input=True,
            frames_per_buffer=config.CHUNK
        )

    def stop_stream(self):
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None

    def listen_for_wake_word(self):
        """Infinite loop waiting for wake word."""
        print(f"[*] Escutando por '{self.wake_word_name}'...")
        if not self.stream:
            self.start_stream()

        while True:
            data = self.stream.read(config.CHUNK, exception_on_overflow=False)
            audio_frame = np.frombuffer(data, dtype=np.int16)
            
            # Predict wake word
            prediction = self.model_manager.predict(audio_frame)
            if prediction[self.wake_word_name] > config.WAKE_WORD_THRESHOLD:
                print(f"[!] Wake Word Detectada! ({prediction[self.wake_word_name]:.2f})")
                return True

    def record_command(self):
        """Records audio until silence is detected."""
        print("[*] Gravando comando...")
        frames = []
        silent_chunks = 0
        max_silent_chunks = int(config.SILENCE_TIMEOUT * config.RATE / config.CHUNK)
        
        # Minimum recording time to avoid instant cutoff
        min_chunks = 10 
        chunks_recorded = 0

        while True:
            data = self.stream.read(config.CHUNK, exception_on_overflow=False)
            frames.append(data)
            chunks_recorded += 1

            # VAD check (VAD requires 10, 20, or 30ms frames. 
            # Our chunk is 1280 samples @ 16kHz = 80ms. 
            # We need to split it to check VAD properly if needed, 
            # or just use a compatible chunk size.)
            
            # For simplicity, we check VAD on sub-frames of 30ms (480 samples)
            is_speech = False
            sub_chunk_size = 480 # 30ms
            for i in range(0, len(data), sub_chunk_size * 2): # *2 for 16-bit
                sub_frame = data[i:i + sub_chunk_size * 2]
                if len(sub_frame) < sub_chunk_size * 2:
                    break
                if self.vad.is_speech(sub_frame, config.RATE):
                    is_speech = True
                    break
            
            if not is_speech:
                silent_chunks += 1
            else:
                silent_chunks = 0

            if silent_chunks > max_silent_chunks and chunks_recorded > min_chunks:
                print("[*] Silêncio detectado. Parando gravação.")
                break
        
        return self._save_to_bytes(frames)

    def _save_to_bytes(self, frames):
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wf:
            wf.setnchannels(config.CHANNELS)
            wf.setsampwidth(self.pa.get_sample_size(pyaudio.paInt16))
            wf.setframerate(config.RATE)
            wf.writeframes(b''.join(frames))
        return buffer.getvalue()

    def play_audio(self, file_path):
        """Plays a wav file."""
        if not os.path.exists(file_path):
            print(f"[!] Arquivo não encontrado: {file_path}")
            return

        try:
            import pygame
            pygame.mixer.init()
            pygame.mixer.music.load(file_path)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                time.sleep(0.1)
        except ImportError:
            # Fallback to simple wave play if pygame is not available
            wf = wave.open(file_path, 'rb')
            p = pyaudio.PyAudio()
            stream = p.open(format=p.get_format_from_width(wf.getsampwidth()),
                            channels=wf.getnchannels(),
                            rate=wf.getframerate(),
                            output=True)
            data = wf.readframes(1024)
            while data:
                stream.write(data)
                data = wf.readframes(1024)
            stream.stop_stream()
            stream.close()
            p.terminate()
