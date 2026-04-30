# OpenClaw Integration - Test Findings

**Date**: 2026-04-30  
**Status**: ✅ Connection Works | ❌ Write Operations Blocked

---

## ✅ What Works

### Connection & Authentication
```
✅ WebSocket connects successfully
✅ Challenge-response handshake works
✅ hello-ok received with full server capabilities
✅ Server version: 2026.4.26
✅ Protocol: 3 (correct)
✅ Authenticated as: "operator" role
✅ Health events streaming properly
```

### Available Methods
Server exposes **160+ methods** including:
- ✅ `chat.send` - Available in method list
- ✅ `agent` - Available in method list  
- ✅ `sessions.send` - Available in method list
- ✅ `chat.history` - Available in method list

### Available Events
Server supports:
- ✅ `chat` - For chat responses
- ✅ `session.message` - For message updates
- ✅ `agent` - For agent responses

---

## ❌ The Problem: Missing Scopes

### What Happens
1. **Client requests**: `"scopes": ["operator.read", "operator.write"]`
2. **Server responds**: `"scopes": []` (EMPTY!)
3. **Any write fails**: `"missing scope: operator.write"`

### Tests That Failed

#### Test 1: `chat.send` with "message" parameter
```json
Request: {
  "method": "chat.send",
  "params": { "message": "What is your name?" }
}
Response: {
  "ok": false,
  "error": "missing scope: operator.write"
}
```

#### Test 2: `chat.send` with "content" parameter  
```json
Request: {
  "method": "chat.send",
  "params": { "content": "What is your name?" }
}
Response: {
  "ok": false,
  "error": "missing scope: operator.write"
}
```
**Finding**: Both parameter names are valid syntax - OpenClaw rejects both for same reason (no write scope)

#### Test 3: `agent` method
```json
Request: {
  "method": "agent",
  "params": { "agentId": "rocky", "message": "..." }
}
Response: {
  "ok": false,
  "error": "missing scope: operator.write"
}
```

#### Test 4: `sessions.send` method
```json
Request: {
  "method": "sessions.send",
  "params": { "sessionKey": "agent:rocky:main", "message": "..." }
}
Response: {
  "ok": false,
  "error": "missing scope: operator.write"
}
```

---

## 🔍 Root Cause Analysis

### The Config Issue
File: `brain/.openclaw/openclaw.json`

```json
"auth": {
  "mode": "token",
  "token": "test-token-123456"
}
```

**Problem**: OpenClaw's token-based auth has 2 parts:
1. ✅ **Authentication** (token is valid) - WORKS
2. ❌ **Authorization** (scopes on token) - DOESN'T WORK

OpenClaw accepts the token but doesn't grant any scopes, so all write operations fail.

### Why It Happens
- OpenClaw is in "local" mode but still enforcing scope requirements
- The gateway generates/stores scope mappings separately from config file
- Scopes must be configured per-token in OpenClaw's internal auth system
- Simply adding `"scopes"` to JSON config doesn't work (we tried it, got rejected)

---

## 🎯 Recommended Solutions

### Option A: Disable Auth for Local Development (Simplest)
Edit `brain/.openclaw/openclaw.json`:
```json
"auth": {
  "mode": "none"  // Disable auth entirely for dev
}
```
**Pros**: Simple, immediate chat works  
**Cons**: No security (OK for local dev only)

### Option B: Use OpenClaw Dashboard/CLI
```bash
# Use OpenClaw's admin interface to grant scopes to token
# Or use: openclaw auth:grant-scope <token> operator.write
```
**Pros**: Proper way to do it  
**Cons**: Requires OpenClaw CLI knowledge

### Option C: Work Around It in Frontend
```typescript
// Don't send chat via `chat.send`
// Instead use read-only methods and session subscription
// Then construct responses from history
```
**Pros**: No OpenClaw config needed  
**Cons**: Complex workaround

---

## 📋 Summary for Implementation

### What We Know About OpenClaw Chat
- ✅ **Connection Protocol**: JSON-RPC v3 over WebSocket (confirmed working)
- ✅ **Methods Available**: `chat.send`, `agent`, `sessions.send` all exist
- ✅ **Events Available**: `chat`, `session.message`, `agent` events available
- ✅ **Parameters**: Both `message` and `content` are valid (OpenClaw accepts them)
- ⚠️ **Authentication**: Working but scopes not granted by token
- ❌ **Write Operations**: Blocked until scope issue resolved

### Next Steps
1. **Choose Solution A, B, or C above**
2. **Fix scope issue**
3. **Test chat again** - should work immediately after
4. **Update socket.ts** - map correct event names from real responses
5. **Implement socket integration** in frontend

---

## 📎 Test URLs & Tokens

**Frontend Test Pages:**
- `http://127.0.0.1:5173/test-openclaw-v2.html` - chat.send tests
- `http://127.0.0.1:5173/test-openclaw-agent.html` - agent/sessions tests

**Token:**
- `test-token-123456`

**Gateway:**
- `ws://127.0.0.1:18789`

---

## 🔗 References

- OpenClaw Config: `brain/.openclaw/openclaw.json`
- Test Data: Copied above with timestamps 2:37-2:38 PM
- No external API docs needed - we have full capabilities list from server

