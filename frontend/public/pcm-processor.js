const LOG_TAG = "[PCMProcessor]";

function log(level, msg, data = "") {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${LOG_TAG} [${level}]`;
  console.log(`${prefix} ${msg}`, data);
}

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    log("info", "Constructor called");

    this._gain = 2.0;  // Safe gain to ensure clarity without clipping
    this._targetSampleRate = 16000;
    this._inputSampleRate = sampleRate;
    this._resampleRatio = this._inputSampleRate / this._targetSampleRate;

    // Linear interpolation state
    this._readPosition = 0.0;
    this._prevSample = 0.0;

    this._bufferSize = 1024;
    this._buffer = new Int16Array(this._bufferSize);
    this._bufferIndex = 0;
    this._chunkCount = 0;

    log("info", "Initialized", {
      inputRate: this._inputSampleRate,
      targetRate: this._targetSampleRate,
      ratio: this._resampleRatio.toFixed(2),
    });
  }

  process(inputs, outputs, parameters) {
    try {
      const input = inputs[0];
      if (!input || input.length === 0) {
        log("warn", "No audio input");
        return true;
      }

      const channelData = input[0];
      if (!channelData || channelData.length === 0) {
        log("warn", "No channel data");
        return true;
      }

      const len = channelData.length;

      // Linear interpolation resampling
      while (this._readPosition < len) {
        const intPart = Math.floor(this._readPosition);
        const frac = this._readPosition - intPart;

        const curr = Math.max(-1, Math.min(1, channelData[intPart] * this._gain));
        const prev = intPart > 0
          ? Math.max(-1, Math.min(1, channelData[intPart - 1] * this._gain))
          : this._prevSample;

        const interpolated = prev + (curr - prev) * frac;
        const int16Sample = interpolated < 0
          ? interpolated * 0x8000
          : interpolated * 0x7FFF;

        this._buffer[this._bufferIndex++] = int16Sample;

        if (this._bufferIndex >= this._bufferSize) {
          this.sendBuffer();
        }

        this._readPosition += this._resampleRatio;
      }

      this._prevSample = Math.max(-1, Math.min(1, channelData[len - 1] * this._gain));
      this._readPosition -= len;
      if (this._readPosition < 0) this._readPosition = 0;

      return true;
    } catch (err) {
      log("error", "Process error", err.message);
      return true;
    }
  }

  sendBuffer() {
    try {
      // Convert Int16Array to Uint8Array for binary transmission
      const uint8View = new Uint8Array(this._buffer.buffer);

      // Transfer ownership of the buffer to avoid copying (zero-copy)
      this.port.postMessage(
        {
          type: "pcm",
          pcmData: uint8View,
          timestamp: Date.now(),
          chunkNumber: this._chunkCount++,
        },
        [this._buffer.buffer]  // Transfer ownership of the ArrayBuffer
      );

      this._buffer = new Int16Array(this._bufferSize);
      this._bufferIndex = 0;

      if (this._chunkCount % 100 === 0) {
        log("info", "Chunks processed", { count: this._chunkCount });
      }
    } catch (err) {
      log("error", "Send buffer error", err.message);
    }
  }
}

registerProcessor('pcm-processor', PCMProcessor);
log("info", "PCMProcessor registered successfully");

