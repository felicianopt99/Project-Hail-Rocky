# 🔴 Quick Reference: Erros Identificados

## Matrix de Erros por Severidade

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🔴 CRÍTICO (3)      │ 🟠 ALTO (5)      │ 🟡 MÉDIO (4)     │        │
│ Blockers            │ Funcionalidade   │ Código            │ TOTAL: │
│                     │ Degradada        │ Debt              │ 12     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔴 CRÍTICOS (Blockers)

### ERRO #1: Wake Word Service - Sem Auto-Reconexão
```
Arquivo:     src/services/wakeWordService.ts
Linha:       34-40 (client.on("close"))
Severidade:  🔴 CRÍTICO
Frequência:  ALTA (WiFi instável)
────────────────────────────────────────────
Problema:
  ❌ Desconexão TCP → isConnected = false
  ❌ Sem retry automático
  ❌ Wake word nunca mais funciona
  ❌ Usuário precisa reload da página

Impacto:
  ❌ Inaceitável para produção
  ❌ Experiência do usuário horrível
  ❌ Suporte: reboot the app

Solução:
  ✅ Implementar exponential backoff reconnect
  ✅ Emitir evento "connection_failed" ao frontend
  ✅ Max 5 tentativas com delay 1s → 32s

Tempo Estimado: 30 minutos
Risco: Baixo (apenas adiciona retry logic)
```

---

### ERRO #2: Whisper Service - Sem Timeout
```
Arquivo:     src/services/whisperService.ts
Linha:       7-42 (async transcribe)
Severidade:  🔴 CRÍTICO
Frequência:  BAIXA mas CATASTRÓFICA
────────────────────────────────────────────
Problema:
  ❌ Promise nunca resolve se Wyoming trava
  ❌ Socket fica aberto indefinidamente
  ❌ Após N ocorrências → server esgotado

Cenário:
  1. User fala
  2. Wyoming Whisper bug/crash
  3. Promise pendurada
  4. Client aguarda infinitamente
  5. Sem retorno, sem erro → confuso

Impacto:
  ❌ Microphone trava
  ❌ Interface congelada
  ❌ Sem feedback do erro

Solução:
  ✅ Adicionar client.setTimeout(30000)
  ✅ clearTimeout() em "close" event
  ✅ Rejeitar Promise após timeout

Tempo Estimado: 15 minutos
Risco: Muito baixo
```

---

### ERRO #3: Audio Chunks Duplicados (Design)
```
Arquivo:     server.ts
Linha:       ~250-260 (socket.on("audio_chunk"))
Severidade:  🔴 CRÍTICO
Frequência:  SEMPRE (design issue)
────────────────────────────────────────────
Problema:
  ❌ Mesmos chunks enviados SIMULTANEAMENTE para:
     1. Wake Word Service (detecção contínua)
     2. Command Buffers (transcrição após detecção)
  ❌ Confusão de estado: isCommandActive vs wwService.send()

Fluxo Problemático:
  Audio Chunks:
  ├─ wwService.sendAudio(buf)    ← SEMPRE
  └─ if (isCommandActive) command.push(buf)  ← TAMBÉM

Impacto:
  ❌ Lógica confusa e difícil debugar
  ❌ False positives de wake word durante transcrição
  ❌ Processamento duplicado

Solução:
  ✅ Usar um único caminho baseado em estado:
     if (isCommandActive) {
       commandBuffers.push(buf);  // Capturar
     } else {
       wwService.sendAudio(buf);  // Detectar
     }

Tempo Estimado: 10 minutos
Risco: Muito baixo (apenas lógica)
```

---

## 🟠 ALTOS (Funcionalidade Degradada)

### ERRO #4: Header PCM Duplicado em Wyoming Services
```
Arquivo:     src/services/whisperService.ts (18-27)
             src/services/wakeWordService.ts (35-44)
Severidade:  🟠 ALTO
────────────────────────────────────────────
Problema:
  ❌ Campos duplicados no top-level do JSON

Estrutura INCORRETA:
  {
    type: "audio-chunk",
    data: { rate: 16000, width: 2, channels: 1 },
    rate: 16000,        // ← Duplicado
    width: 2,           // ← Duplicado
    channels: 1,        // ← Duplicado
    payload_length: 512
  }

Efeito:
  ❌ Wyoming pode ficar confuso
  ❌ Pode gerar parsing errors
  ❌ Transcrição pode ficar incorreta

Solução:
  ✅ Remover campos duplicados no top-level
  {
    type: "audio-chunk",
    data: { rate: 16000, width: 2, channels: 1 },
    payload_length: 512
  }

Tempo Estimado: 5 minutos
Risco: Muito baixo
```

---

### ERRO #5: Detecção Silêncio Muito Sensível
```
Arquivo:     src/App.tsx
Linha:       ~190-210 (processor.onaudioprocess)
Severidade:  🟠 ALTO
────────────────────────────────────────────
Problema:
  ❌ Threshold = 0.01 (muito baixo!)
  ❌ Timeout = 3000ms (muito curto)
  ❌ Corta áudio durante pausa natural da fala

Cenário Real:
  User: "Hey Rocky... [pausa para pensar] ...turn on"
  ├─ "Hey Rocky" (0.5s) ✓
  ├─ Silêncio (1.5s)
  ├─ System: "volume < 0.01, timeout started"
  ├─ After 3s: "setIsListening(false)" ❌
  └─ "turn on" nunca é captado

Impacto:
  ❌ Muitos comandos incompletos
  ❌ Péssima experiência do usuário
  ❌ Frustrante, faz parecer bugado

Solução:
  ✅ Aumentar threshold: 0.01 → 0.05 (5x)
  ✅ Aumentar timeout: 3000ms → 5000ms
  ✅ Reset timer se som detectado:
     if (volume >= THRESHOLD) clearTimeout(timer);

Tempo Estimado: 10 minutos
Risco: Muito baixo (apenas constants)
```

---

### ERRO #6: Sem Tratamento Erro Microfone
```
Arquivo:     src/App.tsx
Linha:       ~167-175 (getUserMedia catch)
Severidade:  🟠 ALTO
────────────────────────────────────────────
Problema:
  ❌ User nega permissão de microfone
  ❌ Sistema apenas loga erro
  ❌ Sem feedback visual para o usuário
  ❌ Interface fica confusa (por quê não funciona?)

Possíveis Erros:
  NotAllowedError: User denied mic permission
  NotFoundError: No microphone device
  TypeError: Audio API not supported

Impacto:
  ❌ Usuário confuso
  ❌ Sem saber o que fazer
  ❌ Suporte: "Why doesn't mic work?"

Solução:
  ✅ Adicionar estado para erro
  ✅ Mostrar mensagem clara na UI
  ✅ Oferecer ação (retry, settings, etc.)

Tempo Estimado: 20 minutos
Risco: Baixo
```

---

### ERRO #7: Resposta Chat - Tokens ≠ Final Message
```
Arquivo:     server.ts + src/App.tsx (chat handler)
Severidade:  🟠 ALTO
────────────────────────────────────────────
Problema:
  ❌ Streaming envia tokens individuais
  ❌ Frontend concatena tokens
  ❌ Servidor depois envia resposta "final"
  ❌ Final pode diferir (JSON removido, whitespace trim, etc.)

Sequência:
  1. Backend streaming: "Turn", " on", " the", " lights"
  2. Frontend concatena: "Turn on the lights"
  3. Backend envia response: "Turn on the lights" ✓ (match)
  
  MAS se houver limpeza:
  1. Backend streaming: "Turn", " on", ...
  2. Backend remove JSON: `{"device": "studio"}`
  3. Frontend concatena tokens (sem remoção!)
  4. Final message ≠ streamed message

Impacto:
  ❌ UI inconsistência visual
  ❌ Confuso: mensagem muda depois de ser exibida

Solução:
  ✅ Não remover JSON após streaming iniciado
  ✅ Usar mesma lógica cleanup em ambos
  ✅ Ou aguardar síntese antes de emitir tokens

Tempo Estimado: 15 minutos
Risco: Baixo
```

---

### ERRO #8: Sem Validação Input Socket
```
Arquivo:     server.ts (~400)
             socket.on("control_device")
Severidade:  🟠 ALTO (Segurança)
────────────────────────────────────────────
Problema:
  ❌ Sem validação de entrada
  ❌ Device pode ser string arbitrária
  ❌ Action pode ser qualquer valor
  ❌ Params pode conter dados malformados

Código Atual:
  socket.on("control_device", async (data) => {
    const { device, action, params } = data; // ← Sem validação!
    const success = await controlHALight(device, action, params);
  });

Cenário de Ataque:
  socket.emit("control_device", {
    device: "'; DROP TABLE logs; --",
    action: "<?php system('rm -rf /'); ?>",
    params: { brightness: "INVALID" }
  });

Impacto:
  ❌ Possível SQL injection (se usado em SQL)
  ❌ Type confusion erros
  ❌ Unexpected behavior

Solução:
  ✅ Whitelist devices: ["studio", "desk", ...]
  ✅ Whitelist actions: ["on", "off", "toggle", "set"]
  ✅ Validar params: brightness 0-100, color hex

Tempo Estimado: 20 minutos
Risco: Médio (segurança importante)
```

---

## 🟡 MÉDIOS (Código Debt)

### ERRO #9: mediaRecorder Não Inicializado
```
Arquivo:     src/App.tsx
Linha:       ~165, ~230
Severidade:  🟡 MÉDIO (Código morto)
────────────────────────────────────────────
Problema:
  ❌ Variável declarada mas nunca inicializada
  ❌ Cleanup tenta usar variável que é sempre null
  ❌ Código confuso: por quê MediaRecorder?

  let mediaRecorder: MediaRecorder | null = null;
  // ... nunca recebe valor
  
  return () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop(); // ← Sempre false, nunca executa
    }
  };

Solução:
  ✅ Remover mediaRecorder completamente
  ✅ Usar apenas ScriptProcessor (atual)

Tempo Estimado: 2 minutos
Risco: Muito baixo (cleanup seguro)
```

---

### ERRO #10: useAudioAnalyzer Hook Não Utilizado
```
Arquivo:     src/hooks/useAudioAnalyzer.ts
Severidade:  🟡 MÉDIO (Código morto)
────────────────────────────────────────────
Problema:
  ❌ Hook bem implementado mas NUNCA IMPORTADO
  ❌ Não utilizado em nenhum componente
  ❌ Código morto cluttering projeto

Verificação:
  $ grep -r "useAudioAnalyzer" src/
  (nada encontrado)

Solução:
  ✅ Remover arquivo completamente
  ✅ Ou implementar em Visualizer se desejado

Tempo Estimado: 1 minuto
Risco: Nenhum
```

---

### ERRO #11: Sem Rate Limiting Socket
```
Arquivo:     server.ts
             socket.on("audio_chunk")
Severidade:  🟡 MÉDIO (DoS)
────────────────────────────────────────────
Problema:
  ❌ Cliente pode enviar audio_chunk infinitamente rápido
  ❌ Sem throttling ou rate limiting
  ❌ Possível DoS simples

Exploit:
  for (let i = 0; i < 10000; i++) {
    socket.emit("audio_chunk", randomBuffer);
  }

Impacto:
  ❌ Server processando chunks desnecessários
  ❌ Pode causar lag para outros usuários
  ❌ Desperdício de CPU

Solução:
  ✅ Implementar token bucket ou fixed rate
  ✅ Max 1 chunk per 200ms (reasonable for 16kHz/4096 samples)
  ✅ Drop excess chunks com warning

Tempo Estimado: 15 minutos
Risco: Muito baixo
```

---

### ERRO #12: Timeout Piper Pode Não Disparar
```
Arquivo:     src/services/piperService.ts
             socket.setTimeout() + client.on("close")
Severidade:  🟡 MÉDIO (Race condition)
────────────────────────────────────────────
Problema:
  ❌ Race condition entre timeout e close event
  ❌ Promise já resolvida recebe rejection
  ❌ Erro silenciado, comportamento indefinido

Sequência:
  T=0:   client.setTimeout(15000)
  T=15s: Timeout dispara
         client.destroy()
         Isso emite "close" event
  T=15s: client.on("close") dispara
         resolve(audioBuffer)
  T=15s: setTimeout callback tenta:
         reject(new Error(...))
         MAS Promise já resolvida!

Solução:
  ✅ Usar flag para prevenir múltiplas resoluções
  ✅ Ou setTimeout antes de conectar

Tempo Estimado: 10 minutos
Risco: Baixo
```

---

## 📊 Tabela de Erros Resumida

| # | Arquivo | Linha | Tipo | Sev | Fix Time | Risco |
|---|---------|-------|------|-----|----------|-------|
| 1 | wakeWordService.ts | 34-40 | Design | 🔴 | 30m | 🟢 Baixo |
| 2 | whisperService.ts | 7-42 | Missing | 🔴 | 15m | 🟢 Muito Baixo |
| 3 | server.ts | 250-260 | Design | 🔴 | 10m | 🟢 Muito Baixo |
| 4 | whisperService.ts | 18-27 | Header | 🟠 | 5m | 🟢 Muito Baixo |
| 4b | wakeWordService.ts | 35-44 | Header | 🟠 | 5m | 🟢 Muito Baixo |
| 5 | App.tsx | 190-210 | Sensitivity | 🟠 | 10m | 🟢 Muito Baixo |
| 6 | App.tsx | 167-175 | Error Handling | 🟠 | 20m | 🟢 Baixo |
| 7 | server.ts | Chat | Response | 🟠 | 15m | 🟢 Baixo |
| 8 | server.ts | 400 | Validation | 🟠 | 20m | 🟡 Médio |
| 9 | App.tsx | 165, 230 | Dead Code | 🟡 | 2m | 🟢 Muito Baixo |
| 10 | useAudioAnalyzer.ts | All | Dead Code | 🟡 | 1m | 🟢 Nenhum |
| 11 | server.ts | socket handler | Rate Limit | 🟡 | 15m | 🟢 Muito Baixo |
| 12 | piperService.ts | setTimeout | Race | 🟡 | 10m | 🟢 Baixo |

---

## 🎯 Tempo Total de Fixes

```
PRIORITY 1 (Imediato): 1h 5m
├─ WakeWord reconnect:     30m
├─ Whisper timeout:        15m
├─ Headers duplicados:     10m
└─ Audio refactor:         10m

PRIORITY 2 (Sprint): 1h 20m
├─ Silence threshold:      10m
├─ Rate limiting:          15m
├─ Input validation:       20m
├─ Chat response:          15m
└─ Microphone errors:      20m

PRIORITY 3 (Technical): 40m
├─ mediaRecorder:          2m
├─ useAudioAnalyzer:       1m
├─ Logging:                20m
└─ Misc cleanups:          17m

TOTAL: ~3-4 horas de trabalho
```

---

## ✅ Ordem Recomendada de Fixes

```
1️⃣  WakeWord reconnect        (blocker, 30m)
2️⃣  Whisper timeout           (blocker, 15m)
3️⃣  Audio refactor            (blocker, 10m)
4️⃣  Headers duplicados        (high, 5m)
5️⃣  Input validation          (security, 20m)
6️⃣  Silence threshold         (usability, 10m)
7️⃣  Rate limiting             (security, 15m)
8️⃣  Chat response consistency (UX, 15m)
9️⃣  Microphone errors UI      (UX, 20m)
🔟 Code cleanup              (technical, 45m)
```

---

## 🚀 Testing Checklist

```
AFTER FIX #1-3 (Critical):
☐ WiFi disconnect → auto reconnect (10s max)
☐ Whisper timeout → recovery
☐ Audio no longer sent to both WW + CMD

AFTER FIX #4-5 (High Priority):
☐ Long pause during sentence (5s) doesn't cut
☐ Headers accepted by Wyoming
☐ Invalid control_device rejected safely

AFTER FIX #6-9 (Medium Priority):
☐ Chat tokens ≈ final response
☐ Microphone denied → UI error shown
☐ Rate limiting: 1000 chunks/s → drops

AFTER ALL (Full Regression):
☐ Full voice command cycle end-to-end
☐ Light control works
☐ Chat responses correct
☐ No memory leaks (long session)
☐ Error recovery works
```

---

## 📝 Notes

- **Todos os erros são fixáveis** com < 5 linhas de código
- **Nenhum requer refactoring grande** (design é sólido)
- **Priority 1 é absolutamente necessário** para produção
- **Código atual funciona** mas tem problemas de edge case e resilience

