import { useEffect, useRef } from "react";
import socket from "../lib/socket";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { useRockyStore, Message, RockyStatus, AppMode, LightState, Stats, Weather, LogEntry, Protocol, ProtocolSettings } from "../store/useRockyStore";
import { 
  ChatResponse, 
  ChatError, 
  SpeakerIdentified, 
  SpeakerChanged, 
  TimerFired, 
  ServiceStatus, 
  UiHint, 
  SystemStateUpdate, 
  DeviceUpdated, 
  ProtocolUpdated, 
  ProtocolDeleted,
  TtsStart
} from "../types/socketEvents";

const NAV_MODES: AppMode[] = ["dashboard", "visualizer", "neural_center"];

function playWakeBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext not available (e.g. SSR)
  }
}

export function useRockySockets(addToast: (msg: string, type: any) => void, isAudioActive: () => boolean) {
  const store = useRockyStore();
  const isInterruptedRef = useRef(false);

  useEffect(() => {
    const onModeUpdated = (newMode: string) => {
      if (NAV_MODES.includes(newMode as AppMode)) {
        store.setMode(newMode as AppMode);
      } else {
        store.setMode("protocols");
        store.setActiveProtocolId(newMode);
      }
    };

    const onStatusUpdate = (newStatus: RockyStatus) => {
      if (newStatus === "error" && store.status !== "error") {
        addToast("System error detected", "error");
      }
      
      // Prevent reverting to idle if audio is still physically playing
      if (newStatus === "idle" && isAudioActive()) {
        console.debug("[Rocky] Ignoring 'idle' status from server because audio is still playing.");
        return;
      }
      
      store.setStatus(newStatus);
    };

    const onChatHistory = (history: Message[]) => store.setMessages(history);

    const onTranscriptResult = (text: string) => store.setInputValue(text);

    const onChatToken = (token: string) => {
      // If we interrupted the assistant, ignore tokens until a new TTS segment starts
      if (isInterruptedRef.current) return;

      store.setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === "model") {
          let displayBuffer = lastMsg.text + token;
          // Filter out raw JSON/tool dumps
          displayBuffer = displayBuffer.replace(/```json[\s\S]*?(```|$)/g, "");
          displayBuffer = displayBuffer.replace(/\{[\s\S]*?"device"[\s\S]*?(\}|$)/g, "");
          const newHistory = [...prev];
          newHistory[newHistory.length - 1] = { ...lastMsg, text: displayBuffer.trim() || lastMsg.text };
          return newHistory;
        } else {
          if (token.includes("```json") || token.includes("{\"device\"")) return prev;
          return [...prev, { role: "model", text: token, timestamp: Date.now() }];
        }
      });
    };

    const onChatResponse = (data: ChatResponse) => {
      store.setMessages(prev => {
        const newHistory = [...prev];
        const lastMsg = newHistory[newHistory.length - 1];
        if (lastMsg && lastMsg.role === "model") {
          newHistory[newHistory.length - 1] = { role: "model", text: data.text, timestamp: Date.now() };
          return newHistory;
        }
        return [...prev, { role: "model", text: data.text, timestamp: Date.now() }];
      });
      store.setIsTyping(false);
      store.setStatus("idle");
    };

    const onChatError = (error: ChatError) => {
      addToast("Failed to send message - try again", "error");
      store.setIsTyping(false);
      store.setStatus("idle");
      console.error("[Chat Error]", error);
    };

    const onServiceStatus = (data: ServiceStatus) => {
      store.setServiceStatus(data.service, data.ok);
    };

    const onWakeWordDetected = () => {
      if (store.status !== "listening") {
        playWakeBeep();
        store.setMode("visualizer");
        store.setStatus("listening");
        addToast("Yes, human?", "info");
        // Signal AudioManager to activate the mic
        eventBus.emit(RockyEvents.WAKE_WORD_DETECTED);
      }
    };

    const onSpeakerIdentified = (data: SpeakerIdentified) => {
      addToast(`${data.name}`, "info");
    };

    const onSpeakerChanged = (data: SpeakerChanged) => {
      addToast(`${data.to}`, "info");
      // Clear chat display — new speaker, fresh context
      store.setMessages([]);
    };

    const onTimerFired = (data: TimerFired) => {
      addToast(`⏱ Timer: ${data.label}`, "info");
    };

    const onUiHint = (hint: UiHint) => {
      if (hint.type === "environmental_update") {
        store.setEnvironmentalState(hint.value);
      }
    };

    const onConnect = () => {
      store.setIsConnected(true);
      addToast("Connected to Rocky", "success");
    };

    const onDisconnect = () => {
      store.setIsConnected(false);
      addToast("Connection lost - reconnecting...", "warning");
    };

    const onConnectError = (error?: any) => {
      store.setIsConnected(false);
      const msg = error?.message || "Connection error - check OpenClaw gateway";
      addToast(msg, "error");
    };

    const onPongLatency = (sentAt: number) => store.setLatencyMs(Date.now() - sentAt);

    // Dashboard listeners
    const onWeather = (data: Weather) => store.setWeather(data);
    const onStats = (data: Stats) => store.setStats(data);
    const onSystemState = (data: SystemStateUpdate) => {
      if (data.logs)      store.setLogs(data.logs);
      if (data.lights)    store.setLights(data.lights);
      if (data.areas)     store.setAreas(data.areas);
      if (data.weather)   store.setWeather(data.weather);
      if (data.protocols) store.setProtocols(data.protocols);
    };

    const onProtocolUpdated = (data: ProtocolUpdated) =>
      store.setProtocols(prev => prev.map(p => p.id === data.id ? { ...p, settings: data.settings } : p));

    const onProtocolCreated = (p: Protocol) =>
      store.setProtocols(prev => [...prev, p]);

    const onProtocolDeleted = (data: ProtocolDeleted) =>
      store.setProtocols(prev => prev.filter(p => p.id !== data.id));
    const onAreas = (data: Record<string, string>) => store.setAreas(data);
    const onLog = (log: LogEntry) => store.setLogs(prev => [log, ...prev].slice(0, 50));
    const onDevice = (data: DeviceUpdated) => store.updateLight(data.device, data.state);
    const onRoutinesList = (routines: any[]) => store.setRoutines(routines);

    // Local interruption management
    const handleLocalInterrupt = () => {
      isInterruptedRef.current = true;
    };
    
    const onTtsStart = (data: TtsStart) => {
      // New speech segment started, we can stop ignoring tokens
      isInterruptedRef.current = false;
      console.debug("[TTS] Started with sample rate:", data.sampleRate);
    };

    socket.on("mode_updated", onModeUpdated);
    socket.on("status_update", onStatusUpdate);
    socket.on("chat_history", onChatHistory);
    socket.on("transcript_result", onTranscriptResult);
    socket.on("chat_token", onChatToken);
    socket.on("chat_response", onChatResponse);
    socket.on("chat_error", onChatError);
    socket.on("wake_word_detected", onWakeWordDetected);
    socket.on("speaker_identified", onSpeakerIdentified);
    socket.on("speaker_changed", onSpeakerChanged);
    socket.on("timer_fired", onTimerFired);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("pong_latency", onPongLatency);
    socket.on("service_status", onServiceStatus);
    socket.on("ui_hint", onUiHint);
    socket.on("tts_start", onTtsStart);

    socket.on("weather_updated",    onWeather);
    socket.on("stats_updated",      onStats);
    socket.on("system_state_update", onSystemState);
    socket.on("areas_updated",      onAreas);
    socket.on("new_log",            onLog);
    socket.on("device_updated",     onDevice);
    socket.on("protocol_updated",   onProtocolUpdated);
    socket.on("protocol_created",   onProtocolCreated);
    socket.on("protocol_deleted",   onProtocolDeleted);
    socket.on("routines_list",      onRoutinesList);

    eventBus.on(RockyEvents.INTERRUPT, handleLocalInterrupt);

    return () => {
      socket.off("mode_updated", onModeUpdated);
      socket.off("status_update", onStatusUpdate);
      socket.off("chat_history", onChatHistory);
      socket.off("transcript_result", onTranscriptResult);
      socket.off("chat_token", onChatToken);
      socket.off("chat_response", onChatResponse);
      socket.off("chat_error", onChatError);
      socket.off("wake_word_detected", onWakeWordDetected);
      socket.off("speaker_identified", onSpeakerIdentified);
      socket.off("speaker_changed", onSpeakerChanged);
      socket.off("timer_fired", onTimerFired);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("pong_latency", onPongLatency);
      socket.off("service_status", onServiceStatus);
      socket.off("ui_hint", onUiHint);
      socket.off("tts_start", onTtsStart);

      socket.off("weather_updated",     onWeather);
      socket.off("stats_updated",       onStats);
      socket.off("system_state_update", onSystemState);
      socket.off("areas_updated",       onAreas);
      socket.off("new_log",             onLog);
      socket.off("device_updated",      onDevice);
      socket.off("protocol_updated",    onProtocolUpdated);
      socket.off("protocol_created",    onProtocolCreated);
      socket.off("protocol_deleted",    onProtocolDeleted);
      socket.off("routines_list",       onRoutinesList);
      
      eventBus.off(RockyEvents.INTERRUPT, handleLocalInterrupt);
    };
  }, [addToast, isAudioActive]);
}
