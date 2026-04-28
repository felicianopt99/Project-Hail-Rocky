const fs = require('fs');
const path = require('path');

function createWavHeader(dataLength, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

const publicDir = path.join(__dirname, '..', 'public');
const files = ['test_accept.wav', 'test_ai.wav', 'test_integrate.wav', 'test_multilingual.wav'];

files.forEach(file => {
  const data = Buffer.alloc(1600); // 50ms of silence
  const header = createWavHeader(data.length);
  const full = Buffer.concat([header, data]);
  fs.writeFileSync(path.join(publicDir, file), full);
  console.log(`Fixed ${file}`);
});
