# 🧪 Teste Rápido das Correções

## ✅ Checklist de Teste em 5 Minutos

### Teste 1: Compilação ✅
```bash
npm run build
# Esperado: ✓ built successfully
```

### Teste 2: Comando Simples (30 segundos)
```
1. Abrir app
2. Clicar "Listen" ou botão de microfone
3. Falar: "Turn on the lights"
4. Observar:
   ✓ Vê a transcrição aparecer?
   ✓ Recebe resposta (texto)?
   ✓ Ouve resposta (TTS)?
```

### Teste 3: Comando com Pausa (1 minuto)
```
1. Clicar "Listen"
2. Falar: "Hey Rocky" [aguarda 2 segundos] "turn on"
3. Observar:
   ✓ Áudio NÃO foi cortado na pausa?
   ✓ Transcrição completa: "turn on"?
   ✓ Resposta apropriada?
```

### Teste 4: Verificar Logs (30 segundos)
```
Abrir browser DevTools (F12) → Console

Procurar por:
✓ "[WakeWord] Connected to 127.0.0.1:10400"
✓ "[Rocky] Auto-sending: Silence detected after 5 seconds"
✓ "[Rocky] Transcript: ..."
✓ Sem erros vermelhos (errors)
```

---

## 📊 Resultados Esperados

| Teste | Antes da Fix ❌ | Depois da Fix ✅ |
|-------|----------------|----|
| Comando "Hey Rocky turn on lights" | Transcrição: "Hey Rocky" | Transcrição: "turn on lights" |
| Pausa 2s durante comando | CORTA ÁUDIO | Aguarda até 5s silêncio |
| WiFi desconecta | Wake word para funcionar | Auto-reconecta em 1-32s |
| Whisper trava | Microphone congelado | Timeout após 30s |
| Headers áudio | Campos duplicados | Estrutura limpa |

---

## 🎯 Se Algo Não Funcionar

### A. Transcrição ainda incompleta
**Causa possível:** Threshold ainda muito sensível
**Teste:** Aumentar para 0.10 em App.tsx linha ~220
```typescript
if (volume < 0.10) {  // Tenta 0.10 em vez de 0.05
```

### B. Wake Word nunca conecta
**Causa possível:** Host/port incorretos
**Verificar:**
```bash
# Terminal 1: Verificar se Wyoming está rodando
ps aux | grep wyoming

# Terminal 2: Testar conexão
nc -zv 127.0.0.1 10400  # Wake Word
nc -zv 127.0.0.1 10300  # Whisper
```

### C. Timeout Whisper dispara frequentemente
**Causa possível:** Wyoming processamento lento
**Solução:** Aumentar timeout para 45000ms em whisperService.ts
```typescript
}, 45000);  // 45 segundos em vez de 30
```

### D. Microfone não funciona
**Verificar:**
```bash
# DevTools Console deve mostrar
# Erro: NotAllowedError, NotFoundError, ou similar?

# Se "NotAllowedError" → Permitir acesso ao microfone nas permissões do navegador
# Se "NotFoundError" → Verificar se microfone está plugado/reconhecido

# Linux: arecord -l  # Listar dispositivos de áudio
```

---

## 📝 Log de Mudanças

### Ficheiros Modificados
1. ✅ `src/services/wakeWordService.ts` - Auto-reconnect
2. ✅ `src/services/whisperService.ts` - Timeout 30s
3. ✅ `src/App.tsx` - Threshold/timeout silêncio
4. ✅ `server.ts` - Pipeline áudio refatorizado

### Linhas de Código Modificadas
- WakeWord: +45 linhas (métodos de reconnect)
- Whisper: +15 linhas (timeout handling)
- App.tsx: ~3 linhas (constantes)
- server.ts: ~10 linhas (lógica pipeline)

**Total:** ~73 linhas adicionadas/modificadas

---

## 📞 Suporte Rápido

Se algo não funcionar:

1. **Verificar logs:**
   ```bash
   npm run dev  # Ver logs do servidor em tempo real
   # DevTools Console (F12) para logs do cliente
   ```

2. **Resetar estado:**
   ```bash
   # Limpar cache e recarregar
   Ctrl+Shift+Delete (Clear browsing data)
   F5 (Reload)
   ```

3. **Testes avançados:**
   ```bash
   # Terminal 1: Servidor
   npm run dev
   
   # Terminal 2: Wyoming (se instalado localmente)
   wyoming-satellite --wake-model okayemoji --uri tcp://127.0.0.1:10410
   ```

---

**Data:** 22 de Abril de 2026  
**Status:** Pronto para Teste Rápido
