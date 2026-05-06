# Audio Fixtures for Rocky Voice Pipeline

To test the STT pipeline, you need a real voice recording.
The expected format is:
- Sample Rate: 16000 Hz
- Channels: 1 (Mono)
- Format: 16-bit Signed PCM (S16LE)

## Generation via FFmpeg

If you have a voice recording `input.wav`, convert it using:

```bash
ffmpeg -i input.wav -ar 16000 -ac 1 -sample_fmt s16 tests/fixtures/hello_rocky.wav
```

## Generation via Python (Quick Placeholder)

You can use the following snippet to generate a "silent" or "noise" wav if needed, but for STT you should use a real voice.

```python
import wave
import struct

with wave.open("hello_rocky.wav", "w") as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(16000)
    # 2 seconds of silence
    for _ in range(32000):
        f.writeframesraw(struct.pack("<h", 0))
```
