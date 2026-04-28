# 📊 Análise Completa do Project Hail Rocky

> **Data**: Abril 2026 | **Status**: Análise Detalhada | **Versão**: 1.0.4

---

## 📋 Índice
1. [Visão Geral da Arquitetura](#visão-geral)
2. [Análise: Whisper Service (STT)](#1-whisper-service)
3. [Análise: Wake Word Service](#2-wake-word-service)
4. [Análise: Transcrição & Captura de Áudio](#3-transcrição-e-captura)
5. [Análise: Piper Service (TTS)](#4-piper-service)
6. [Análise: Frontend-Backend Connection](#5-frontend-backend)
7. [Rotas e Endpoints](#6-rotas-endpoints)
8. [Problemas Críticos Identificados](#7-problemas-críticos)
9. [Diagrama de Fluxo](#8-diagrama-fluxo)
10. [Recomendações](#9-recomendações)

---

## 🏗️ Visão Geral da Arquitetura

### Stack Tecnológico
```
Frontend: React 19 + Vite + Tailwind CSS
          ↓
Backend:  Express.js + Node.ts + Socket.io
          ↓
Services: Wyoming (Piper/Whisper/OpenWakeWord)
          ↓
Database: SQLite + Prisma ORM
          ↓
Automação: Home Assistant
          ↓
LLM:      Ollama (Gemma 2B-instruct)
```

### Serviços Docker
- **rocky-assistant**: App Node.js
- **rocky-piper**: Text-to-Speech (Porta 10200)
- **rocky-whisper**: Speech-to-Text (Porta 10300)
- **rocky-openwakeword**: Wake Word Detection (Porta 10400)
- **homeassistant**: Home Automation

---

## 1️⃣ Whisper Service - Speech-to-Text

### Arquivo: `src/services/whisperService.ts`

#### ✅ O que funciona
- Conexão TCP ao Wyoming Whisper Server
- Protocolo Wyoming bem implementado (audio-start → chunks → audio-stop)
- Parsing de transcript JSON

#### ⚠️ Problemas Identificados

##### **ERRO #1: Header PCM Duplicado**
```typescript
// ❌ INCORRETO (linhas 18-27)
const event = {
  type: "audio-chunk",
  data: {
    rate: 16000,
    width: 2,
    channels: 1
  },
  // Campos duplicados no top level
  rate: 16000,
  width: 2,
  channels: 1,
  payload_length: audioBuffer.length
};
```

**Por quê é problema?**
- Wyoming espera structure lógico: `data: {...}`
- Duplicação no top-level pode confundir parser
- Pode resultar em transcrição incorreta

**Solução:**
```typescript
// ✅ CORRETO
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

---

##### **ERRO #2: Sem Timeout Implementado**
```typescript
// ❌ PROBLEMA
async transcribe(audioBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    // Sem setTimeout(15000) para timeout
    client.connect(this.port, this.host, () => { ... });
  });
}
```

**Por quê é problema?**
- Se Wyoming não responde, Promise fica pendurada infinitamente
- Consome socket do servidor
- Em múltiplas transcrições, pode esgotar recursos

**Impacto Real:**
- ❌ Microphone trava
- ❌ Usuário não sabe o que aconteceu
- ❌ Força reload da página

---

##### **ERRO #3: Parser de Resposta Genérico**
```typescript
// ❌ PROBLEMA
client.on("data", (data) => {
  try {
    const lines = dataStr.split("\n").filter(l => l.trim());
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.type === "transcript") {
        transcript = event.data.text; // Sobrescreve anterior!
      }
    }
  } catch (e) {
    // Silenciosamente ignorado
  }
});
```

**Por quê é problema?**
- Se vêm múltiplas linhas JSON, último vence (pode estar incompleto)
- Erros de parse são silenciados
- Sem validação de `event.data.text` existir

---

### Fluxo Correto do Whisper
```
Frontend Audio Chunks (16kHz, Int16, Mono)
    ↓
    socket.emit("audio_chunk", buffer)
    ↓
Server recebe
    ↓
whisperService.transcribe(fullBuffer)
    ↓
TCP Connection to Wyoming:10300
    ↓
1. Enviar JSON: { type: "audio-start", ... }
2. Enviar JSON + PCM: { type: "audio-chunk", ... } + buffer
3. Enviar JSON: { type: "audio-stop", ... }
    ↓
Receber resposta: { type: "transcript", data: { text: "..." } }
    ↓
socket.emit("transcript_result", "Hello Rocky")
    ↓
Frontend exibe em input
```

---

## 2️⃣ Wake Word Service - Detecção

### Arquivo: `src/services/wakeWordService.ts`

#### ✅ O que funciona
- EventEmitter permite listeners múltiplos
- Logging detalhado de eventos
- Envio de áudio para Wyoming

#### 🔴 ERRO CRÍTICO #1: Sem Auto-Reconexão

```typescript
// ❌ CRÍTICO
client.on("close", () => {
  console.warn("[WakeWord] Connection closed.");
  this.isConnected = false;
  // NADA AQUI - Sem reconexão!
});

client.on("error", (err) => {
  console.error("[WakeWord] Socket error:", err.message);
  this.isConnected = false;
  // NADA AQUI - Sem reconexão!
});
```

**Cenário Real:**
1. User conecta browser → WakeWord Service conecta
2. WiFi drops por 5 segundos
3. Wyoming container reinicia (health check)
4. Socket close event dispara
5. `isConnected = false`
6. **NÃO reconecta automaticamente**
7. Wake word nunca mais funciona
8. Usuário precisa reload da página

**Impacto:**
- 🔴 **BLOQUEADOR** para produção
- Impossível detectar wake word após desconexão

**Solução Necessária:**
```typescript
// ✅ CORRETO
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000;
let retryCount = 0;

reconnect() {
  if (retryCount >= MAX_RETRIES) {
    console.error("[WakeWord] Max retries exceeded");
    return;
  }
  
  setTimeout(() => {
    console.log(`[WakeWord] Reconnecting... (attempt ${++retryCount})`);
    this.connect();
  }, RETRY_DELAY * Math.pow(2, retryCount)); // Exponential backoff
}

client.on("close", () => {
  this.isConnected = false;
  this.reconnect();
});
```

---

#### ⚠️ ERRO #2: Header Duplicado (mesmo que Whisper)

```typescript
// ❌ PROBLEMA (linhas 35-44)
const event = {
  type: "audio-chunk",
  data: { rate: 16000, width: 2, channels: 1 },
  rate: 16000,        // ← Duplicado
  width: 2,           // ← Duplicado
  channels: 1,        // ← Duplicado
  payload_length: buffer.length
};
```

**Efeito:** Wyoming pode ignorar ou ficar confuso

---

#### ⚠️ ERRO #3: Sem Validação de Detecção

```typescript
// ❌ PROBLEMA
if (event.type === "detection") {
  console.log(`[WakeWord] Detected: ${event.data.name}`);
  this.emit("detected", event.data); // Sem validação!
}
```

**Cenários problemáticos:**
```javascript
// Se chegar evento malformado:
{ type: "detection" } // Falta event.data
{ type: "detection", data: { } } // Falta name, confidence
{ type: "detection", data: { confidence: 0.45 } } // Confiança baixa
```

---

### Fluxo Wake Word
```
Browser Audio Chunks (16kHz, Int16, Mono)
    ↓
socket.emit("audio_chunk", buffer)
    ↓
Server: socket.on("audio_chunk")
    ↓
wwService.sendAudio(buffer)
    ↓
TCP Connection to Wyoming:10400
    ↓
Wyoming analisa áudio contra modelo "alexa", "amaze", "hey_jarvis", etc.
    ↓
Se detecção: { type: "detection", data: { name: "amaze", confidence: 0.95 } }
    ↓
wwService.on("detected") dispara
    ↓
isCommandActive = true
commandBuffers = []
socket.emit("wake_word_detected")
    ↓
Frontend: mudar para "visualizer" mode
timeout de 5s para processCommand()
```

---

## 3️⃣ Transcrição e Captura de Áudio

### Frontend: Captura em App.tsx

#### Fluxo de Captura
```typescript
if (isListening) {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      // Criar AudioContext com 16kHz nativo
      audioContext = new AudioContext({ sampleRate: 16000 });
      
      // Criar ScriptProcessor para processamento em tempo real
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        // Convert Float32 → Int16 PCM
        const float32Data = e.inputBuffer.getChannelData(0);
        const int16Data = new Int16Array(float32Data.length);
        
        for (let i = 0; i < float32Data.length; i++) {
          int16Data[i] = Math.max(-1, Math.min(1, float32Data[i])) * 0x7FFF;
        }
        
        // Enviar ao servidor
        socket.emit("audio_chunk", int16Data.buffer);
        
        // Detecção de silêncio
        const volume = float32Data.reduce((a, b) => a + Math.abs(b), 0) / 
                       float32Data.length;
        if (volume < 0.01) {
          setTimeout(() => setIsListening(false), 3000);
        }
      };
    })
}
```

#### ✅ Pontos Positivos
- AudioContext com 16kHz é correto
- Conversão Float32 → Int16 PCM está correta
- Envio imediato de chunks

#### ⚠️ ERRO #1: Detecção de Silêncio Muito Sensível

```typescript
// ❌ PROBLEMA
const volume = float32Data.reduce((a, b) => a + Math.abs(b), 0) / 
               float32Data.length;
if (volume < 0.01) { // Threshold muito baixo!
  if (!silenceTimer) {
    silenceTimer = setTimeout(() => {
      setIsListening(false);
    }, 3000);
  }
}
```

**Problemas:**
- Threshold 0.01 = muito baixo
- Qualquer ambiente com ruído para gravação após 3 segundos
- Palavras pausa/sussurro são interrompidas

**Cenário Real:**
1. User diz: "Hey Rocky" (0.5s)
2. Pausa para pensar: "turn on the..." (1.5s silêncio)
3. Sistema acha silêncio > 3s, para gravação
4. Comando incompleto: "turn on the"
5. Whisper transcreve "turn on the" vazio

**Solução:**
```typescript
// ✅ MELHOR
const volume = float32Data.reduce((a, b) => a + Math.abs(b), 0) / 
               float32Data.length;
if (volume < 0.05) { // Threshold mais alto
  // Apenas após 5 segundos contínuos
  silenceTimeout = setTimeout(() => { ... }, 5000);
} else {
  // Reset timer se som detectado
  if (silenceTimeout) clearTimeout(silenceTimeout);
  silenceTimeout = null;
}
```

---

#### ⚠️ ERRO #2: Variável mediaRecorder Obsoleta

```typescript
// ❌ PROBLEMA
let mediaRecorder: MediaRecorder | null = null; // Nunca inicializado!

return () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop(); // mediaRecorder é SEMPRE null
    socket.emit("audio_stop");
  }
};
```

**Efeito:** Cleanup incompleto, pode deixar stream aberta

---

#### ⚠️ ERRO #3: Sem Tratamento de Erro de Microfone

```typescript
// ❌ PROBLEMA
navigator.mediaDevices.getUserMedia({ audio: true })
  .catch(err => {
    console.error("[Rocky] Error accessing microphone:", err);
    setIsListening(false);
    // NÃO notifica usuário na UI!
  });
```

**Cenários:**
- User nega permissão de microfone
- Sem microfone disponível
- Navegador não suporta API

**Usuário vê:** Nada... apenas mic icon desaparece

**Solução:** Mostrar notificação visual de erro

---

### Backend: Processamento de Audio_chunk

```typescript
// server.ts ~250
let isCommandActive = false;
let commandBuffers: Buffer[] = [];

socket.on("audio_chunk", (chunk: ArrayBuffer | Buffer) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  
  // ⚠️ PROBLEMA: Enviado para AMBOS
  if (wwService) wwService.sendAudio(buf); // Wake Word Service
  if (isCommandActive) commandBuffers.push(buf); // Command buffer
});
```

#### 🔴 ERRO CRÍTICO: Duplicação de Áudio

**Fluxo Real:**
```
User fala "Hey Rocky turn on the lights"
    ↓
Frontend envia audio chunks

Server audio_chunk handler:
├─ wwService.sendAudio(buf) → Wyoming (sempre)
└─ commandBuffers.push(buf) → Local (se isCommandActive)

Problema: Wake Word Service SEMPRE recebe áudio
- Mesmo durante transcrição de comando
- Usa banda desnecessariamente
- Pode detectar false positives durante fala
```

**Solução:**
```typescript
// ✅ CORRETO
socket.on("audio_chunk", (chunk: ArrayBuffer | Buffer) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  
  if (isCommandActive) {
    // Está transcrevendo comando - ignore wake word
    commandBuffers.push(buf);
  } else {
    // Aguardando detecção - enviar para wake word
    if (wwService) wwService.sendAudio(buf);
  }
});
```

---

### Fluxo Completo de Captura

```
┌─ ESTADO: Aguardando Wake Word
│
User: "Hey Rocky"
│
Audio Chunks enviados
    ├─ Chunk 1 → WW Service
    ├─ Chunk 2 → WW Service
    └─ Chunk 3 → WW Service (DETECÇÃO! 0.95 confidence)
│
wwService.on("detected") dispara
    ↓
isCommandActive = true
commandBuffers = []
socket.emit("wake_word_detected")
socket.emit("tts_audio", "Amaze! What is it?")
    ↓
┌─ ESTADO: Capturando Comando
│
User: "turn on the lights"
│
Audio Chunks enviados
    ├─ Chunk 1 → commandBuffers
    ├─ Chunk 2 → commandBuffers
    ├─ Chunk 3 → commandBuffers
    └─ Chunk 4 → commandBuffers
│
Silêncio detectado por 5s
│
processCommand():
  fullBuffer = Buffer.concat(commandBuffers)
  transcript = await whisperService.transcribe(fullBuffer)
    ↓
    TCP to Wyoming:10300
    Envia: { type: "audio-start", ... }
    Envia: { type: "audio-chunk", ... } + fullBuffer
    Envia: { type: "audio-stop", ... }
    Recebe: { type: "transcript", data: { text: "turn on the lights" } }
    ↓
  socket.emit("transcript_result", "turn on the lights")
  socket.emit("force_chat", "turn on the lights")
    ↓
┌─ Enviado para LLM
│
Server chat_request:
  OpenAI.chat.completions({
    messages: [system_prompt, ...history, user_message],
    stream: true
  })
    ├─ socket.emit("chat_token", token) × N
    └─ socket.emit("chat_response", final_text)
│
Server synthesize_voice:
  audio = await piperService.synthesize(responseText)
  socket.emit("tts_audio", wavAudio)
│
Frontend:
  setMessages([..., { role: "model", text: responseText }])
  play audio blob
    ↓
┌─ ESTADO: Aguardando Wake Word (volta ao início)
```

---

## 4️⃣ Piper Service - Text-to-Speech

### Arquivo: `src/services/piperService.ts`

#### Fluxo de Síntese
```
Input: "Turn on the lights"
    ↓
TCP Connect to Wyoming:10200
    ↓
Send: { type: "synthesize", data: { text: "Turn on the lights" } }
    ↓
Receive: State Machine (EVENT → DATA → PAYLOAD)
    ├─ EVENT: { type: "audio-start", ... }
    ├─ PAYLOAD: PCM audio data [bytes]
    └─ EVENT: { type: "audio-stop", ... }
    ↓
Return: Buffer com áudio PCM 16kHz 16-bit mono
    ↓
addWavHeader(audioBuffer)
    ↓
socket.emit("tts_audio", wavAudio)
    ↓
Frontend: play Blob WAV
```

#### ✅ Pontos Positivos
- State machine bem estruturado
- Timeout implementado (15s)
- Logging detalhado

#### ⚠️ ERRO #1: Parser State Machine Complexo

```typescript
// ❌ COMPLEXIDADE
let state: "EVENT" | "DATA" | "PAYLOAD" = "EVENT";
let remainingData = 0;
let remainingPayload = 0;

while (buffer.length > 0) {
  if (state === "EVENT") {
    // Parse JSON header até '\n'
    // Lê: event.data_length, event.payload_length
  } else if (state === "DATA") {
    // Pula event.data_length bytes
  } else if (state === "PAYLOAD") {
    // Coleta event.payload_length bytes
  }
}
```

**Risco:** Se Wyoming enviar formato diferente, loop fica preso

**Cenário de Erro:**
```javascript
// Se recebermos:
{ type: "audio-start", data_length: undefined }

Então: remainingData = 0 || 0 = 0
       state muda para PAYLOAD
       
Mas remainingPayload também pode ser undefined!
       remainingPayload = 0 || 0 = 0
       
Então state muda para EVENT, loop repete infinitamente?
```

---

#### ⚠️ ERRO #2: Sem Validação de "audio-stop"

```typescript
// ❌ PROBLEMA
if (type === "audio-stop") {
  console.log(`[Piper] Audio stream stopped.`);
  client.destroy();
  resolve(audioBuffer); // Resolve mesmo que vazio!
}
```

**Cenário:**
1. Piper server envia apenas `{ type: "audio-stop" }`
2. Nenhum audio data foi recebido
3. audioBuffer = Buffer.alloc(0)
4. Promise resolve com buffer vazio
5. Frontend toca áudio vazio (silêncio)

**Solução:**
```typescript
// ✅ CORRETO
if (type === "audio-stop") {
  if (audioBuffer.length === 0) {
    console.error("[Piper] No audio data received");
    reject(new Error("Piper returned empty audio"));
  } else {
    resolve(audioBuffer);
  }
}
```

---

#### ⚠️ ERRO #3: Timeout Pode Não Disparar

```typescript
// ❌ PROBLEMA
client.setTimeout(15000, () => {
  console.warn("[Piper] Synthesis timed out.");
  client.destroy(); // Destroi socket
  reject(new Error("Piper synthesis timed out"));
});

// TAMBÉM:
client.on("close", () => {
  resolve(audioBuffer); // Resolve imediatamente
});
```

**Race Condition:**
1. Timeout dispara em 15s
2. Chama `client.destroy()`
3. Isso dispara evento `close`
4. Evento `close` resolve Promise
5. Timeout callback tenta rejeitar Promise já resolvida
6. Erro é silenciado

---

## 5️⃣ Frontend-Backend Connection

### Socket Communication Overview

#### Backend Emits (Envia para Cliente)
```
┌─ AUDIO EVENTS
├─ tts_audio: Blob WAV para reproduzir
├─ tts_fallback: Texto para Web Speech API
├─ transcript_result: Resultado de transcrição
├─ force_chat: Força envio de mensagem
│
├─ CHAT EVENTS
├─ chat_token: Streaming token-by-token
├─ chat_response: Resposta final consolidada
├─ chat_history: Histórico ao conectar
│
├─ STATE EVENTS
├─ initial_state: Estado completo do sistema
├─ mode_updated: Modo mudou
├─ wake_word_detected: Wake word ativado
├─ weather_update: Clima atualizado
├─ stats: CPU/RAM/Temp
│
├─ PROTOCOL EVENTS
├─ protocol_updated: Protocolo salvo
├─ protocol_created: Novo protocolo
├─ protocol_deleted: Protocolo deletado
│
└─ LOG EVENTS
  ├─ new_log: Novo log adicionado
  └─ device_updated: Dispositivo mudou
```

#### Frontend Emits (Envia para Servidor)
```
┌─ AUDIO EVENTS
├─ audio_chunk: Buffer PCM 16kHz 16-bit
├─ audio_stop: Para a captura
├─ manual_trigger: Ativa captura manual
│
├─ CHAT EVENTS
├─ chat_request: { message, history }
├─ save_message: Persist mensagem
│
├─ DEVICE CONTROL
├─ control_device: { device, action, params }
├─ set_mode: Altera modo do sistema
├─ execute_routine: Home/Night/Away
│
├─ PROTOCOL EVENTS
├─ save_protocol: Atualiza protocolo
├─ create_protocol: Cria novo
├─ delete_protocol: Deleta
│
├─ SYSTEM EVENTS
├─ sync_ha: Sincroniza com Home Assistant
├─ add_log: Adiciona ao log
└─ synthesize_voice: Sintetiza voz
```

---

### ⚠️ ERRO #1: Inconsistência em Resposta de Chat

```typescript
// server.ts: Streaming
const stream = await openai.chat.completions.create({
  model: LOCAL_LLM_MODEL,
  messages: messages,
  stream: true,
});

let fullContent = "";
for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || "";
  if (content) {
    fullContent += content;
    socket.emit("chat_token", content); // Emite cada token
  }
}

// Depois:
socket.emit("chat_response", { text: cleanResponse }); // Resposta "limpa"
```

**Problema:**
```
Frontend recebe tokens:
  "Turn"
  " on"
  " the"
  " studio"
  " lights"

Concatena: "Turn on the studio lights"

Mas servidor também:
  Remove JSON blocks: cleanResponse.replace(jsonMatch[0], "")
  Trim whitespace
  
Emite: "Turn on the lights" (sem "studio")

RESULTADO: Final message ≠ Streamed message
```

---

### ⚠️ ERRO #2: Race Condition em TTS

```typescript
// server.ts
socket.emit("chat_response", { text: cleanResponse }); // ANTES

try {
  const audio = await piperService.synthesize(cleanResponse); // Depois
  socket.emit("tts_audio", wavAudio);
} catch (err) {
  socket.emit("tts_fallback", cleanResponse);
}
```

**Timeline:**
```
T=0ms:   socket.emit("chat_response")
T=50ms:  Frontend exibe mensagem
T=100ms: piperService.synthesize() começa
T=2000ms: piperService termina
T=2100ms: socket.emit("tts_audio")
T=2150ms: Frontend toca áudio

PROBLEMA: Áudio toca 2 segundos DEPOIS da mensagem aparecer
```

**Solução:** Aguardar síntese antes de emitir response:

```typescript
// ✅ CORRETO
let audioBuffer: Buffer | null = null;
try {
  audioBuffer = await piperService.synthesize(cleanResponse);
} catch (err) {
  console.error("[Rocky TTS Error]", err);
}

socket.emit("chat_response", { text: cleanResponse, audio: audioBuffer ? true : false });

if (audioBuffer) {
  const wavAudio = addWavHeader(audioBuffer);
  socket.emit("tts_audio", wavAudio);
} else {
  socket.emit("tts_fallback", cleanResponse);
}
```

---

### ⚠️ ERRO #3: Sem Tratamento de Erro em Whisper

```typescript
// server.ts ~280
const processCommand = async () => {
  try {
    const transcript = await whisperService.transcribe(fullBuffer);
    if (transcript && transcript.trim()) {
      socket.emit("transcript_result", transcript);
      socket.emit("force_chat", transcript);
    } else {
      console.log("[Rocky] Transcript empty."); // Silencioso
    }
  } catch (err) {
    console.error("[Rocky Transcription Error]", err);
    // NÃO notifica frontend
  }
};
```

**Impacto:**
- User fala, interface muda para "visualizer"
- Aguarda transcrição
- Whisper falha (timeout, conexão perdida, etc.)
- Nothing happens, user confuso

**Solução:**
```typescript
// ✅ CORRETO
catch (err) {
  console.error("[Rocky Transcription Error]", err);
  socket.emit("transcript_error", { 
    message: "Speech recognition failed. Please try again."
  });
  socket.emit("wake_word_detected"); // Volta ao estado aguardando
}
```

---

## 6️⃣ Rotas e Endpoints

### HTTP Endpoints

#### `GET /api/health`
```
Response: { status: "ok", message: "Rocky is alive, yes!" }
Purpose: Health check para Docker
```

### Socket Endpoints - Detalhado

#### **Audio Pipeline**

##### `Client → Server: audio_chunk`
```typescript
socket.emit("audio_chunk", ArrayBuffer); // 16kHz, 16-bit, mono, 4096 samples
```
- **Frequência**: A cada 256ms (~4096 samples a 16kHz)
- **Destino**: Wake Word Service + Command Buffers (se ativo)
- **Sem Validação**: ❌ Pode enviar continuamente

---

##### `Server → Client: tts_audio`
```typescript
socket.emit("tts_audio", ArrayBuffer); // WAV com header
// Frontend:
const blob = new Blob([data], { type: "audio/wav" });
const url = URL.createObjectURL(blob);
const audio = new Audio(url);
audio.play().catch(console.error);
```

---

#### **Chat Pipeline**

##### `Client → Server: chat_request`
```typescript
socket.emit("chat_request", {
  message: "turn on the lights",
  history: [
    { role: "user", text: "..." },
    { role: "model", text: "..." }
  ]
});
```

**Server Processing:**
1. Formata histórico em formato OpenAI
2. Cria prompt system em português (⚠️ Inconsistência!)
3. Streaming with `stream: true`
4. Emite tokens individuais
5. Parseia JSON para tool calls
6. Sintetiza resposta com Piper

---

##### `Server → Client: chat_token`
```typescript
socket.emit("chat_token", "Turn"); // Enviado múltiplas vezes
socket.emit("chat_token", " on");
socket.emit("chat_token", " the");
```

---

##### `Server → Client: chat_response`
```typescript
socket.emit("chat_response", { text: "Turn on the lights" });
```

---

#### **Control Events**

##### `Client → Server: control_device`
```typescript
socket.emit("control_device", {
  device: "studio",
  action: "set",
  params: { brightness: 80, color: "#ff00ff" }
});
```

**❌ SEM VALIDAÇÃO:**
```typescript
// server.ts ~400
socket.on("control_device", async (data) => {
  const { device, action, params } = data; // Sem validação!
  const success = await controlHALight(device, action, params);
  // device pode ser qualquer string
  // action pode ser qualquer valor
  // params pode conter dados malformados
});
```

---

## 7️⃣ Problemas Críticos Identificados

### 🔴 SEVERIDADE CRÍTICA (Blockers)

#### **#1: Wake Word Service - Sem Auto-Reconexão**
| Impacto | Severidade | Frequência |
|---------|-----------|-----------|
| Impossível detectar wake word após desconexão | 🔴 Crítico | Alta em WiFi instável |

**Cenário Real:**
1. WiFi instável → socket drop
2. WakeWord Service desconecta
3. isConnected = false
4. Sem retry automático
5. User precisa reload página
6. Em produção: inaceitável

**Fix Necessário:** Implementar exponential backoff reconnect

---

#### **#2: Whisper Service - Sem Timeout**
| Impacto | Severidade | Frequência |
|---------|-----------|-----------|
| Promise pendurada, recursos esgotados | 🔴 Crítico | Baixa mas catastrófica |

**Cenário:**
1. User fala
2. Wyoming Whisper trava (bug, crash, etc.)
3. whisperService.transcribe() fica aguardando
4. Promise nunca resolve
5. Após múltiplas ocorrências, server fica lento

---

#### **#3: Audio Chunk Duplicado (WW + Command)**
| Impacto | Severidade | Frequência |
|---------|-----------|-----------|
| Confusão de estado, processamento duplicado | 🔴 Crítico | Sempre |

**Design Issue:** Enviar chunks para AMBOS wake word e command buffers simultaneamente gera ambiguidade

---

### 🟠 SEVERIDADE ALTA

#### **#4: Detecção Silêncio Muito Sensível**
- Threshold 0.01 muito baixo
- Corta áudio após 3 segundos de pausa
- Afeta usabilidade

---

#### **#5: Sem Tratamento Erro Microfone**
- User nega permissão → silêncio
- Sem feedback visual
- Confusão do usuário

---

#### **#6: Resposta Chat: Remoção JSON Potencialmente Perigosa**
```typescript
// Remove JSON block da resposta
cleanResponse = responseText.replace(jsonMatch[0], "").trim();
```
Se LLM inclui JSON legítimo, será removido

---

#### **#7: Parsing Resposta Chat: Token ≠ Final Message**
- Tokens streaming podem diferir de resposta final
- Inconsistência visual

---

### 🟡 SEVERIDADE MÉDIA

#### **#8: Sem Rate Limiting em Socket Events**
- Cliente pode enviar `audio_chunk` infinitamente
- DoS potencial

---

#### **#9: useAudioAnalyzer Hook Não Utilizado**
```typescript
// Definido mas nunca importado/usado
export function useAudioAnalyzer(isActive: boolean) { ... }
```
Código morto

---

#### **#10: Timeout em Piper Pode Não Disparar**
- Race condition entre `close` e `setTimeout`
- Promise já resolvida recebe rejection

---

---

## 8️⃣ Diagrama de Fluxo Completo

```
┌─────────────────────────────────────────────────────┐
│            SISTEMA ROCKY - FLUXO COMPLETO            │
└─────────────────────────────────────────────────────┘

                    ┌─── Frontend (React) ───┐
                    │                         │
                    │ 1. getUserMedia()       │
                    │ 2. AudioContext 16kHz   │
                    │ 3. ScriptProcessor      │
                    │ 4. Float32 → Int16      │
                    │ 5. socket.emit("audio")│
                    └──────────┬──────────────┘
                               ↓
                    ┌─── Server (Express) ───┐
                    │                         │
        ┌───────────→ socket.on("audio_chunk")
        │           │                         │
        │           │ if !isCommandActive:    │
        │           │   → wwService.send()   │
        │           │ else:                   │
        │           │   → commandBuffers.push │
        │           └──────────┬──────────────┘
        │                      ↓
        │          ┌────── Wyoming ──────┐
        │          │                      │
        │          │ WakeWord Service     │
        │          │ (Port 10400)         │
        │          │ openwakeword model   │
        │          │                      │
        │   ┌──────→ Detect "amaze"      │
        │   │      │ confidence: 0.95    │
        │   │      └──────────┬──────────┘
        │   │                 ↓
        │   │    ┌─ Event: detection ──┐
        │   │    │                      │
        │   │    │ isCommandActive=true │
        │   │    │ commandBuffers=[]    │
        │   │    │ emit("wake_detected")│
        │   │    └──────────┬──────────┘
        │   │               ↓
        │   │    ┌─ Piper Synthesis ──┐
        │   │    │ "Amaze! What is it?"
        │   │    │ → socket.emit(tts)  │
        │   │    └────────────────────┘
        │   │
        │   │    ┌─ User speaks ──┐
        │   │    │ "turn on..."    │
        │   └────→ audio_chunks    │
        │         collected        │
        │                          │
        │    ┌─ Silence 5s timeout─┐
        │    │ processCommand()     │
        │    │ fullBuffer concat    │
        │    └────────┬────────────┘
        │             ↓
        │    ┌─ Whisper Service ──┐
        │    │ (Port 10300)        │
        │    │ transcribe(buffer)  │
        │    │ → transcript        │
        │    └────────┬────────────┘
        │             ↓
        │    ┌─ emit("transcript_result")
        │    │ emit("force_chat")
        │    └────────┬────────────┘
        │             ↓
        │    ┌─ Chat Request ──┐
        │    │ message: "..."   │
        │    │ history: [...]   │
        │    └────────┬────────┘
        │             ↓
        │    ┌─ Ollama (Local LLM) ──┐
        │    │ Model: gemma:2b        │
        │    │ streaming: true        │
        │    │ stream tokens...       │
        │    └────────┬──────────────┘
        │             ↓
        │    ┌─ emit("chat_token") ×N
        │    │ "Turn"
        │    │ " on"
        │    │ " the"
        │    │ " lights"
        │    └────────┬──────────────┘
        │             ↓
        │    ┌─ emit("chat_response") ──┐
        │    │ text: "Turn on the lights"│
        │    └────────┬──────────────────┘
        │             ↓
        │    ┌─ Piper Synthesis ──┐
        │    │ text: "..."         │
        │    │ → audio buffer      │
        │    └────────┬────────────┘
        │             ↓
        │    ┌─ emit("tts_audio") ──┐
        │    │ WAV blob              │
        │    └────────┬──────────────┘
        │             ↓
        └─────→ socket.emit() → Frontend
        
    ┌──────────────────────────────────────────┐
    │ Frontend Receives:                       │
    │ - chat_response → Display message        │
    │ - tts_audio → Play audio (new Audio())   │
    │ - Re-enter "Awaiting Wake Word" state    │
    └──────────────────────────────────────────┘
```

---

## 9️⃣ Recomendações por Prioridade

### 🔴 PRIORITY 1 - IMEDIATO (Esta Sprint)

#### [ ] 1. Implementar Auto-Reconexão em WakeWordService
**Arquivo:** `src/services/wakeWordService.ts`

```typescript
// Adicionar método reconnect com exponential backoff
private reconnectAttempts = 0;
private readonly MAX_RECONNECT_ATTEMPTS = 5;
private readonly INITIAL_RECONNECT_DELAY = 1000;

reconnect() {
  if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
    console.error("[WakeWord] Max reconnection attempts reached");
    this.emit("connection_failed");
    return;
  }

  const delay = this.INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts);
  console.log(`[WakeWord] Reconnecting in ${delay}ms... (attempt ${++this.reconnectAttempts})`);
  
  setTimeout(() => this.connect(), delay);
}

// Em connect():
client.on("close", () => {
  this.isConnected = false;
  this.reconnect(); // ← ADD THIS
});

client.on("error", () => {
  this.isConnected = false;
  this.reconnect(); // ← ADD THIS
});
```

**Expected Benefit:** Recuperação automática após desconexão

---

#### [ ] 2. Adicionar Timeout em WhisperService
**Arquivo:** `src/services/whisperService.ts`

```typescript
async transcribe(audioBuffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let transcript = "";
    
    // ← ADD THIS
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error("Whisper transcription timeout (30s)"));
    }, 30000);
    
    client.connect(this.port, this.host, () => {
      // ... existing code
    });

    client.on("data", (data) => {
      clearTimeout(timeout); // ← ADD THIS
      timeout.refresh(); // Reset on activity
      // ... existing code
    });

    client.on("close", () => {
      clearTimeout(timeout); // ← ADD THIS
      resolve(transcript);
    });

    client.on("error", (err) => {
      clearTimeout(timeout); // ← ADD THIS
      reject(err);
    });
  });
}
```

**Expected Benefit:** Previne hanging promises

---

#### [ ] 3. Corrigir Header Duplicado em Wyoming Services
**Arquivo:** `src/services/whisperService.ts` + `src/services/wakeWordService.ts`

```typescript
// ❌ BEFORE
const event = {
  type: "audio-chunk",
  data: { rate: 16000, width: 2, channels: 1 },
  rate: 16000,        // Remove
  width: 2,           // Remove
  channels: 1,        // Remove
  payload_length: audioBuffer.length
};

// ✅ AFTER
const event = {
  type: "audio-chunk",
  data: { rate: 16000, width: 2, channels: 1 },
  payload_length: audioBuffer.length
};
```

**Expected Benefit:** Conformidade com protocolo Wyoming

---

#### [ ] 4. Refatorar Audio Pipeline (Evitar Duplicação)
**Arquivo:** `server.ts` (socket.on("audio_chunk"))

```typescript
// ❌ BEFORE
socket.on("audio_chunk", (chunk) => {
  if (wwService) wwService.sendAudio(buf); // SEMPRE
  if (isCommandActive) commandBuffers.push(buf); // TAMBÉM
});

// ✅ AFTER
socket.on("audio_chunk", (chunk) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  
  if (isCommandActive) {
    // Durante comando: só capturar
    commandBuffers.push(buf);
  } else {
    // Aguardando: só detectar wake word
    if (wwService) wwService.sendAudio(buf);
  }
});
```

**Expected Benefit:** Design mais limpo, evita processamento duplicado

---

### 🟠 PRIORITY 2 - PRÓXIMA SPRINT

#### [ ] 5. Aumentar Threshold de Silêncio
**Arquivo:** `src/App.tsx` (useEffect com isListening)

```typescript
// ❌ BEFORE
if (volume < 0.01) { // Very low
  if (!silenceTimer) {
    silenceTimer = setTimeout(() => setIsListening(false), 3000);
  }
}

// ✅ AFTER
const SILENCE_THRESHOLD = 0.05; // 5x higher
const SILENCE_DURATION = 5000; // 5 seconds

if (volume < SILENCE_THRESHOLD) {
  if (!silenceTimer) {
    silenceTimer = setTimeout(() => setIsListening(false), SILENCE_DURATION);
  }
} else {
  // Sound detected, reset timer
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}
```

**Expected Benefit:** Menos false positives em detecção silêncio

---

#### [ ] 6. Implementar Rate Limiting em Socket Events
**Arquivo:** `server.ts` (io.on("connection"))

```typescript
// Dentro do socket handler
const AUDIO_CHUNK_RATE_LIMIT = 200; // Max 1 chunk per 200ms
let lastAudioChunkTime = 0;

socket.on("audio_chunk", (chunk) => {
  const now = Date.now();
  if (now - lastAudioChunkTime < AUDIO_CHUNK_RATE_LIMIT) {
    console.warn("[Rocky] Audio chunks too frequent, dropping");
    return; // Drop excess chunks
  }
  lastAudioChunkTime = now;
  
  // Process chunk
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (isCommandActive) commandBuffers.push(buf);
  else if (wwService) wwService.sendAudio(buf);
});
```

**Expected Benefit:** Proteção contra DoS

---

#### [ ] 7. Adicionar Validação em control_device
**Arquivo:** `server.ts` (socket.on("control_device"))

```typescript
const VALID_DEVICES = ["studio", "desk", "kitchen", "bedroom", "living", "ambient", "all"];
const VALID_ACTIONS = ["on", "off", "toggle", "set"];

socket.on("control_device", async (data) => {
  // Validação
  if (!data || typeof data !== "object") {
    console.error("[Rocky] Invalid control_device payload");
    return;
  }
  
  const { device, action, params } = data;
  
  if (!VALID_DEVICES.includes(device)) {
    console.error(`[Rocky] Invalid device: ${device}`);
    return;
  }
  
  if (!VALID_ACTIONS.includes(action)) {
    console.error(`[Rocky] Invalid action: ${action}`);
    return;
  }
  
  // Process...
});
```

**Expected Benefit:** Segurança contra payloads malformados

---

#### [ ] 8. Corrigir Inconsistência Chat Response
**Arquivo:** `server.ts` (socket.on("chat_request"))

```typescript
// ✅ ANTES DE EMITIR RESPONSE
// Aguardar síntese antes de enviar response
let synthesisError = false;
try {
  const audio = await piperService.synthesize(cleanResponse);
  const wavAudio = addWavHeader(audio);
  
  // Emit response COM informação de áudio
  socket.emit("chat_response", { 
    text: cleanResponse,
    audioReady: true
  });
  
  // Depois enviar áudio
  socket.emit("tts_audio", wavAudio);
} catch (err) {
  synthesisError = true;
  socket.emit("chat_response", { 
    text: cleanResponse,
    audioReady: false
  });
  socket.emit("tts_fallback", cleanResponse);
}
```

---

### 🟡 PRIORITY 3 - TÉCNICO (Refactoring)

#### [ ] 9. Remover mediaRecorder Não Utilizado
**Arquivo:** `src/App.tsx`

```typescript
// ❌ REMOVER ESTAS LINHAS:
let mediaRecorder: MediaRecorder | null = null;

// E ESTA:
if (mediaRecorder && mediaRecorder.state !== "inactive") {
  mediaRecorder.stop();
}
```

---

#### [ ] 10. Remover useAudioAnalyzer Não Utilizado
**Arquivo:** `src/hooks/useAudioAnalyzer.ts`

Se não utilizado em nenhum componente:
```
rm src/hooks/useAudioAnalyzer.ts
```

---

#### [ ] 11. Adicionar Error Handling para Microfone
**Arquivo:** `src/App.tsx`

```typescript
const [microphoneError, setMicrophoneError] = useState<string | null>(null);

navigator.mediaDevices.getUserMedia({ audio: true })
  .catch(err => {
    console.error("[Rocky] Microphone error:", err);
    
    let errorMsg = "Microphone access denied";
    if (err.name === "NotAllowedError") {
      errorMsg = "Please allow microphone access";
    } else if (err.name === "NotFoundError") {
      errorMsg = "No microphone found";
    }
    
    setMicrophoneError(errorMsg);
    setIsListening(false);
  });

// Render error message
{microphoneError && (
  <div className="text-red-500 text-xs p-2">
    ⚠️ {microphoneError}
  </div>
)}
```

---

#### [ ] 12. Adicionar Logging Estruturado
**Arquivo:** `src/lib/logger.ts` (novo)

```typescript
export const logger = {
  info: (tag: string, msg: string) => console.log(`[${tag}] ${msg}`),
  warn: (tag: string, msg: string) => console.warn(`⚠️ [${tag}] ${msg}`),
  error: (tag: string, msg: string, err?: any) => 
    console.error(`❌ [${tag}] ${msg}`, err || ""),
  debug: (tag: string, msg: string) => console.debug(`🔍 [${tag}] ${msg}`)
};
```

---

## 📊 Checklist de Correção

```
PRIORITY 1 (CRÍTICO):
☐ [ ] WakeWordService auto-reconnect
☐ [ ] WhisperService timeout (30s)
☐ [ ] Remover header duplicado (Whisper + WakeWord)
☐ [ ] Refatorar audio pipeline (evitar duplicação)

PRIORITY 2 (ALTO):
☐ [ ] Threshold silêncio 0.05 (era 0.01)
☐ [ ] Rate limiting socket events
☐ [ ] Validação control_device
☐ [ ] Chat response: aguardar síntese

PRIORITY 3 (TÉCNICO):
☐ [ ] Remover mediaRecorder
☐ [ ] Remover useAudioAnalyzer
☐ [ ] Tratamento erro microfone (UI)
☐ [ ] Logging estruturado

TESTES NECESSÁRIOS:
☐ [ ] Teste: WiFi disconnect → auto-recover
☐ [ ] Teste: Whisper timeout → recovery
☐ [ ] Teste: Silêncio durante fala (não cortar)
☐ [ ] Teste: Chat response ≈ Streamed tokens
☐ [ ] Teste: Audio ready antes de reproduzir
☐ [ ] Teste: Rate limiting (enviar 1000 chunks/s)
```

---

## 📝 Conclusão

Project Hail Rocky é um projeto **bem arquitetado** mas com **problemas críticos de produção**:

### ✅ Forças
- Arquitetura limpa (frontend-backend bem separados)
- Uso correto de Wyoming protocol
- PCM audio encoding correto (16kHz, 16-bit, mono)
- State management simples mas funcional

### ⚠️ Fraquezas
- **Sem auto-reconnect no Wake Word** (bloqueador)
- **Sem timeout no Whisper** (pode travar)
- **Design de audio duplicado** (confusão de estado)
- **Sensibilidade silêncio muito alta** (corta áudio)
- **Sem validação entrada socket** (segurança)

### 🎯 Ação Imediata
Implementar Priority 1 antes de colocar em produção. Os outros problemas podem ser resolvidos na próxima sprint.

---

**Análise Completa por:** Rocky Engineer v1.0.4  
**Data:** Abril 2026  
**Detalhamento:** Minucioso ✓

