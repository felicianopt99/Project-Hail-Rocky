import * as ort from "onnxruntime-node";
import path from "path";
import { createTag } from "../lib/logger";

const log = createTag("VadService");

// Cap accumulation at 2s of audio @ 16kHz to prevent unbounded growth
const MAX_ACCUMULATION_SAMPLES = 32000;

export interface VadState {
  tensorState: ort.Tensor;
  accumulationBuffer: Float32Array;
  probHistory: number[];
}

export class VadService {
  private session: ort.InferenceSession | null = null;
  private sampleRate: number = 16000;
  private srTensor: ort.Tensor | null = null;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  async ensureInitialized() {
    await this.initPromise;
  }

  private async init() {
    try {
      const modelPath = path.join(process.cwd(), "models", "silero_vad.onnx");
      log.info("[VAD-INIT] Attempting to load Silero VAD model", {
        cwd: process.cwd(),
        modelPath: modelPath
      });

      this.session = await ort.InferenceSession.create(modelPath);
      this.srTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(this.sampleRate)]), [1]);

      log.info("[VAD-INIT] ✅ Silero VAD initialized successfully", {
        inputs: this.session.inputNames,
        outputs: this.session.outputNames,
        sampleRate: this.sampleRate
      });
    } catch (err: any) {
      log.error("[VAD-INIT] ❌ CRITICAL: Failed to initialize Silero VAD", {
        error: err.message,
        code: err.code,
        stack: err.stack,
        cwd: process.cwd()
      });
      log.error("[VAD-INIT] This means speech detection will ALWAYS return 0!");
      // Re-throw to ensure caller knows initialization failed
      throw err;
    }
  }

  get isReady(): boolean {
    return this.session !== null;
  }

  /**
   * Creates a fresh state object for a new session.
   */
  createState(): VadState {
    return {
      tensorState: new ort.Tensor("float32", new Float32Array(2 * 1 * 128).fill(0), [2, 1, 128]),
      accumulationBuffer: new Float32Array(0),
      probHistory: []
    };
  }

  /**
   * Processes a chunk of audio with session-specific state.
   */
  async isSpeech(state: VadState, chunk: Buffer): Promise<number> {
    // Ensure initialization is complete before processing
    await this.ensureInitialized();

    if (!this.session || !this.srTensor) {
      log.error("[VAD-INFERENCE] ❌ CRITICAL: VAD session not initialized! Returning 0", {
        sessionExists: !!this.session,
        srTensorExists: !!this.srTensor
      });
      return 0;
    }

    const startTime = performance.now();
    const HISTORY_SIZE = 8; // Smoother transitions, better for pausing

    try {
      // 1. Efficient Int16 to Float32 conversion
      const samples = chunk.length / 2;
      const float32Data = new Float32Array(samples);

      let maxVal = 0;
      for (let i = 0; i < samples; i++) {
        const s = chunk.readInt16LE(i * 2) / 32768.0;
        float32Data[i] = s;
        if (Math.abs(s) > maxVal) maxVal = Math.abs(s);
      }

      if (maxVal < 0.001 && samples > 0) {
        // Log extremely quiet chunks occasionally
        if (Math.random() < 0.01) log.debug("Processing near-silent chunk", { maxVal: maxVal.toFixed(6) });
      }

      // 2. Accumulate in session buffer
      const combined = new Float32Array(state.accumulationBuffer.length + samples);
      combined.set(state.accumulationBuffer);
      combined.set(float32Data, state.accumulationBuffer.length);
      state.accumulationBuffer = combined.length > MAX_ACCUMULATION_SAMPLES
        ? combined.slice(-MAX_ACCUMULATION_SAMPLES)
        : combined;

      // 3. Optimal windowing loop (512 samples @ 16kHz = 32ms)
      // Silero VAD v5 expects sequential, non-overlapping chunks.
      let latestProb = 0;
      while (state.accumulationBuffer.length >= 512) {
        const inputData = state.accumulationBuffer.slice(0, 512);
        // Advance buffer (50% overlap for better resolution/compatibility)
        state.accumulationBuffer = state.accumulationBuffer.slice(256);

        const input = new ort.Tensor("float32", inputData, [1, 512]);
        
        // 4. Run inference using session's tensorState
        const results = await this.session.run({
          input: input,
          state: state.tensorState,
          sr: this.srTensor
        });

        // Update session state (stateful inference)
        const nextState = results.stateN ?? results.out_state ?? results.output_state ?? results.state;
        if (nextState) state.tensorState = nextState;

        // Extract probability - handle different output formats
        let outputTensor = results.output;
        if (!outputTensor && results.output_prob) outputTensor = results.output_prob;

        if (outputTensor && outputTensor.data) {
          latestProb = outputTensor.data[0] as number;
        } else if (outputTensor && Array.isArray(outputTensor)) {
          latestProb = outputTensor[0] as number;
        } else {
          latestProb = outputTensor as unknown as number;
        }

        // Clamp to [0, 1]
        latestProb = Math.max(0, Math.min(1, latestProb));

        log.info("[VAD-INFERENCE-DEBUG] Raw output", {
          outputKeys: Object.keys(results),
          outputType: typeof outputTensor,
          outputValue: latestProb.toFixed(4),
          outputTensorData: outputTensor?.data ? Array.from(outputTensor.data).slice(0, 3) : "no data"
        });

        // DEBUG: Log ALL inference results every time
        log.info("[VAD-INFERENCE] Speech probability", {
          prob: latestProb.toFixed(4),
          accumBufLen: state.accumulationBuffer.length,
          historySize: state.probHistory.length,
          outputKeys: Object.keys(results),
          sr: this.srTensor
        });
        
        // 5. Smoothing (Reduced history for faster reaction to speech end)
        state.probHistory.push(latestProb);
        if (state.probHistory.length > HISTORY_SIZE) state.probHistory.shift();
      }

      const smoothProb = state.probHistory.length > 0 
        ? state.probHistory.reduce((a, b) => a + b, 0) / state.probHistory.length
        : 0;
      
      if (smoothProb > 0.3) {
        log.debug(`Speech probability`, { prob: smoothProb.toFixed(3), detected: smoothProb > 0.65 });
      }

      const duration = performance.now() - startTime;
      if (duration > 15) {
        log.warn(`VAD latency warning`, { duration: duration.toFixed(2) + "ms" });
      }

      return smoothProb;
    } catch (err: any) {
      log.error("VAD Inference failure", { error: err.message });
      return 0;
    }
  }
}

export const vadService = new VadService();
