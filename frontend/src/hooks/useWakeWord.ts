import { useEffect, useRef, useCallback } from "react";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { useRockyStore } from "../store/useRockyStore";

/**
 * useWakeWord Hook
 * 
 * Implements 100% local wake word detection using the Browser's Speech Recognition API.
 * This replaces the backend-based Python wake word service to achieve zero latency
 * and remove dependencies on external API keys or complex local setups.
 */
export function useWakeWord() {
  const recognitionRef = useRef<any>(null);
  const status = useRockyStore((s) => s.status);
  const isListeningGlobal = useRockyStore((s) => s.isListening);
  const isStartedRef = useRef(false);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // Recognition might already be stopped
      }
      recognitionRef.current = null;
      isStartedRef.current = false;
      console.log("[WakeWord] Stopped recognition.");
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (isStartedRef.current) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[WakeWord] Speech Recognition API not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      // We set lang to undefined to let the browser use the default or detect, 
      // but "en-US" or "pt-PT" are good candidates.
      // recognition.lang = "en-US"; 

      recognition.onstart = () => {
        isStartedRef.current = true;
        console.log("[WakeWord] Started listening for wake word...");
      };

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          
          // Pattern matching for "Hey Rocky" or variations
          const isMatch = 
            transcript.includes("rocky") || 
            transcript.includes("hey rocky") || 
            transcript.includes("ei rocky") ||
            transcript.includes("ok rocky");

          if (isMatch) {
            console.log("[WakeWord] Wake word detected in transcript:", transcript);
            
            // Stop recognition immediately to free up the microphone for the audio manager
            stopRecognition();
            
            // Trigger the audio manager via EventBus
            eventBus.emit(RockyEvents.WAKE_WORD_DETECTED);
            break;
          }
        }
      };

      recognition.onerror = (event: any) => {
        // 'no-speech' is common and not really an error for wake word detection
        if (event.error !== "no-speech") {
          console.error("[WakeWord] Recognition error:", event.error);
        }
        
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
           isStartedRef.current = false;
        }
      };

      recognition.onend = () => {
        isStartedRef.current = false;
        recognitionRef.current = null;
        
        // Re-start if we are still in idle state and global listening is enabled
        // This ensures the wake word engine stays alive
        const currentState = useRockyStore.getState();
        if (currentState.status === "idle" && currentState.isListening) {
          setTimeout(() => {
            if (useRockyStore.getState().status === "idle") {
               startRecognition();
            }
          }, 100);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error("[WakeWord] Failed to start speech recognition:", err);
      isStartedRef.current = false;
    }
  }, [stopRecognition]);

  useEffect(() => {
    // We only listen for the wake word when the system is IDLE
    // and the user has enabled "Continuous Listening" (isListeningGlobal)
    if (status === "idle" && isListeningGlobal) {
      startRecognition();
    } else {
      stopRecognition();
    }

    return () => {
      stopRecognition();
    };
  }, [status, isListeningGlobal, startRecognition, stopRecognition]);

  return { 
    isStarted: isStartedRef.current,
    start: startRecognition,
    stop: stopRecognition
  };
}
