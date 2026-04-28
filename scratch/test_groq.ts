
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { GroqSttService } from "../src/services/groqSttService";
import { Buffer } from "buffer";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

async function testGroq() {
  const groq = new GroqSttService();
  
  // We need a small wav file to test. 
  // If we don't have one, we can try to find any .wav in the project.
  const testFiles = ["test.wav", "test_ai.wav", "public/sounds/alert.wav"];
  let testFile = "";
  for (const f of testFiles) {
    if (fs.existsSync(path.join(process.cwd(), f))) {
      testFile = path.join(process.cwd(), f);
      break;
    }
  }

  if (!testFile) {
    console.error("No test wav file found.");
    return;
  }

  console.log(`Testing with ${testFile}...`);
  const buffer = fs.readFileSync(testFile);
  try {
    const text = await groq.transcribe(buffer);
    console.log("SUCCESS! Transcript:", text);
  } catch (err: any) {
    console.error("FAILED! Error:", err.message);
  }
}

testGroq();
