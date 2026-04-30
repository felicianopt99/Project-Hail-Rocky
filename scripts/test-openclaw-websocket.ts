#!/usr/bin/env ts-node
/**
 * Test OpenClaw WebSocket connection and chat functionality
 * Run: npx ts-node scripts/test-openclaw-websocket.ts
 */

import WebSocket from "ws";

const BASE_URL = process.env.VITE_BACKEND_URL || "ws://127.0.0.1:18789";
const TOKEN = process.env.VITE_OPENCLAW_TOKEN || "rocky-secret-token-2026";

interface RpcRequest {
  type: "req";
  id: string;
  method: string;
  params: Record<string, any>;
}

interface RpcResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: any;
  error?: { code: number; message: string };
}

interface RpcEvent {
  type: "event";
  event: string;
  payload: any;
}

type RpcFrame = RpcRequest | RpcResponse | RpcEvent;

let messageId = 0;

function nextMsgId(): string {
  return `msg-${++messageId}`;
}

async function testOpenClaw() {
  console.log("🧪 OpenClaw WebSocket Test");
  console.log(`📍 URL: ${BASE_URL}`);
  console.log(`🔑 Token: ${TOKEN.substring(0, 8)}...`);
  console.log("");

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(BASE_URL);
    let connected = false;
    let challengeReceived = false;

    const timeout = setTimeout(() => {
      console.error("❌ Timeout - no response from server");
      ws.close();
      reject(new Error("Timeout"));
    }, 10000);

    ws.on("open", () => {
      console.log("✅ WebSocket connected");
    });

    ws.on("message", (data: string) => {
      try {
        const frame: RpcFrame = JSON.parse(data);

        if (frame.type === "event") {
          console.log(`\n📨 EVENT: ${(frame as RpcEvent).event}`);

          if ((frame as RpcEvent).event === "connect.challenge") {
            challengeReceived = true;
            console.log(`✅ Received challenge: ${JSON.stringify((frame as RpcEvent).payload).substring(0, 50)}...`);
            handleChallenge(ws, (frame as RpcEvent).payload);
          } else if ((frame as RpcEvent).event === "hello-ok") {
            connected = true;
            console.log("✅ Hello-ok received - CONNECTED!");

            // Send test chat
            setTimeout(() => {
              sendTestChat(ws);
            }, 500);
          } else {
            // Other events
            const payload = (frame as RpcEvent).payload;
            if (typeof payload === "string") {
              console.log(`   Payload: ${payload.substring(0, 100)}`);
            } else {
              console.log(`   Payload: ${JSON.stringify(payload).substring(0, 100)}`);
            }
          }
        } else if (frame.type === "res") {
          const response = frame as RpcResponse;
          console.log(`\n📋 RESPONSE: id=${response.id}, ok=${response.ok}`);
          if (!response.ok) {
            console.log(`   ❌ Error: ${JSON.stringify(response.error)}`);
          } else if (response.payload) {
            console.log(`   Payload: ${JSON.stringify(response.payload).substring(0, 100)}`);
          }
        }
      } catch (err) {
        console.error("❌ Parse error:", err);
      }
    });

    ws.on("error", (err: any) => {
      console.error("❌ WebSocket error:", err.message);
      clearTimeout(timeout);
      reject(err);
    });

    ws.on("close", () => {
      console.log("\n🔌 WebSocket closed");
      clearTimeout(timeout);
      if (connected && challengeReceived) {
        console.log("\n✅ TEST PASSED - Connection successful!");
        resolve();
      } else if (challengeReceived && !connected) {
        console.log("\n⚠️  TEST PARTIAL - Challenge received but no hello-ok");
        resolve();
      } else {
        console.log("\n❌ TEST FAILED - No connection established");
        reject(new Error("No connection"));
      }
    });

    function handleChallenge(ws: WebSocket, challenge: any) {
      const connectReq: RpcRequest = {
        type: "req",
        id: nextMsgId(),
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "webchat",
            version: "1.0.0",
            platform: "web",
            mode: "webchat"
          },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          auth: { token: TOKEN }
        }
      };

      console.log("📤 Sending connect request...");
      ws.send(JSON.stringify(connectReq));
    }

    function sendTestChat(ws: WebSocket) {
      const testMessage = "What is your name?";
      console.log(`\n💬 Sending test chat: "${testMessage}"`);

      // Try with 'message' parameter first (from socket.ts)
      const chatReq: RpcRequest = {
        type: "req",
        id: nextMsgId(),
        method: "chat.send",
        params: { message: testMessage }
      };

      ws.send(JSON.stringify(chatReq));

      // Set a timer to close after 5 seconds if no response
      setTimeout(() => {
        console.log("\n⏱️  No response received after 5 seconds");
        ws.close();
      }, 5000);
    }
  });
}

testOpenClaw()
  .then(() => {
    console.log("\n🎉 All tests completed!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Test failed:", err.message);
    process.exit(1);
  });
