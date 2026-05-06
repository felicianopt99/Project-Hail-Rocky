import { useEffect, useRef, useState, useCallback } from "react";
import { useRockyStore } from "../store/useRockyStore";
import { eventBus, RockyEvents } from "../lib/eventBus";

// The socket from our lib/socket.ts is a custom class, not socket.io-client
interface CustomSocket {
  on: (event: string, handler: (data: any) => void) => void;
  off: (event: string, handler: (data: any) => void) => void;
  emit: (event: string, data?: any, callback?: any) => void;
  connected: boolean;
  id?: string;
}

type AudioState = "idle" | "requesting_mic" | "listening" | "processing" | "speaking" | "error";

interface AudioManagerOptions {
  socket: CustomSocket;
  addToast: (msg: string, type: "info" | "error" | "warning") => void;
}

const LOG_TAG = "[AudioManager]";

function log(level: "info" | "warn" | "error", msg: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${LOG_TAG} [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(`${prefix} ${msg}`, data || "");
  } else if (level === "warn") {
    console.warn(`${prefix} ${msg}`, data || "");
  } else {
    console.log(`${prefix} ${msg}`, data || "");
  }
}

export function useAudioManager({ socket, addToast }: AudioManagerOptions) {
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [micAvailable, setMicAvailable] = useState(false);

  // Audio contexts
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyzer, setAnalyzer] = useState<AnalyserNode | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null); // Keep ref for internal worklet use
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // State flags
  const isCapturingRef = useRef(false);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const lastAudioChunkTimeRef = useRef(Date.now());
  
  // VAD Settings (could be synced from store/settings)
  const SILENCE_THRESHOLD = 35; // Higher = less sensitive (requires louder speech)
  const SILENCE_DURATION = 2500; // ms of silence before auto-stop (longer = more natural pauses)

  // Socket state
  const socketSessionRef = useRef<string>("");
  const socketReconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const audioChunkQueueRef = useRef<any[]>([]);
  const isSocketReadyRef = useRef(false);

  // ========== CORE INITIALIZATION ==========
  useEffect(() => {
    log("info", "Initializing AudioManager...");

    const initAudioContext = async () => {
      try {
        if (audioCtxRef.current) return; // Already initialized

        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) {
          throw new Error("AudioContext not available in this browser");
        }

        const audioCtx = new Ctx();
        log("info", "AudioContext created", {
          state: audioCtx.state,
          sampleRate: audioCtx.sampleRate,
        });

        // Create analyzer for visualization
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;

        audioCtxRef.current = audioCtx;
        analyzerRef.current = analyzer;
        setAnalyzer(analyzer);
        setMicAvailable(true);
        log("info", "AudioContext initialized successfully");
      } catch (err: any) {
        log("error", "Failed to initialize AudioContext", err.message);
        addToast("Audio system unavailable", "error");
        setAudioState("error");
      }
    };

    // Check for HTTPS/localhost requirement
    const isSecure =
      typeof window !== "undefined" &&
      (window.location.protocol === "https:" ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

    if (!isSecure) {
      log("warn", "MediaDevices requires HTTPS or localhost", {
        protocol: window.location.protocol,
        hostname: window.location.hostname,
      });
      addToast(
        "Microphone requires HTTPS or localhost",
        "warning"
      );
      setAudioState("error");
    } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
       log("error", "navigator.mediaDevices.getUserMedia not supported in this browser");
       addToast("Browser mic access not supported", "error");
       setAudioState("error");
    } else {
      initAudioContext();
    }
  }, [addToast]);

  // ========== LOAD AUDIO WORKLET (with fallback) ==========
  const loadAudioWorklet = useCallback(async (): Promise<boolean> => {
    log("info", "Attempting to load AudioWorklet...");

    try {
      if (!audioCtxRef.current) throw new Error("AudioContext not initialized");

      const audioCtx = audioCtxRef.current;

      // Try to load the worklet
      try {
        await audioCtx.audioWorklet.addModule("./pcm-processor.js");
        log("info", "AudioWorklet loaded successfully");
        return true;
      } catch (workletErr: any) {
        log("warn", "AudioWorklet failed to load, will use MediaRecorder fallback", {
          error: workletErr.message,
          possibleCauses: [
            "File not found (check /public/pcm-processor.js)",
            "CORS issue",
            "Browser doesn't support AudioWorklet",
          ],
        });
        return false;
      }
    } catch (err: any) {
      log("error", "Failed to load AudioWorklet", err.message);
      return false;
    }
  }, []);

  // ========== REQUEST MICROPHONE ==========
  const requestMicrophone = useCallback(async (): Promise<MediaStream | null> => {
    log("info", "Requesting microphone access...");
    setAudioState("requesting_mic");

    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      log("info", "Microphone access granted", {
        audioTracks: stream.getAudioTracks().length,
        trackSettings: stream.getAudioTracks()[0]?.getSettings(),
      });

      streamRef.current = stream;
      return stream;
    } catch (err: any) {
      log("error", "Microphone access denied", {
        error: err.name,
        message: err.message,
      });

      const errorMsg =
        err.name === "NotAllowedError"
          ? "Mic permission denied. Please allow in browser settings."
          : err.name === "NotFoundError"
          ? "No microphone found on this device"
          : "Microphone access failed";

      addToast(errorMsg, "error");
      setAudioState("error");
      return null;
    }
  }, [addToast]);

  // ========== START AUDIO CAPTURE (with fallback) ==========
  const startAudioCapture = useCallback(async () => {
    if (isCapturingRef.current) {
      log("info", "Already capturing, ignoring start request");
      setAudioState("listening");
      return;
    }
    
    log("info", "Starting audio capture...");
    setAudioState("listening");

    try {
      if (!audioCtxRef.current) {
        throw new Error("AudioContext not initialized");
      }

      const stream = await requestMicrophone();
      if (!stream) return;

      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
        log("info", "AudioContext resumed from suspended state");
      }

      // Connect stream to analyzer for visualization
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyzerRef.current!);
      
      // Force visualizer to show activity
      setAudioState("listening");
      socket.emit("manual_activation");

      // Try AudioWorklet first
      const workletLoaded = await loadAudioWorklet();

      if (workletLoaded) {
        log("info", "Using AudioWorklet for audio capture");
        try {
          const workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");

          workletNode.port.onmessage = (event) => {
            const { pcmData, chunkNumber } = event.data;

            if (!pcmData || !isCapturingRef.current) return;

            lastAudioChunkTimeRef.current = Date.now();

            // ── VAD: Simple Volume-based Silence Detection ─────────────────
            if (analyzerRef.current) {
              const dataArray = new Uint8Array(analyzerRef.current.fftSize);
              analyzerRef.current.getByteTimeDomainData(dataArray);
              
              // Calculate RMS (Root Mean Square) for volume
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                const val = (dataArray[i] - 128) / 128;
                sum += val * val;
              }
              const rms = Math.sqrt(sum / dataArray.length) * 100;
              
              if (rms < SILENCE_THRESHOLD) {
                if (!silenceStartRef.current) silenceStartRef.current = Date.now();
                const silenceMs = Date.now() - silenceStartRef.current;
                
                if (silenceMs > SILENCE_DURATION) {
                  log("info", `Silence detected (${silenceMs}ms), auto-stopping...`);
                  stopAudioCapture("processing");
                  socket.emit("manual_stop");
                  return;
                }
              } else {
                silenceStartRef.current = null; // Reset if noise detected
              }
            }

            // CRITICAL FIX: Auto-recover if socket.connected but flag not set yet
            // This handles the race condition where socket.connected=true but connect event hasn't fired
            if (socket.connected && !isSocketReadyRef.current) {
              log("warn", `AUTO-RECOVERY: Socket connected but flag not set, setting isSocketReady=true`, {
                socketId: socket.id,
              });
              isSocketReadyRef.current = true;

              // Flush any pending queue immediately
              if (audioChunkQueueRef.current.length > 0) {
                log("info", `Flushing ${audioChunkQueueRef.current.length} queued chunks after auto-recovery`);
                const queuedChunks = audioChunkQueueRef.current.splice(0);
                queuedChunks.forEach(({ pcmData: qData, chunkNumber: qNum }) => {
                  socket.emit("audio_chunk", qData, (ack: any) => {
                    if (!ack?.success) {
                      log("warn", `Queued chunk #${qNum} rejected`, ack);
                    }
                  });
                });
              }
            }

            // If socket is still not ready, queue the chunk
            if (!socket.connected || !isSocketReadyRef.current) {
              log("warn", `Socket not ready for chunk #${chunkNumber}, queuing...`, {
                socketConnected: socket.connected,
                isSocketReady: isSocketReadyRef.current,
                queueSize: audioChunkQueueRef.current.length + 1,
              });
              audioChunkQueueRef.current.push({ pcmData, chunkNumber });

              // Safety limit: don't queue more than 100 chunks (prevents memory leak)
              if (audioChunkQueueRef.current.length > 100) {
                log("error", "Audio queue exceeded 100 chunks, dropping oldest", {
                  dropped: audioChunkQueueRef.current.shift(),
                });
              }
              return;
            }

            // Socket is ready, emit the chunk
            socket.emit("audio_chunk", pcmData, (ack: any) => {
              if (!ack?.success) {
                log("warn", `Server rejected chunk #${chunkNumber}`, ack);
              }
            });
          };

          workletNode.port.onmessageerror = (err) => {
            log("error", "AudioWorklet port error", err);
          };

          source.connect(workletNode);
          workletNodeRef.current = workletNode;

          isCapturingRef.current = true;
          log("info", "Audio capture started with AudioWorklet");
        } catch (workletExecErr: any) {
          log("error", "Failed to instantiate AudioWorklet, falling back to MediaRecorder", {
            error: workletExecErr.message,
          });
          fallbackToMediaRecorder(stream);
        }
      } else {
        log("warn", "AudioWorklet not available, using MediaRecorder fallback");
        fallbackToMediaRecorder(stream);
      }

      const store = useRockyStore.getState();
      if (store.status !== "listening") {
        addToast("Listening...", "info");
      }
    } catch (err: any) {
      log("error", "Failed to start audio capture", err.message);
      setAudioState("error");
      addToast("Failed to start listening", "error");
    }
  }, [requestMicrophone, loadAudioWorklet, socket, addToast]);

  // ========== FALLBACK: MediaRecorder ==========
  const fallbackToMediaRecorder = (stream: MediaStream) => {
    log("info", "Initializing MediaRecorder fallback...");

    try {
      const mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        log("warn", `MIME type ${mimeType} not supported, trying audio/webm`);
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          log("info", "MediaRecorder chunk captured", { size: event.data.size });
        }
      };

      recorder.onerror = (event: any) => {
        log("error", "MediaRecorder error", event.error);
      };

      recorder.onstart = () => {
        log("info", "MediaRecorder started");
        isCapturingRef.current = true;
      };

      recorder.onstop = async () => {
        log("info", "MediaRecorder stopped, processing audio blob...");
        if (recordedChunksRef.current.length > 0) {
          const audioBlob = new Blob(recordedChunksRef.current, {
            type: "audio/webm",
          });
          recordedChunksRef.current = [];
          // Send blob to server for STT
          socket.emit("audio_blob", audioBlob, (ack: any) => {
            log("info", "Server processed audio blob", ack);
          });
        }
      };

      recorder.start(250); // Emit data every 250ms
      mediaRecorderRef.current = recorder;
      isCapturingRef.current = true;
    } catch (err: any) {
      log("error", "MediaRecorder initialization failed", err.message);
      setAudioState("error");
      addToast("Audio recording not available", "error");
    }
  };

  // ========== STOP AUDIO CAPTURE ==========
  const stopAudioCapture = useCallback((nextState: AudioState = "idle") => {
    log("info", "Stopping audio capture...", {
      nextState,
      queuedChunks: audioChunkQueueRef.current.length,
    });
    isCapturingRef.current = false;

    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
        log("info", "AudioWorklet disconnected");
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
        log("info", "MediaRecorder stopped");
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
          log("info", "MediaStream track stopped", { kind: track.kind });
        });
        streamRef.current = null;
      }

      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      silenceStartRef.current = null;

      // Clear any remaining queued chunks
      if (audioChunkQueueRef.current.length > 0) {
        log("info", "Clearing audio queue", {
          discarded: audioChunkQueueRef.current.length,
        });
        audioChunkQueueRef.current = [];
      }

      setAudioState(nextState);
    } catch (err: any) {
      log("error", "Error stopping audio capture", err.message);
    }
  }, []);

  // ========== MANUAL TRIGGER (mic button clicked) ==========
  const handleManualTrigger = useCallback(() => {
    log("info", "Manual trigger activated by user");

    if (audioState === "listening" || audioState === "processing") {
      log("info", "Already capturing, stopping...");
      stopAudioCapture("processing");
      socket.emit("manual_stop");
    } else if (audioState === "idle" || audioState === "error") {
      startAudioCapture();
    }
  }, [audioState, startAudioCapture, stopAudioCapture]);

  // ========== SOCKET LISTENERS ==========
  useEffect(() => {
    const flushAudioQueue = () => {
      if (audioChunkQueueRef.current.length === 0) {
        log("info", "Audio queue is empty, nothing to flush");
        return;
      }

      log("info", "Flushing queued audio chunks", {
        queueSize: audioChunkQueueRef.current.length,
      });

      let flushedCount = 0;
      while (audioChunkQueueRef.current.length > 0 && isCapturingRef.current) {
        const { pcmData, chunkNumber } = audioChunkQueueRef.current.shift()!;

        socket.emit("audio_chunk", pcmData, (ack: any) => {
          if (!ack?.success) {
            log("warn", `Queued chunk #${chunkNumber} rejected by server`, ack);
          }
        });

        flushedCount++;
      }

      log("info", "Audio queue flush complete", {
        flushed: flushedCount,
        remaining: audioChunkQueueRef.current.length,
      });
    };

    const onConnect = () => {
      log("info", "Socket connected successfully", { socketId: socket.id });
      socketReconnectAttempts.current = 0;
      isSocketReadyRef.current = true;
      addToast("Connected to server", "info");

      // Flush any queued chunks
      setTimeout(() => flushAudioQueue(), 0);
    };

    const onDisconnect = (reason: string) => {
      log("warn", "Socket disconnected", { reason, queuedChunks: audioChunkQueueRef.current.length });
      isSocketReadyRef.current = false;
      addToast("Disconnected from server", "warning");
      stopAudioCapture();
    };

    const onConnectError = (error: any) => {
      log("error", "Socket connection error", error);
      isSocketReadyRef.current = false;
      socketReconnectAttempts.current++;

      if (socketReconnectAttempts.current > maxReconnectAttempts) {
        log("error", "Max reconnection attempts reached");
        setAudioState("error");
        addToast("Server unreachable", "error");
      }
    };

    const onStatusUpdate = (status: string) => {
      log("info", "Status update from server", { status });
      // Clear any queued audio chunks when entering processing or speaking states
      // to prevent stale data being sent after status transition
      if (status === "processing_stt" || status === "thinking_llm" || status === "synthesizing_tts") {
        if (audioChunkQueueRef.current.length > 0) {
          log("info", "Clearing audio chunk queue due to status transition", {
            reason: status,
            queueSize: audioChunkQueueRef.current.length,
          });
          audioChunkQueueRef.current = [];
        }
      }

      if (status === "listening") {
        setAudioState("listening");
      } else if (status === "processing_stt" || status === "thinking_llm") {
        setAudioState("processing");
        // Stop capturing while thinking/processing to prevent echo
        if (isCapturingRef.current) {
          stopAudioCapture();
        }
      } else if (status === "synthesizing_tts") {
        setAudioState("speaking");
        // IMPORTANT: Stop capturing while speaking to prevent feedback loop
        if (isCapturingRef.current) {
          log("info", "System speaking, closing mic to prevent loop");
          stopAudioCapture();
        }
      } else if (status === "idle") {
        setAudioState("idle");
      }
    };

    // Handle initial state if already connected
    if (socket.connected) {
      isSocketReadyRef.current = true;
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("status_update", onStatusUpdate);
    
    // ── Wake Word Listener ──
    const onWakeWord = () => {
      log("info", "Wake word signal received via EventBus, activating mic...");
      startAudioCapture();
    };
    eventBus.on(RockyEvents.WAKE_WORD_DETECTED, onWakeWord);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("status_update", onStatusUpdate);
      eventBus.off(RockyEvents.WAKE_WORD_DETECTED, onWakeWord);
    };
  }, [socket, stopAudioCapture, addToast, startAudioCapture]);

  // ========== AUTO-RESTART LOOP ==========
  const currentStatus = useRockyStore(s => s.status);
  const isListeningGlobal = useRockyStore(s => s.isListening);

  useEffect(() => {
    // Only restart if we are truly idle and continuous mode is enabled
    if (currentStatus === "idle" && isListeningGlobal && !isCapturingRef.current && audioState === "idle") {
      log("info", "Continuous Mode: Scheduling auto-restart...");
      const timer = setTimeout(() => {
        // Double check state before starting
        if (!isCapturingRef.current && useRockyStore.getState().status === "idle") {
          log("info", "Continuous Mode: Restarting capture");
          startAudioCapture();
        }
      }, 1500); // 1.5s delay to prevent feedback loop
      return () => clearTimeout(timer);
    }
  }, [currentStatus, isListeningGlobal, startAudioCapture, audioState]);

  // ========== CLEANUP ==========
  useEffect(() => {
    return () => {
      log("info", "Cleaning up AudioManager");
      stopAudioCapture();
    };
  }, [stopAudioCapture]);

  return {
    audioState,
    micAvailable,
    analyzer: analyzer,
    handleManualTrigger,
    startAudioCapture,
    stopAudioCapture,
  };
}
