FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    espeak-ng \
    libsndfile1 \
    libportaudio2 \
    libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ONNX runtime and pedalboard (CPU optimized)
RUN pip install --no-cache-dir \
    pipecat-ai[daily,deepgram,openai]>=0.0.45 \
    kokoro-onnx>=0.3.0 \
    onnxruntime>=1.16.0 \
    pedalboard>=0.7.0 \
    numpy>=1.24.0 \
    fastapi>=0.109.0 \
    uvicorn[standard]>=0.27.0 \
    httpx>=0.26.0 \
    pydantic>=2.0.0 \
    structlog>=24.0.0

COPY app/ ./app/

# Models are stored in /models volume
ENV MODELS_DIR=/models
ENV VOICE_ENGINE_DEFAULT_VOICE=am_michael

EXPOSE 8880

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8880"]
