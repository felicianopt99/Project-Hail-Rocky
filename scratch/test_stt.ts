import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { Buffer } from "buffer";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

async function testStt() {
  const servicePath = path.resolve(process.cwd(), "src/services/nvidiaSttService.ts");
  console.log(`Loading service from: ${servicePath}`);
  
  const { nvidiaSttService } = await import(servicePath);
  
  // Create a dummy 1-second silent PCM buffer (16kHz, 16-bit, mono)
  const silentPcm = Buffer.alloc(16000 * 2);
  
  console.log("Testing NVIDIA STT with dummy buffer...");
  try {
    const transcript = await nvidiaSttService.transcribe(silentPcm);
    console.log("STT Result:", transcript === "" ? "(Empty - Expected for silence)" : transcript);
    console.log("SUCCESS: STT Service is responding.");
  } catch (err) {
    console.error("FAILURE: STT Service error:", err.message);
  }
}

testStt();
