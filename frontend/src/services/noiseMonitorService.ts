import { createTag } from "../lib/logger";

const log = createTag("NoiseMonitor");

export interface EnvironmentalState {
  noiseFloor: number;
  isNoisy: boolean;
  detectedTypes: ("fan" | "tv" | "speech")[];
  confidence: number;
}

export class NoiseMonitorService {
  private noiseFloor = 0.005; // Base energy floor
  private energyHistory: number[] = [];
  private zcrHistory: number[] = [];
  private readonly HISTORY_SIZE = 50; // ~6 seconds of history at 128ms chunks

  /**
   * Analyzes a PCM audio chunk (Int16)
   */
  analyzeChunk(chunk: Buffer): EnvironmentalState {
    const samples = chunk.length / 2;
    let sumSq = 0;
    let zeroCrossings = 0;
    let lastSample = 0;

    for (let i = 0; i < samples; i++) {
      const sample = chunk.readInt16LE(i * 2) / 32768.0;
      sumSq += sample * sample;
      
      if ((sample > 0 && lastSample <= 0) || (sample < 0 && lastSample >= 0)) {
        zeroCrossings++;
      }
      lastSample = sample;
    }

    const rms = Math.sqrt(sumSq / samples);
    const zcr = zeroCrossings / samples;

    this.updateHistory(rms, zcr);

    const state = this.evaluateEnvironment();
    
    // Log occasionally
    if (Math.random() < 0.05) {
      log.debug("Environment update", { 
        rms: rms.toFixed(4), 
        noiseFloor: this.noiseFloor.toFixed(4),
        isNoisy: state.isNoisy,
        types: state.detectedTypes 
      });
    }

    return state;
  }

  private updateHistory(rms: number, zcr: number) {
    this.energyHistory.push(rms);
    if (this.energyHistory.length > this.HISTORY_SIZE) this.energyHistory.shift();

    this.zcrHistory.push(zcr);
    if (this.zcrHistory.length > this.HISTORY_SIZE) this.zcrHistory.shift();

    // Adaptive Noise Floor: Minimum energy over history, with slow upward drift
    const minEnergy = Math.min(...this.energyHistory);
    this.noiseFloor = this.noiseFloor * 0.95 + minEnergy * 0.05;
  }

  private evaluateEnvironment(): EnvironmentalState {
    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    
    // Variance in energy (high variance = TV or Speech, low variance = Fan)
    const energyVariance = this.calculateVariance(this.energyHistory);
    
    const detectedTypes: ("fan" | "tv" | "speech")[] = [];
    let isNoisy = avgEnergy > 0.05;

    // 1. Fan detection: High-ish steady energy, low variance, consistent ZCR
    if (avgEnergy > this.noiseFloor * 1.5 && energyVariance < 0.0001) {
      detectedTypes.push("fan");
    }

    // 2. TV detection: Higher energy than floor, moderate variance, variable ZCR
    // (TV audio is usually more compressed/steady than real human speech near the mic)
    if (avgEnergy > this.noiseFloor * 2 && energyVariance >= 0.0001 && energyVariance < 0.001) {
      detectedTypes.push("tv");
    }

    // 3. Speech candidate: High variance
    if (energyVariance > 0.001) {
      detectedTypes.push("speech");
    }

    return {
      noiseFloor: this.noiseFloor,
      isNoisy,
      detectedTypes,
      confidence: Math.min(avgEnergy / 0.1, 1.0)
    };
  }

  private calculateVariance(data: number[]): number {
    if (data.length === 0) return 0;
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    return data.reduce((a, b) => a + (b - avg) ** 2, 0) / data.length;
  }

  get currentNoiseFloor(): number {
    return this.noiseFloor;
  }
}

export const noiseMonitor = new NoiseMonitorService();
