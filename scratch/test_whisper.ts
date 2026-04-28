import dotenv from "dotenv";
import path from "path";
import { WhisperLocalService } from "../src/services/whisperLocalService";
import { Buffer } from "buffer";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

async function testWhisper() {
  console.log("Testing Whisper service with dummy buffer on 127.0.0.1...");
  const whisperService = new WhisperLocalService("127.0.0.1", 10300);
  
  // Create a 1s audio buffer with some "noise" so it's not pure silence
  const pcm = Buffer.alloc(16000 * 2);
  for(let i=0; i<pcm.length; i++) pcm[i] = Math.floor(Math.random() * 255);

  try {
    const transcript = await whisperService.transcribe(pcm);
    console.log("Whisper Result:", transcript || "(Empty)");
    console.log("SUCCESS: Whisper Service is responding.");
  } catch (err: any) {
    console.error("FAILURE: Whisper Service error:", err.message);
  }
}

testWhisper();
