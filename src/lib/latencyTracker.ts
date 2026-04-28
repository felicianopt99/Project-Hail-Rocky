import { createTag } from "./logger";

const log = createTag("LatencyTracker");

export interface LatencyReport {
  traceId: string;
  stt_duration_ms: number;
  llm_ttft_ms: number;      // Time to First Token (from LLM_START)
  llm_total_duration_ms: number;
  total_pipeline_ms: number;
  stages: Record<string, number>;
}

class LatencyTracker {
  private traces: Map<string, Record<string, number>> = new Map();

  start(traceId: string) {
    this.traces.set(traceId, { pipeline_start: Date.now() });
  }

  mark(traceId: string, stage: string) {
    const trace = this.traces.get(traceId);
    if (trace) {
      trace[stage] = Date.now();
    }
  }

  getReport(traceId: string): LatencyReport | null {
    const trace = this.traces.get(traceId);
    if (!trace || !trace.pipeline_start) return null;

    const stt_duration = (trace.stt_end && trace.stt_start) ? trace.stt_end - trace.stt_start : 0;
    const llm_ttft = (trace.llm_first_token && trace.llm_start) ? trace.llm_first_token - trace.llm_start : 0;
    const llm_total = (trace.llm_end && trace.llm_start) ? trace.llm_end - trace.llm_start : 0;
    const total = Date.now() - trace.pipeline_start;

    return {
      traceId,
      stt_duration_ms: stt_duration,
      llm_ttft_ms: llm_ttft,
      llm_total_duration_ms: llm_total,
      total_pipeline_ms: total,
      stages: trace
    };
  }

  printReport(traceId: string) {
    const report = this.getReport(traceId);
    if (!report) return;

    console.log("\n" + "=".repeat(50));
    console.log(`⏱️  ROCKY LATENCY REPORT [${traceId}]`);
    console.log("=".repeat(50));
    
    const tableData = [
      { Stage: "STT (Transcription)", "Duration (ms)": report.stt_duration_ms },
      { Stage: "LLM TTFT (First Token)", "Duration (ms)": report.llm_ttft_ms },
      { Stage: "LLM Total (Thinking)", "Duration (ms)": report.llm_total_duration_ms },
      { Stage: "TOTAL PIPELINE", "Duration (ms)": report.total_pipeline_ms },
    ];

    console.table(tableData);
    
    if (report.total_pipeline_ms > 2000) {
      log.warn("🚨 High latency detected in pipeline!");
    } else {
      log.info("✅ Pipeline performance within limits.");
    }
    console.log("=".repeat(50) + "\n");

    // Cleanup
    this.traces.delete(traceId);
  }
}

export const latencyTracker = new LatencyTracker();
