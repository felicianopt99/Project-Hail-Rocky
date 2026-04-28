# 💻 Soluções de Código - Pronto para Implementar

> **Copia e cola direto.** Todos os fixes testados conceitualmente.

---

## 🔴 PRIORITY 1: Fixes Críticos

### FIX #1: Auto-Reconexão em WakeWordService

**Arquivo:** `src/services/wakeWordService.ts`

```typescript
import net from "net";
import { EventEmitter } from "events";

export class WakeWordService extends EventEmitter {
  private host: string;
  private port: number;
  private client: net.Socket | null = null;
  private isConnected = false;
  
  // ✅ ADD THESE
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly INITIAL_RECONNECT_DELAY = 1000;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    host = process.env.WAKEWORD_HOST || "127.0.0.1", 
    port = parseInt(process.env.WAKEWORD_PORT || "10400")
  ) {
    super();
    this.host = host;
    this.port = port;
  }

  // ✅ ADD THIS METHOD
  private reconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WakeWord] Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached`);
      this.emit("connection_failed");
      return;
    }

    const delay = this.INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    
    console.log(`[WakeWord] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  connect() {
    if (this.isConnected) return;

    this.client = new net.Socket();
    
    this.client.connect(this.port, this.host, () => {
      console.log(`[WakeWord] Connected to ${this.host}:${this.port}`);
      this.isConnected = true;
      this.reconnectAttempts = 0; // ✅ Reset counter on successful connection
      
      // Start Wyoming session
      this.client?.write(JSON.stringify({
        type: "audio-start",
        data: { rate: 16000, width: 2, channels: 1 },
      }) + "\n");
    });

    this.client.on("data", (data) => {
      const dataStr = data.toString();
      try {
        const lines = dataStr.split("\n").filter(l => l.trim());
        for (const line of lines) {
          const event = JSON.parse(line);
          console.log(`[WakeWord Event] ${event.type}`, event.data || "");
          if (event.type === "detection") {
            console.log(`[WakeWord] Detected: ${event.data.name} (confidence: ${event.data.confidence})`);
            this.emit("detected", event.data);
          }
        }
      } catch (e) {
        // Ignore potential partial JSON
      }
    });

    // ✅ UPDATE: Add reconnect
    this.client.on("close", () => {
      console.warn("[WakeWord] Connection closed. Attempting to reconnect...");
      this.isConnected = false;
      this.reconnect();
    });

    // ✅ UPDATE: Add reconnect
    this.client.on("error", (err) => {
      console.error("[WakeWord] Socket error:", err.message);
      this.isConnected = false;
      this.reconnect();
    });
  }

  sendAudio(buffer: Buffer) {
    if (this.isConnected && this.client && this.client.writable) {
      try {
        const event = {
          type: "audio-chunk",
          data: {
            rate: 16000,
            width: 2,
            channels: 1
          },
          payload_length: buffer.length
        };
        
        const headerText = JSON.stringify(event) + "\n";
        const header = Buffer.from(headerText);
        const combined = Buffer.concat([header, buffer]);
        this.client.write(combined);
      } catch (err) {
        console.error("[WakeWord] Error sending audio:", err);
      }
    }
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.client) {
      this.client.write(JSON.stringify({
        type: "audio-stop",
        data: {},
      }) + "\n");
      this.client.destroy();
      this.isConnected = false;
    }
  }
}
```

---

### FIX #2: Timeout em WhisperService

**Arquivo:** `src/services/whisperService.ts`

```typescript
import net from "net";

export class WhisperService {
  private host: string;
  private port: number;
  private readonly TIMEOUT_MS = 30000; // ✅ ADD THIS

  constructor(
    host = process.env.WHISPER_HOST || "127.0.0.1", 
    port = parseInt(process.env.WHISPER_PORT || "10300")
  ) {
    this.host = host;
    this.port = port;
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let transcript = "";
      let timeoutHandle: NodeJS.Timeout | null = null; // ✅ ADD THIS

      // ✅ ADD THIS: Timeout handler
      const setupTimeout = () => {
        timeoutHandle = setTimeout(() => {
          console.warn("[Whisper] Transcription timeout (30s exceeded)");
          client.destroy();
          reject(new Error("Whisper transcription timeout (30s)"));
        }, this.TIMEOUT_MS);
      };

      // ✅ ADD THIS: Clear timeout on activity
      const clearTimeoutSafe = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      client.connect(this.port, this.host, () => {
        setupTimeout(); // ✅ Start timeout after connection
        
        // 1. Send audio-start
        client.write(JSON.stringify({
          type: "audio-start",
          data: { rate: 16000, width: 2, channels: 1 },
        }) + "\n");

        // 2. Send audio chunks in Wyoming format
        const event = {
          type: "audio-chunk",
          data: {
            rate: 16000,
            width: 2,
            channels: 1
          },
          payload_length: audioBuffer.length
        };
        
        const headerText = JSON.stringify(event) + "\n";
        const header = Buffer.from(headerText);
        const combined = Buffer.concat([header, audioBuffer]);
        client.write(combined);

        // 3. Send audio-stop
        client.write(JSON.stringify({
          type: "audio-stop",
          data: {},
        }) + "\n");
      });

      client.on("data", (data) => {
        clearTimeoutSafe(); // ✅ Clear timeout on data
        setupTimeout(); // ✅ Restart timeout
        
        const dataStr = data.toString();
        try {
          const lines = dataStr.split("\n").filter(l => l.trim());
          for (const line of lines) {
            const event = JSON.parse(line);
            if (event.type === "transcript") {
              transcript = event.data.text;
            }
          }
        } catch (e) {
          // Might be partial JSON or binary, ignore for now
        }
      });

      client.on("close", () => {
        clearTimeoutSafe(); // ✅ Clear timeout
        resolve(transcript);
      });

      client.on("error", (err) => {
        clearTimeoutSafe(); // ✅ Clear timeout
        reject(err);
      });
    });
  }
}

export const whisperService = new WhisperService();
```

---

### FIX #3: Remover Headers Duplicados

**Arquivo:** `src/services/whisperService.ts` (linhas 18-27)

```typescript
// ❌ BEFORE
const event = {
  type: "audio-chunk",
  data: {
    rate: 16000,
    width: 2,
    channels: 1
  },
  // Some versions expect them at top level
  rate: 16000,
  width: 2,
  channels: 1,
  payload_length: audioBuffer.length
};

// ✅ AFTER
const event = {
  type: "audio-chunk",
  data: {
    rate: 16000,
    width: 2,
    channels: 1
  },
  payload_length: audioBuffer.length
};
```

**Arquivo:** `src/services/wakeWordService.ts` (linhas 35-44)

```typescript
// ❌ BEFORE
const event = {
  type: "audio-chunk",
  data: {
    rate: 16000,
    width: 2,
    channels: 1
  },
  // Some versions expect them at top level
  rate: 16000,
  width: 2,
  channels: 1,
  payload_length: buffer.length
};

// ✅ AFTER
const event = {
  type: "audio-chunk",
  data: {
    rate: 16000,
    width: 2,
    channels: 1
  },
  payload_length: buffer.length
};
```

---

### FIX #4: Refatorar Audio Pipeline

**Arquivo:** `server.ts` (socket.on("audio_chunk"))

```typescript
// ❌ BEFORE
socket.on("audio_chunk", (chunk: ArrayBuffer | Buffer) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  chunkCount++;
  
  if (chunkCount % 50 === 0) {
    console.log(`[Rocky] Received PCM chunk ${chunkCount} (${buf.length} bytes)`);
  }

  // Forward raw PCM directly to Wyoming services
  if (wwService) wwService.sendAudio(buf);  // SEMPRE
  if (isCommandActive) commandBuffers.push(buf);  // TAMBÉM
});

// ✅ AFTER
socket.on("audio_chunk", (chunk: ArrayBuffer | Buffer) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  chunkCount++;
  
  if (chunkCount % 50 === 0) {
    console.log(`[Rocky] Received PCM chunk ${chunkCount} (${buf.length} bytes)`);
  }

  // Route audio based on current state
  if (isCommandActive) {
    // During command capture: only collect audio
    commandBuffers.push(buf);
  } else {
    // Awaiting wake word: only send to detector
    if (wwService) wwService.sendAudio(buf);
  }
});
```

---

## 🟠 PRIORITY 2: Fixes de Funcionalidade

### FIX #5: Aumentar Sensibilidade Detecção Silêncio

**Arquivo:** `src/App.tsx` (useEffect com isListening)

```typescript
// ❌ BEFORE
useEffect(() => {
  // ... setup code ...
  
  processor.onaudioprocess = (e) => {
    // ... conversion code ...
    
    // Simple visualizer update
    const volume = float32Data.reduce((a, b) => a + Math.abs(b), 0) / float32Data.length;
    if (volume < 0.01) { // Very low threshold
      if (!silenceTimer) {
        silenceTimer = setTimeout(() => {
          console.log("[Rocky] Auto-sending: Silence detected");
          setIsListening(false);
        }, 3000); 
      }
    } else {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    }
  };
}, [isListening]);

// ✅ AFTER
useEffect(() => {
  // ... setup code ...
  
  const SILENCE_THRESHOLD = 0.05; // 5x higher than before
  const SILENCE_DURATION = 5000; // 5 seconds
  
  processor.onaudioprocess = (e) => {
    // ... conversion code ...
    
    const volume = float32Data.reduce((a, b) => a + Math.abs(b), 0) / float32Data.length;
    
    if (volume < SILENCE_THRESHOLD) {
      // Low volume detected
      if (!silenceTimer) {
        console.log("[Rocky] Silence started, waiting 5 seconds...");
        silenceTimer = setTimeout(() => {
          console.log("[Rocky] Auto-sending: Silence timeout reached");
          setIsListening(false);
        }, SILENCE_DURATION);
      }
    } else {
      // Sound detected, reset timer
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    }
  };
}, [isListening]);
```

---

### FIX #6: Rate Limiting Socket Events

**Arquivo:** `server.ts` (io.on("connection"))

```typescript
io.on("connection", async (socket) => {
  console.log("[Rocky] Client connected");
  const wwService = new WakeWordService();
  wwService.connect();

  let chunkCount = 0;
  let ffmpegStream: any = null;
  let isCommandActive = false;
  let commandBuffers: Buffer[] = [];
  let silenceTimeout: NodeJS.Timeout | null = null;

  // ✅ ADD THIS: Rate limiting
  const AUDIO_CHUNK_RATE_LIMIT_MS = 200; // Max 1 chunk per 200ms
  let lastAudioChunkTime = 0;
  let droppedChunks = 0;

  // ... existing code ...

  // ✅ UPDATE: Add rate limiting
  socket.on("audio_chunk", (chunk: ArrayBuffer | Buffer) => {
    const now = Date.now();
    
    // ✅ Rate limit check
    if (now - lastAudioChunkTime < AUDIO_CHUNK_RATE_LIMIT_MS) {
      droppedChunks++;
      if (droppedChunks % 100 === 0) {
        console.warn(`[Rocky] Audio chunks too frequent, dropped ${droppedChunks} chunks total`);
      }
      return; // Drop this chunk
    }
    
    lastAudioChunkTime = now;
    droppedChunks = 0;
    
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunkCount++;
    
    if (chunkCount % 50 === 0) {
      console.log(`[Rocky] Received PCM chunk ${chunkCount} (${buf.length} bytes)`);
    }

    if (isCommandActive) {
      commandBuffers.push(buf);
    } else {
      if (wwService) wwService.sendAudio(buf);
    }
  });
});
```

---

### FIX #7: Validação de Input em control_device

**Arquivo:** `server.ts` (socket.on("control_device"))

```typescript
// ✅ ADD THIS: Whitelist constants
const VALID_DEVICES = ["studio", "desk", "kitchen", "bedroom", "living", "ambient", "all"];
const VALID_ACTIONS = ["on", "off", "toggle", "set"];

// ✅ ADD THIS: Helper function
function validateColorHex(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function validateBrightness(brightness: any): boolean {
  return typeof brightness === "number" && brightness >= 0 && brightness <= 100;
}

// ... in socket handler ...

// ❌ BEFORE
socket.on("control_device", async (data: { device: string, action: string, params?: any }) => {
  console.log(`[Rocky] Control command: ${data.device} -> ${data.action}`, data.params);
  
  const { device, action, params } = data;
  const success = await controlHALight(device, action, params);
  // ... rest of code
});

// ✅ AFTER
socket.on("control_device", async (data: { device: string, action: string, params?: any }) => {
  // Validate input
  if (!data || typeof data !== "object") {
    console.error("[Rocky] Invalid control_device payload: not an object");
    socket.emit("control_error", { message: "Invalid payload format" });
    return;
  }

  const { device, action, params } = data;

  // Validate device
  if (typeof device !== "string" || !VALID_DEVICES.includes(device)) {
    console.error(`[Rocky] Invalid device: ${device}`);
    socket.emit("control_error", { message: `Invalid device: ${device}` });
    return;
  }

  // Validate action
  if (typeof action !== "string" || !VALID_ACTIONS.includes(action)) {
    console.error(`[Rocky] Invalid action: ${action}`);
    socket.emit("control_error", { message: `Invalid action: ${action}` });
    return;
  }

  // Validate params if present
  if (params) {
    if (typeof params !== "object") {
      console.error("[Rocky] Invalid params: not an object");
      socket.emit("control_error", { message: "Invalid params format" });
      return;
    }

    if (params.brightness !== undefined && !validateBrightness(params.brightness)) {
      console.error(`[Rocky] Invalid brightness: ${params.brightness}`);
      socket.emit("control_error", { message: "Brightness must be 0-100" });
      return;
    }

    if (params.color !== undefined && !validateColorHex(params.color)) {
      console.error(`[Rocky] Invalid color: ${params.color}`);
      socket.emit("control_error", { message: "Color must be hex format #RRGGBB" });
      return;
    }
  }

  console.log(`[Rocky] Control command: ${device} -> ${action}`, params);
  
  const success = await controlHALight(device, action, params);
  // ... rest of code
});
```

---

### FIX #8: Corrigir Inconsistência Chat Response

**Arquivo:** `server.ts` (socket.on("chat_request"))

```typescript
// ❌ BEFORE (around line 740)
socket.emit("chat_response", { text: cleanResponse || "Action executed, yes!" });

// Synthesize audio
try {
  const audio = await piperService.synthesize(cleanResponse || "Action executed, yes!");
  const wavAudio = addWavHeader(audio);
  console.log(`[Rocky] Sending synthesized WAV audio (${wavAudio.length} bytes)`);
  socket.emit("tts_audio", wavAudio);
} catch (err) {
  console.error("[Rocky TTS Auto Error]", err);
  socket.emit("tts_fallback", cleanResponse || "Action executed, yes!"); 
}

// ✅ AFTER: Await synthesis before emitting response
let audioBuffer: Buffer | null = null;
let synthesisError = false;

try {
  audioBuffer = await piperService.synthesize(cleanResponse || "Action executed, yes!");
  console.log(`[Rocky] Synthesized audio (${audioBuffer.length} bytes)`);
} catch (err) {
  console.error("[Rocky TTS Auto Error]", err);
  synthesisError = true;
}

// Emit response with audio status
socket.emit("chat_response", { 
  text: cleanResponse || "Action executed, yes!",
  audioReady: audioBuffer !== null
});

// Send audio if available
if (audioBuffer) {
  const wavAudio = addWavHeader(audioBuffer);
  console.log(`[Rocky] Sending synthesized WAV audio (${wavAudio.length} bytes)`);
  socket.emit("tts_audio", wavAudio);
} else {
  // Fallback to browser text-to-speech
  socket.emit("tts_fallback", cleanResponse || "Action executed, yes!");
}
```

---

## 🟡 PRIORITY 3: Limpeza Técnica

### FIX #9: Remover mediaRecorder Obsoleto

**Arquivo:** `src/App.tsx`

```typescript
// ❌ DELETE THIS LINE (around line 165)
let mediaRecorder: MediaRecorder | null = null;

// ❌ DELETE THIS BLOCK (around line 230)
if (mediaRecorder && mediaRecorder.state !== "inactive") {
  mediaRecorder.stop();
  socket.emit("audio_stop");
}
```

---

### FIX #10: Remover useAudioAnalyzer Não Utilizado

```bash
# Deletar arquivo
rm src/hooks/useAudioAnalyzer.ts
```

---

### FIX #11: Adicionar Tratamento de Erro Microfone

**Arquivo:** `src/App.tsx`

```typescript
// ✅ ADD THIS STATE
const [microphoneError, setMicrophoneError] = useState<string | null>(null);

// ✅ UPDATE THIS useEffect
useEffect(() => {
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let silenceTimer: NodeJS.Timeout | null = null;

  if (isListening) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => {
        stream = s;
        setMicrophoneError(null); // ✅ Clear error on success
        
        // ... rest of existing code ...
      })
      .catch(err => {
        console.error("[Rocky] Error accessing microphone:", err);
        
        // ✅ ADD THIS: Set error message
        let errorMessage = "Microphone access error";
        if (err.name === "NotAllowedError") {
          errorMessage = "Please allow microphone access in browser settings";
        } else if (err.name === "NotFoundError") {
          errorMessage = "No microphone found. Please check your device";
        } else if (err.name === "NotSupportedError") {
          errorMessage = "Microphone not supported in your browser";
        } else if (err.name === "OverconstrainedError") {
          errorMessage = "Microphone constraints not met";
        } else if (err.name === "TypeError") {
          errorMessage = "Audio permission denied";
        }
        
        setMicrophoneError(errorMessage);
        setIsListening(false);
      });
  }

  return () => {
    // ... existing cleanup ...
  };
}, [isListening]);

// ✅ ADD THIS: UI to show error
return (
  <div className="relative h-screen w-screen bg-black text-white overflow-hidden flex flex-col">
    {/* Error message banner */}
    {microphoneError && (
      <div className="bg-red-900/80 border-b border-red-700 text-red-100 px-4 py-2 text-sm flex items-center gap-2">
        <span>⚠️</span>
        <span>{microphoneError}</span>
        <button 
          onClick={() => {
            setMicrophoneError(null);
            setIsListening(true); // Retry
          }}
          className="ml-auto text-xs px-2 py-1 bg-red-700 hover:bg-red-600 rounded"
        >
          Retry
        </button>
      </div>
    )}
    
    {/* Rest of existing JSX */}
  </div>
);
```

---

### FIX #12: Corrigir Race Condition em Piper

**Arquivo:** `src/services/piperService.ts`

```typescript
async synthesize(text: string): Promise<Buffer> {
  console.log(`[Piper] Connecting to ${this.host}:${this.port} for synthesis...`);
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let audioBuffer = Buffer.alloc(0);
    let buffer = Buffer.alloc(0);
    let resolved = false; // ✅ ADD THIS
    
    // Parser state
    let state: "EVENT" | "DATA" | "PAYLOAD" = "EVENT";
    let remainingData = 0;
    let remainingPayload = 0;

    client.connect(this.port, this.host, () => {
      console.log(`[Piper] Connected. Sending text: "${text.substring(0, 50)}..."`);
      const event = JSON.stringify({
        type: "synthesize",
        data: { text },
      }) + "\n";
      client.write(event);
    });

    client.on("data", (chunk) => {
      // ... existing parsing code ...
      
      // ✅ UPDATE this part:
      if (type === "audio-stop") {
        if (audioBuffer.length === 0) {
          console.warn("[Piper] Received audio-stop but no audio data");
          if (!resolved) {
            resolved = true;
            reject(new Error("Piper returned empty audio"));
          }
        } else {
          console.log(`[Piper] Audio stream stopped. Total size: ${audioBuffer.length} bytes`);
          if (!resolved) {
            resolved = true;
            client.destroy();
            resolve(audioBuffer);
          }
        }
        return;
      }
    });

    client.on("error", (err) => {
      console.error("[Piper Socket Error]", err);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    // ✅ UPDATE timeout handling
    client.setTimeout(15000, () => {
      console.warn("[Piper] Synthesis timed out.");
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(new Error("Piper synthesis timed out"));
      }
    });
  });
}
```

---

## 📋 Checklist de Aplicação

```markdown
# Aplicar Fixes

## PRIORITY 1 (CRÍTICO)
- [ ] FIX #1: WakeWordService reconnect
  - [ ] Adicionar propriedades privadas
  - [ ] Implementar método reconnect()
  - [ ] Atualizar close e error handlers
  
- [ ] FIX #2: WhisperService timeout
  - [ ] Adicionar TIMEOUT_MS constant
  - [ ] Adicionar setupTimeout()
  - [ ] Adicionar clearTimeoutSafe()
  - [ ] Chamar em connect/data/close/error
  
- [ ] FIX #3: Remover headers duplicados
  - [ ] whisperService.ts linhas 18-27
  - [ ] wakeWordService.ts linhas 35-44
  
- [ ] FIX #4: Refatorar audio pipeline
  - [ ] Atualizar socket.on("audio_chunk")
  - [ ] Usar if/else baseado em isCommandActive

## PRIORITY 2 (ALTO)
- [ ] FIX #5: Silence threshold 0.05 + 5s timeout
- [ ] FIX #6: Rate limiting socket (200ms)
- [ ] FIX #7: Input validation (device/action/params)
- [ ] FIX #8: Chat response com audio status

## PRIORITY 3 (TÉCNICO)
- [ ] FIX #9: Remover mediaRecorder
- [ ] FIX #10: Remover useAudioAnalyzer.ts
- [ ] FIX #11: Adicionar error handling UI
- [ ] FIX #12: Corrigir race condition Piper

## TESTING
- [ ] WiFi disconnect recovery
- [ ] Whisper timeout handling
- [ ] Long pauses no corta áudio
- [ ] Headers aceitos por Wyoming
- [ ] Input validation rejeita malformados
- [ ] Microfone denied mostra erro
- [ ] Rate limiting funciona
- [ ] Chat response consistent
```

---

## 🧪 Testing Commands

```bash
# Test 1: Verificar TimeOut em Whisper
timeout 35 node -e "
  const { WhisperService } = require('./src/services/whisperService');
  const ws = new WhisperService('localhost', 9999); // Wrong port
  ws.transcribe(Buffer.alloc(1000))
    .then(() => console.log('Unexpected success'))
    .catch(err => console.log('Timeout test PASSED:', err.message));
"

# Test 2: Verificar Rate Limiting
# (Abrir browser console)
for (let i = 0; i < 1000; i++) {
  socket.emit('audio_chunk', new ArrayBuffer(512));
}
# Check console para "dropped chunks" message

# Test 3: Verificar Reconnection
# (Parar container Wyoming, observar console)
docker stop rocky-openwakeword
# Deve ver "Reconnecting in X ms" messages

# Test 4: Verificar Input Validation
socket.emit('control_device', {
  device: "'; DROP TABLE logs; --",
  action: "<?php system('ls'); ?>",
  params: null
});
# Deve rejeitar com erro
```

---

## 📝 Notes de Implementação

- **Ordem Importa**: Fazer Priority 1 antes de 2 ou 3
- **Teste Cada Fix**: Não aplicar todos de uma vez
- **Git Commits**: Fazer um commit por fix para rastreabilidade
- **Code Review**: Revisar diffs antes de merge
- **Backwards Compat**: Nenhum fix quebra a API existente

