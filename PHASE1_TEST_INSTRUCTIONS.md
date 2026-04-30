# Phase 1: OpenClaw Integration Testing

## 🎯 Goal
Verify OpenClaw gateway connection and identify correct chat API format.

## ⏱️ Estimated Time: 15-20 minutes

---

## 📋 Checklist

### ✅ Prerequisites (Already Done)
- [x] OpenClaw gateway running on port 18789 (verified healthy)
- [x] Frontend dev server running on port 5173 (verified)
- [x] Test page created: `frontend/public/test-openclaw-v2.html`
- [x] Template for results: `TEST_RESULTS_TEMPLATE.md`

### 🔄 Manual Testing (YOU DO THIS)

**1. Open Test Page**
   - URL: http://127.0.0.1:5173/test-openclaw-v2.html
   - You should see: Green/Yellow/Red status indicator

**2. Connect to OpenClaw**
   - Click blue "Connect" button
   - Watch the Log panel on the left
   - Expected: Status turns GREEN, you see "Connection successful!"

**3. Test Chat with 'message' Parameter**
   - Default input: "What is your name?"
   - Click: "Send (message)" button
   - Watch both panels:
     - Left (Log): Human-readable output
     - Right (Raw Messages): Actual JSON from OpenClaw

**4. Test Chat with 'content' Parameter**
   - Clear logs (button in controls)
   - Change input to: "Hello Rocky!"
   - Click: "Send (content)" button
   - Compare results

**5. Fill Template**
   - Open: `TEST_RESULTS_TEMPLATE.md`
   - Copy-paste the Log and Raw Message outputs
   - Answer the key questions

---

## 🔍 What to Look For

### Connection Success Indicators
✅ Green status = Good
```
📨 EVENT: connect.challenge
📤 Sending connect request...
📨 EVENT: hello-ok
```

### Chat Response Indicators
Look in **Raw Messages** panel for:
```json
{
  "type": "res",
  "id": "msg-X",
  "ok": true,
  "payload": { ... }
}
```

OR

```json
{
  "type": "event",
  "event": "chat.response",
  "payload": { ... }
}
```

---

## ⚠️ If Connection Fails

### Red Status (Not Connected)
```
Possible causes:
1. OpenClaw gateway not running
   → Fix: docker ps | grep openclaw
   
2. Wrong port (not 18789)
   → Fix: Check docker-compose.yml
   
3. Gateway crashed
   → Fix: docker restart rocky-gateway
```

### Yellow Status (Connecting but stuck)
```
Possible causes:
1. Token incorrect
   → Check: VITE_OPENCLAW_TOKEN in .env
   
2. Challenge not received
   → Check: OpenClaw logs (docker logs rocky-gateway)
```

---

## 📤 After Testing

1. Fill out `TEST_RESULTS_TEMPLATE.md` with your findings
2. Look for patterns:
   - Which parameter works? (`message` or `content`)
   - What's the event name? (`chat.response` or something else?)
   - What fields are in the response?

3. Create issue in GitHub with findings (optional)

4. Continue to Task 8 (Verify parameters)

---

## 💡 Tips

- **Use browser DevTools** (F12) to see any JS errors
- **Check OpenClaw logs**: `docker logs rocky-gateway | tail -50`
- **Keep browser console open** while testing
- **Test both parameters** - OpenClaw might accept both or just one
- **Don't close the connection** between tests (tests are sequential)

---

## 🔗 Files Involved

- `frontend/public/test-openclaw-v2.html` - Main test page
- `TEST_RESULTS_TEMPLATE.md` - Where to document findings
- `frontend/src/lib/socket.ts` - Will update based on findings
- `frontend/src/hooks/useRockySockets.ts` - Will update based on findings

---

**Ready?** Open the test page and start connecting! 🚀
