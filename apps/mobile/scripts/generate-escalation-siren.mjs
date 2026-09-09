#!/usr/bin/env node
// Generates `apps/mobile/assets/sounds/escalation_siren.wav`, the sound a sender
// hears when the person they look after has stopped answering (CB-038).
//
// Why a generator and not a downloaded sound file:
//   - No budget for a licensed asset, and an unlicensed one is a legal problem
//     the day the app ships.
//   - The siren is reviewable. Every property of it is a named constant below
//     rather than an opaque blob nobody on a two-person team can audit.
//   - It is reproducible with zero dependencies and no ffmpeg/Python/sox, none
//     of which are guaranteed on a dev machine or in CI.
//
// The committed .wav is what ships; running this script is never needed to
// build the app. `escalationSirenAsset.spec.ts` re-runs the synthesis in memory
// and compares it against the committed bytes, so the two cannot drift.
//
// Usage: node apps/mobile/scripts/generate-escalation-siren.mjs
// `Buffer` is imported rather than used as a global: this file lives inside the
// mobile workspace, whose ESLint config assumes React Native globals and knows
// nothing about Node's.
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The filename is load-bearing in three other places (`sounds` in
 * app.config.js, the backend push payload, `EMERGENCY_ALERT_SOUND` in the app).
 * It also becomes an Android `res/raw` resource name, which accepts only
 * [a-z0-9_] and must not start with a digit — a hyphen here broke every
 * prebuild until CB-089. Do not rename it.
 */
export const ESCALATION_SIREN_FILENAME = 'escalation_siren.wav';

/**
 * The siren, as numbers. A fast two-tone wail: the pitch glides exponentially
 * between A5 and A6 and back, eight times, over ten seconds.
 *
 *   - 44.1 kHz / 16-bit / mono is what both platforms play back natively, so
 *     nothing resamples it on the way to the speaker.
 *   - 10 s sits well over the 5 s the backlog asks for and well under the 30 s
 *     iOS truncates custom notification sounds at.
 *   - 660-1320 Hz keeps the whole siren in the band a phone speaker can
 *     actually reproduce; anything with real energy below ~400 Hz simply
 *     disappears on a handset.
 *   - The upper harmonics give it the hard, horn-like edge that makes a siren
 *     read as an alarm rather than a ringtone. Three is enough: the third
 *     harmonic tops out at 3960 Hz, nowhere near Nyquist, so nothing aliases.
 *   - Peak is held at 72% of full scale. Phone speakers distort audibly near
 *     0 dBFS and a distorted alarm sounds broken, not urgent.
 */
export const SIREN_SPEC = Object.freeze({
  sampleRate: 44100,
  bitsPerSample: 16,
  channels: 1,
  durationSeconds: 10,
  /** One full low -> high -> low sweep. Eight of them fit in the ten seconds. */
  wailPeriodSeconds: 1.25,
  lowHz: 660,
  highHz: 1320,
  /** Relative levels of the fundamental, second and third harmonic. */
  harmonics: Object.freeze([1, 0.32, 0.1]),
  peakAmplitude: 0.72,
  fadeInSeconds: 0.05,
  fadeOutSeconds: 0.3,
});

const TWO_PI = Math.PI * 2;
const INT16_PEAK = 32767;

/** Raised-cosine fade so the siren neither clicks on at the start nor cuts off at the end. */
function envelopeAt(t, spec) {
  const rise = t < spec.fadeInSeconds ? 0.5 - 0.5 * Math.cos((Math.PI * t) / spec.fadeInSeconds) : 1;
  const remaining = spec.durationSeconds - t;
  const fall = remaining < spec.fadeOutSeconds ? 0.5 - 0.5 * Math.cos((Math.PI * remaining) / spec.fadeOutSeconds) : 1;
  return Math.min(rise, fall);
}

/**
 * Synthesises the siren as signed 16-bit mono PCM.
 *
 * The pitch is swept by integrating instantaneous frequency into a running
 * phase rather than by evaluating sin(2*pi*f(t)*t), which would tear the
 * waveform every time f changes. The glide is exponential (a constant musical
 * interval per unit of sweep) because a linear glide spends most of its time
 * sounding high and lurches at the bottom.
 *
 * @returns {Int16Array}
 */
export function synthesiseSirenSamples(spec = SIREN_SPEC) {
  const frameCount = Math.round(spec.durationSeconds * spec.sampleRate);
  const raw = new Float64Array(frameCount);
  const ratio = spec.highHz / spec.lowHz;

  let phase = 0;
  let peak = 0;

  for (let i = 0; i < frameCount; i += 1) {
    const t = i / spec.sampleRate;
    // 0 at the bottom of the wail, 1 at the top, smooth at both turning points.
    const sweep = 0.5 - 0.5 * Math.cos((TWO_PI * t) / spec.wailPeriodSeconds);
    const frequency = spec.lowHz * Math.pow(ratio, sweep);

    let value = 0;
    for (let h = 0; h < spec.harmonics.length; h += 1) {
      value += spec.harmonics[h] * Math.sin(phase * (h + 1));
    }
    raw[i] = value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;

    phase += (TWO_PI * frequency) / spec.sampleRate;
    if (phase > TWO_PI) phase -= TWO_PI;
  }

  // Normalise on the measured peak so the headroom is exact rather than hoped for.
  const gain = peak === 0 ? 0 : spec.peakAmplitude / peak;
  const samples = new Int16Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / spec.sampleRate;
    const scaled = Math.round(raw[i] * gain * envelopeAt(t, spec) * INT16_PEAK);
    samples[i] = Math.max(-INT16_PEAK - 1, Math.min(INT16_PEAK, scaled));
  }
  return samples;
}

/**
 * Wraps PCM samples in a canonical 44-byte RIFF/WAVE header.
 *
 * @returns {Buffer} the complete .wav file
 */
export function encodeWav(samples, spec = SIREN_SPEC) {
  const bytesPerSample = spec.bitsPerSample / 8;
  const blockAlign = spec.channels * bytesPerSample;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk length
  buffer.writeUInt16LE(1, 20); // 1 = uncompressed PCM
  buffer.writeUInt16LE(spec.channels, 22);
  buffer.writeUInt32LE(spec.sampleRate, 24);
  buffer.writeUInt32LE(spec.sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(spec.bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * bytesPerSample);
  }
  return buffer;
}

/** The finished asset, byte for byte. */
export function buildEscalationSiren(spec = SIREN_SPEC) {
  return encodeWav(synthesiseSirenSamples(spec), spec);
}

function toBuffer(bytes) {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Reads a canonical PCM WAV header back out of a buffer. Deliberately strict:
 * it is used by the test to prove the committed asset is what it claims to be,
 * so anything unexpected should throw rather than be papered over.
 */
export function readWavHeader(bytes) {
  const buffer = toBuffer(bytes);
  if (buffer.length < 44) throw new Error(`Not a WAV file: only ${buffer.length} bytes`);

  const riffId = buffer.toString('ascii', 0, 4);
  const format = buffer.toString('ascii', 8, 12);
  const fmtId = buffer.toString('ascii', 12, 16);
  const dataId = buffer.toString('ascii', 36, 40);
  if (riffId !== 'RIFF' || format !== 'WAVE') throw new Error(`Not a RIFF/WAVE file: ${riffId}/${format}`);
  if (fmtId !== 'fmt ' || dataId !== 'data') throw new Error(`Unexpected chunk layout: ${fmtId}/${dataId}`);

  const channels = buffer.readUInt16LE(22);
  const bitsPerSample = buffer.readUInt16LE(34);
  const sampleRate = buffer.readUInt32LE(24);
  const dataBytes = buffer.readUInt32LE(40);
  const blockAlign = channels * (bitsPerSample / 8);

  return {
    riffId,
    format,
    riffChunkSize: buffer.readUInt32LE(4),
    audioFormat: buffer.readUInt16LE(20),
    channels,
    sampleRate,
    byteRate: buffer.readUInt32LE(28),
    blockAlign: buffer.readUInt16LE(32),
    bitsPerSample,
    dataBytes,
    frameCount: dataBytes / blockAlign,
    durationSeconds: dataBytes / blockAlign / sampleRate,
    fileBytes: buffer.length,
  };
}

/** The PCM payload of a 16-bit WAV, as signed samples. */
export function readPcm16Samples(bytes) {
  const header = readWavHeader(bytes);
  if (header.bitsPerSample !== 16) throw new Error(`Expected 16-bit PCM, got ${header.bitsPerSample}-bit`);
  const buffer = toBuffer(bytes);
  const samples = new Int16Array(header.frameCount);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = buffer.readInt16LE(44 + i * 2);
  }
  return samples;
}

/** Peak and RMS of a PCM block, both as a fraction of full scale. */
export function measureLevels(samples) {
  let peak = 0;
  let sumOfSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumOfSquares += sample * sample;
  }
  return {
    peak: peak / INT16_PEAK,
    rms: Math.sqrt(sumOfSquares / samples.length) / INT16_PEAK,
  };
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const target = join(scriptDir, '..', 'assets', 'sounds', ESCALATION_SIREN_FILENAME);
  const wav = buildEscalationSiren();
  writeFileSync(target, wav);

  const header = readWavHeader(wav);
  const levels = measureLevels(readPcm16Samples(wav));
  const wails = SIREN_SPEC.durationSeconds / SIREN_SPEC.wailPeriodSeconds;

  console.log(`Wrote ${target}`);
  console.log(
    `  ${header.durationSeconds.toFixed(3)} s | ${header.sampleRate} Hz | ${header.bitsPerSample}-bit | ` +
      `${header.channels === 1 ? 'mono' : `${header.channels} channels`} | ${header.fileBytes} bytes`,
  );
  console.log(
    `  peak ${levels.peak.toFixed(3)} FS, RMS ${levels.rms.toFixed(3)} FS, ` +
      `${wails.toFixed(0)} wails between ${SIREN_SPEC.lowHz} Hz and ${SIREN_SPEC.highHz} Hz`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
