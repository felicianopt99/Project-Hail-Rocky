import dotenv from "dotenv";
import path from "path";
import { PiperService } from "../src/services/piperService.ts";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

async function testPiper() {
  console.log("Testing Piper service with dummy text...");
  const piperService = new PiperService();
  try {
    const stream = await piperService.synthesizeStream("Amaze! Fist-bump, Friend!");
    let totalBytes = 0;
    for await (const chunk of stream) totalBytes += chunk.length;
    console.log("Piper Result size:", totalBytes, "bytes");
    if (totalBytes > 0) {
      console.log("SUCCESS: Piper Service is responding.");
    } else {
      console.log("FAILURE: Piper Service returned empty audio.");
    }
  } catch (err: any) {
    console.error("FAILURE: Piper Service error:", err.message);
  }
}

testPiper();
