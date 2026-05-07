import wave
import struct
import math
import os
from pathlib import Path

def generate_beep(output_path, frequency=880, duration=0.2, volume=0.5):
    """Generates a simple sine wave beep."""
    sample_rate = 16000
    num_samples = int(duration * sample_rate)
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with wave.open(output_path, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        
        for i in range(num_samples):
            value = int(volume * 32767.0 * math.sin(2.0 * math.pi * frequency * i / sample_rate))
            data = struct.pack('<h', value)
            wf.writeframesraw(data)

if __name__ == "__main__":
    assets_dir = Path(__file__).parent / "assets"
    beep_file = assets_dir / "beep.wav"
    generate_beep(str(beep_file))
    print(f"[*] Beep gerado em: {beep_file}")
