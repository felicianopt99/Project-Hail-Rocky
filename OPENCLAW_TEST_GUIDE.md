# OpenClaw Integration Test Guide

## Prerequisites
- OpenClaw gateway running on `ws://127.0.0.1:18789`
- Frontend dev server on `http://127.0.0.1:5173`

## Quick Test via Debug Page

1. Start the frontend:
   ```bash
   cd frontend && npm run dev
   ```

2. Open debug page:
   ```
   http://127.0.0.1:5173/test-openclaw.html
   ```

3. Click **Connect**
   - Should see: `✓ WebSocket connected`
   - Then: `EVENT: connect.challenge`
   - Then: `RESPONSE: id=msg-1, ok=true`
   - Finally: `✓ Hello-ok received - Connection successful!`

## Test Chat Messages

1. In the message input: `Hello Rocky`
2. Click **Send Chat**
3. **Observe in browser console** (F12 → Console tab):
   - Check what events OpenClaw returns
   - Look for patterns: `chat.response`, `chat.token`, `status.update`, etc.

## Known Issues to Debug

### Issue 1: Chat Parameter Format
Current code tries TWO formats:
- File: `frontend/src/lib/socket.ts` line 237
- Uses: `{ message: data.content }`
- Test page uses: `{ content: content }`

**TODO**: Verify which format OpenClaw expects by checking response in debug page.

### Issue 2: Response Format Unknown
OpenClaw might return responses in different ways:
- `chat.response` event with full message
- `chat.token` events with streaming tokens
- Status updates

**TODO**: Check browser console logs during chat send.

## What to Check

1. **Connection Flow** ✅ Already works
   - Challenge/response handshake
   - hello-ok signal
   - Device token exchange

2. **Chat Request Handling** ⚠️ Unknown
   - What method name? (`chat.send` vs `message.send`?)
   - What params? (`{ message }` vs `{ content }`)
   - What response type? (event vs response?)

3. **Streaming** ⚠️ Unknown
   - Are responses streamed as tokens?
   - How are they delimited?
   - How should they be accumulated?

## Next Steps

1. Run test page, send a message
2. Screenshot or copy console output
3. Update this guide with findings
4. Fix socket.ts if parameter format is wrong
5. Update useRockySockets hook with proper event handling

## Files Involved

- `frontend/src/lib/socket.ts` - RPC implementation
- `frontend/public/test-openclaw.html` - Debug page
- `frontend/src/hooks/useRockySockets.ts` - Event listeners
- `frontend/src/types/openclaw.ts` - Type definitions
