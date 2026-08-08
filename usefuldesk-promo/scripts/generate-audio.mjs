import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const sampleRate = 44100;
const seconds = 21;
const channels = 2;
const frames = sampleRate * seconds;
const pcm = new Int16Array(frames * channels);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chords = [
  [146.83, 220, 293.66],
  [130.81, 196, 261.63],
  [174.61, 261.63, 349.23],
  [110, 164.81, 220],
  [146.83, 220, 293.66],
  [196, 293.66, 392],
];

const smoothstep = (value) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

for (let i = 0; i < frames; i++) {
  const time = i / sampleRate;
  const section = Math.min(chords.length - 1, Math.floor(time / 3.5));
  const local = time - section * 3.5;
  const fadeIn = smoothstep(local / 0.65);
  const fadeOut = smoothstep((3.5 - local) / 0.7);
  const envelope = Math.min(fadeIn, fadeOut);
  let value = 0;

  chords[section].forEach((frequency, voice) => {
    value += Math.sin(2 * Math.PI * frequency * time + voice * 0.7) * (0.025 / (voice + 1));
    value += Math.sin(2 * Math.PI * frequency * 2 * time + voice * 0.4) * (0.006 / (voice + 1));
  });

  value *= envelope;

  const pulsePosition = time % 0.875;
  if (pulsePosition < 0.18) {
    const pulseEnvelope = Math.exp(-pulsePosition * 26);
    value += Math.sin(2 * Math.PI * 72 * time) * pulseEnvelope * 0.018;
  }

  for (const hit of [3.5, 7, 10.5, 14, 17.5]) {
    const delta = time - hit;
    if (delta >= 0 && delta < 0.9) {
      const chimeEnvelope = Math.exp(-delta * 6);
      value += Math.sin(2 * Math.PI * 880 * delta) * chimeEnvelope * 0.035;
      value += Math.sin(2 * Math.PI * 1320 * delta) * chimeEnvelope * 0.016;
    }
  }

  const masterFade = Math.min(smoothstep(time / 0.8), smoothstep((seconds - time) / 1.4));
  const sample = Math.max(-1, Math.min(1, value * masterFade));
  const left = Math.round(sample * 32767);
  const right = Math.round(sample * 0.94 * 32767);
  pcm[i * channels] = left;
  pcm[i * channels + 1] = right;
}

const dataSize = pcm.byteLength;
const wav = Buffer.alloc(44 + dataSize);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + dataSize, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channels * 2, 28);
wav.writeUInt16LE(channels * 2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(dataSize, 40);
Buffer.from(pcm.buffer).copy(wav, 44);

const output = resolve(root, "public", "usefuldesk-promo-bed.wav");
mkdirSync(dirname(output), {recursive: true});
writeFileSync(output, wav);
console.log(output);
