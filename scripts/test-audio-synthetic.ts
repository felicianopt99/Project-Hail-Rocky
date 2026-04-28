/**
 * Synthetic Audio Test
 * Generates test audio chunks and sends them to the server via Socket.io
 * to diagnose the audio processing pipeline without needing a microphone
 */

import io from "socket.io-client";

const SAMPLE_RATE = 16000;
const DURATION_MS = 2000; // 2 seconds of test audio
const CHUNK_SIZE = 1024; // Samples per chunk

// Generate a simple sine wave (1000 Hz tone) at 16kHz
function generateToneChunk(frequency: number, durationMs: number): Buffer {
  const samples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const buffer = Buffer.alloc(samples * 2); // 16-bit = 2 bytes per sample

  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
    const int16 = Math.round(sample * 32767);
    buffer.writeInt16LE(int16, i * 2);
  }

  return buffer;
}

// Generate silence (all zeros)
function generateSilenceChunk(durationMs: number): Buffer {
  const samples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  return Buffer.alloc(samples * 2);
}

async function runTest() {
  console.log("🎵 Synthetic Audio Test");
  console.log("=======================\n");

  const socket = io("http://localhost:3005", {
    auth: { deviceId: "test_diagnostic_" + Date.now() },
  });

  socket.on("connect", async () => {
    console.log("✅ Connected to server (socketId:", socket.id, ")\n");

    // Wait a bit for server to initialize
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("📤 Triggering wake word...");
    socket.emit("manual_trigger");

    // Wait for the server to activate command capture
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("📤 Sending synthetic audio chunks (1000 Hz tone, 2 seconds)...");

    // Generate and send audio chunks
    const totalSamples = SAMPLE_RATE * 2; // 2 seconds
    const numChunks = Math.ceil(totalSamples / CHUNK_SIZE);

    for (let i = 0; i < numChunks; i++) {
      const startSample = i * CHUNK_SIZE;
      const endSample = Math.min(startSample + CHUNK_SIZE, totalSamples);
      const chunkDuration = ((endSample - startSample) / SAMPLE_RATE) * 1000;

      const chunk = generateToneChunk(1000, chunkDuration);

      socket.emit("audio_chunk", chunk, (ack: any) => {
        if (!ack?.success) {
          console.warn(`  ⚠️  Chunk ${i} rejected:`, ack?.error);
        } else {
          if (i % 10 === 0) {
            console.log(
              `  📦 Sent chunk ${i}/${numChunks} (${ack?.chunkNumber})`
            );
          }
        }
      });

      // Small delay between chunks to simulate real-time audio
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log(`\n✅ Sent ${numChunks} audio chunks\n`);

    // Send silence to trigger VAD stop
    console.log("🔇 Sending silence (2 seconds) to trigger STT...");
    const silenceDuration = 2000;
    const silenceChunks = Math.ceil(
      (silenceDuration / 1000) * SAMPLE_RATE / CHUNK_SIZE
    );

    for (let i = 0; i < silenceChunks; i++) {
      const chunk = generateSilenceChunk(
        (CHUNK_SIZE / SAMPLE_RATE) * 1000
      );
      socket.emit("audio_chunk", chunk);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log("✅ Silence sent\n");

    // Listen for responses
    socket.on("transcript_result", (text: string) => {
      console.log("📝 STT Result:", text);
    });

    socket.on("status_update", (status: string) => {
      console.log(`📊 Status update: ${status}`);
    });

    socket.on("chat_token", (token: string) => {
      process.stdout.write(token);
    });

    socket.on("tts_start", (data: any) => {
      console.log("\n🔊 TTS started:", data);
    });

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log("\n\n✅ Test complete. Check server logs for diagnostics.");
    socket.disconnect();
    process.exit(0);
  });

  socket.on("connect_error", (err: any) => {
    console.error("❌ Connection error:", err.message);
    process.exit(1);
  });

  socket.on("error", (err: any) => {
    console.error("❌ Socket error:", err);
  });

  // Timeout after 30 seconds
  setTimeout(() => {
    console.error("❌ Test timeout after 30 seconds");
    socket.disconnect();
    process.exit(1);
  }, 30000);
}

runTest().catch(console.error);
