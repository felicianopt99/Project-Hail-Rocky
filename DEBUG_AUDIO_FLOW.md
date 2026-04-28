# 🔍 Debug Audio Flow - Guia Completo

## ⚡ O que foi mudado

**Frontend:**
- ✅ Nova hook `useAudioManager.ts` com máquina de estados blindada
- ✅ AudioWorklet com fallback automático para MediaRecorder
- ✅ Logs estruturados em CADA transição de estado
- ✅ Socket reconnect com heartbeat (ping a cada 30s)

**Backend:**
- ✅ Audio buffer com limite de 5MB
- ✅ Validação robusto de chunks
- ✅ Cleanup automático de sessões stale (timeout 5s)
- ✅ Logs detalhados com [CONNECT], [AUDIO], [DISCONNECT]

**AudioWorklet:**
- ✅ Logging do carregamento e processamento
- ✅ Tratamento de erros com fallback

---

## 🚀 Como testar agora

### 1. **Abre DevTools (F12)**
Vai para a aba **Console** — vais ver logs estruturados em tempo real.

### 2. **Clica no mic**
Deves ver esta sequência no console:

```
[AudioManager] [INFO] Manual trigger activated by user
[AudioManager] [INFO] Starting audio capture...
[AudioManager] [INFO] Requesting microphone access...
[AudioManager] [INFO] Microphone access granted
[AudioManager] [INFO] Attempting to load AudioWorklet...
[AudioManager] [INFO] AudioWorklet loaded successfully
[AudioManager] [INFO] Using AudioWorklet for audio capture
[AudioWorklet] [INFO] PCMProcessor constructor called
[AudioWorklet] [INFO] Initialized {inputRate: 48000, targetRate: 16000, ratio: "3.00"}
[SocketIO] [INFO] Heartbeat acknowledged {latency: "123ms"}
```

---

## 🎯 Checklist de Diagnóstico

Copia esta checklist e valida cada ponto:

### Ponto 1: Socket conectado?
```
[SocketIO] [INFO] Initializing Socket.io connection {deviceId: "device_..."}
[SocketIO] [INFO] Socket connected successfully {socketId: "xyz", transport: "websocket"}
```
✅ SIM = vai para Ponto 2
❌ NÃO = problema de conexão com servidor

### Ponto 2: AudioContext inicializado?
```
[AudioManager] [INFO] AudioContext created {state: "running", sampleRate: 48000}
[AudioManager] [INFO] AudioContext initialized successfully
```
✅ SIM = vai para Ponto 3
❌ NÃO = browser não suporta Web Audio API

### Ponto 3: Microfone permitido?
```
[AudioManager] [INFO] Microphone access granted {audioTracks: 1, trackSettings: {...}}
```
✅ SIM = vai para Ponto 4
❌ NÃO = permissões do browser bloqueadas (verifica URL — precisa HTTPS ou localhost)

### Ponto 4: AudioWorklet carregou?
```
[AudioManager] [INFO] AudioWorklet loaded successfully
[AudioWorklet] [INFO] PCMProcessor registered successfully
```
✅ SIM = vai para Ponto 5
❌ NÃO = `/public/pcm-processor.js` não existe ou tem erro

### Ponto 5: Chunks de áudio fluindo?
```
[AudioWorklet] [INFO] Chunks processed {count: 100, bytesPerChunk: 2048}
[SocketIO] [INFO] Audio flowing {chunkCount: 50, bufferSize: 102400}
```
✅ SIM = áudio está a enviar para servidor
❌ NÃO = problema no AudioWorklet ou conexão de socket

### Ponto 6: Backend a receber?
No terminal/logs do servidor, deves ver:
```
[SocketHandlers] [INFO] Audio flowing {chunkCount: 50, bufferSize: 102400}
```
✅ SIM = chunks chegaram ao backend
❌ NÃO = problema de transmissão pela rede

---

## 🔴 Se falhar em algum ponto

### Falha em Ponto 2 (AudioContext)
```
❌ [AudioManager] [ERROR] Failed to initialize AudioContext: AudioContext not supported
```
**Solução:** Browser muito antigo ou sandbox. Tenta em Chrome/Firefox recente.

---

### Falha em Ponto 3 (Microfone)
```
❌ [AudioManager] [ERROR] Microphone access denied {error: "NotAllowedError", message: "..."}
```
**Solução:**
- Se vires "requires secure context": muda para `https://localhost` ou usa outro domínio HTTPS
- Se vires "NotFoundError": não há mic ligado ao PC

---

### Falha em Ponto 4 (AudioWorklet)
```
❌ [AudioManager] [WARN] AudioWorklet failed to load {error: "Error: pcm-processor.js not found"}
```
**Solução:**
- Verifica se `/public/pcm-processor.js` existe
- Verifica se `npm run dev` está a servir ficheiros estáticos correctamente
- Tenta fazer refresh (Ctrl+F5) para limpar cache

---

### Falha em Ponto 5 (Chunks não fluem)
```
❌ [AudioWorklet] [ERROR] Process error: "Cannot read property 'length' of undefined"
```
**Solução:**
- AudioWorklet tem um bug. Verifica o código em `/public/pcm-processor.js` linha 40+
- Se tudo parece correto, o fallback para MediaRecorder deve activar automaticamente
- Deves ver:
```
[AudioManager] [WARN] AudioWorklet not available, using MediaRecorder fallback
[AudioManager] [INFO] Initializing MediaRecorder fallback...
```

---

### Falha em Ponto 6 (Backend não recebe)
```
❌ Backend logs vazios, mas frontend diz que está a enviar
```
**Solução:**
- WebSocket cortado: valida que Socket.io está activo (`socket.connected === true`)
- Firewall: verifica se a porta de Socket.io (normalmente 3005) está aberta
- CORS: se há erro de CORS, verifica `server.ts` Socket.io configuração

---

## 📊 Estados Esperados

Quando tudo funciona, o flow é:

```
idle 
  ↓ (clicas mic)
requesting_mic → listening → processing → speaking → idle
```

**Estados no Console:**
```
[AudioManager] [INFO] audioState changed: idle → requesting_mic
[AudioManager] [INFO] audioState changed: requesting_mic → listening
[SocketIO] [INFO] Status update from server {status: "listening"}
[SocketIO] [INFO] Status update from server {status: "processing_stt"}
[SocketIO] [INFO] Status update from server {status: "thinking_llm"}
[SocketIO] [INFO] Status update from server {status: "synthesizing_tts"}
[SocketIO] [INFO] Status update from server {status: "idle"}
```

---

## 🛠️ Comandos úteis para debug

### Ver se Socket.io está ligado
```javascript
// No console do browser:
socket.connected  // true/false
socket.id         // ID da conexão
```

### Ver buffer de áudio no servidor
```javascript
// Não é possível do browser, mas o server loga:
// [SocketHandlers] [INFO] Audio flowing {chunkCount: 50, bufferSize: 102400}
```

### Limpar localStorage e reconectar
```javascript
localStorage.clear()
location.reload()
```

---

## 📝 Log levels

- **[INFO]** — Flow normal, não é erro
- **[WARN]** — Algo inesperado mas com fallback (ex: AudioWorklet falhou, usa MediaRecorder)
- **[ERROR]** — Problema crítico, feature não funciona

Tudo com timestamp ISO:
```
2026-04-28T14:23:45.123Z [AudioManager] [INFO] ...
```

---

## 💡 Próximos passos após confirmar flow

1. ✅ Áudio a chegar ao servidor
2. ⏭️ Validar que Groq STT está a processar (adiciona logs em `orchestratorService`)
3. ⏭️ Validar que LLM está a responder
4. ⏭️ Validar que TTS (Kokoro/Piper) está a enviar áudio de volta

**Vem cá quando vires os logs funcionando.**
