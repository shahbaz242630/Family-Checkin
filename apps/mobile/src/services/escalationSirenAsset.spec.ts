// CB-038. The escalation siren is the loudest thing this product ever does: it
// is what a paying sender hears when the relative they look after has stopped
// answering. It shipped for months as a 0.35 s, 8 kHz blip that nobody would
// notice, and nothing in CI said a word — the asset is a binary, so no review,
// lint or type-check has an opinion about it.
//
// These tests give it one. They parse the committed .wav rather than trusting
// it, and they re-run the generator in memory so the file and
// `scripts/generate-escalation-siren.mjs` cannot drift apart. They would also
// catch the asset being line-ending mangled by git, which would silently
// corrupt the audio while leaving the file present and plausible.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ESCALATION_SIREN_FILENAME,
  SIREN_SPEC,
  buildEscalationSiren,
  measureLevels,
  readPcm16Samples,
  readWavHeader,
} from '../../scripts/generate-escalation-siren.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetPath = join(mobileRoot, 'assets', 'sounds', ESCALATION_SIREN_FILENAME);

const committed = readFileSync(assetPath);
const header = readWavHeader(committed);
const samples = readPcm16Samples(committed);

/**
 * Energy at one frequency in one window, by the Goertzel algorithm. Written out
 * here rather than imported from the generator on purpose: the point of the
 * pitch test is to measure the audio, not to ask the synthesiser what it
 * believes it produced.
 */
function magnitudeAt(frequencyHz: number, startFrame: number, frameCount: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequencyHz) / header.sampleRate);
  let previous = 0;
  let beforeThat = 0;
  for (let i = 0; i < frameCount; i += 1) {
    const current = samples[startFrame + i] / 32768 + coefficient * previous - beforeThat;
    beforeThat = previous;
    previous = current;
  }
  return Math.sqrt(previous * previous + beforeThat * beforeThat - coefficient * previous * beforeThat);
}

describe('escalation siren asset (CB-038)', () => {
  it('keeps the filename the three call sites and the Android resource compiler require', () => {
    // `expo-notifications` copies this filename into Android `res/raw`, where
    // only [a-z0-9_] is legal and a leading digit is not. A hyphen here made
    // every prebuild fail until CB-089, so this is a build gate, not style.
    expect(ESCALATION_SIREN_FILENAME).toBe('escalation_siren.wav');
    expect(ESCALATION_SIREN_FILENAME).toMatch(/^[a-z][a-z0-9_]*\.wav$/);
  });

  it('is still bundled by the expo-notifications plugin and named by the app', () => {
    const appConfig = readFileSync(join(mobileRoot, 'app.config.js'), 'utf8');
    expect(appConfig).toContain(`'./assets/sounds/${ESCALATION_SIREN_FILENAME}'`);

    const pushService = readFileSync(join(mobileRoot, 'src', 'services', 'pushNotifications.ts'), 'utf8');
    expect(pushService).toContain(`EMERGENCY_ALERT_SOUND = '${ESCALATION_SIREN_FILENAME}'`);
  });

  it('is 44.1 kHz, 16-bit, mono, uncompressed PCM', () => {
    expect(header.riffId).toBe('RIFF');
    expect(header.format).toBe('WAVE');
    expect(header.audioFormat).toBe(1); // 1 = PCM; anything else will not play as a notification sound
    expect(header.sampleRate).toBe(44100);
    expect(header.bitsPerSample).toBe(16);
    expect(header.channels).toBe(1);
    expect(header.byteRate).toBe(88200);
    expect(header.blockAlign).toBe(2);
  });

  it('declares a length that matches the bytes actually present', () => {
    // Catches truncation and, more usefully, git rewriting CRLF/LF inside the
    // PCM payload: either changes the byte count without changing the header.
    expect(committed.length).toBe(44 + header.dataBytes);
    expect(header.riffChunkSize).toBe(committed.length - 8);
    expect(header.frameCount).toBe(samples.length);
  });

  it('lasts long enough to be noticed and short enough for iOS to play it whole', () => {
    // Done-when: over 5 s. iOS truncates a custom notification sound at 30 s.
    expect(header.durationSeconds).toBeGreaterThan(5);
    expect(header.durationSeconds).toBeLessThanOrEqual(30);
    // And the file on disk is the length the generator says it is.
    expect(header.durationSeconds).toBeCloseTo(SIREN_SPEC.durationSeconds, 6);
  });

  it('is loud, has headroom and does not click', () => {
    const { peak, rms } = measureLevels(samples);
    // Below full scale: a phone speaker driven to 0 dBFS distorts, and a
    // distorted alarm sounds broken rather than urgent.
    expect(peak).toBeLessThan(0.85);
    expect(peak).toBeCloseTo(SIREN_SPEC.peakAmplitude, 2);
    // And not a near-silent file that technically passes every other check.
    expect(rms).toBeGreaterThan(0.2);
    // Fades: starting or ending on a non-zero sample is an audible click.
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
  });

  it('actually wails: the pitch alternates between the two siren tones', () => {
    const window = 4096;
    // Two whole wails in, so the fade-in cannot colour the measurement. The
    // sweep bottoms out on the period boundary and peaks half a period later;
    // each window is centred on its turning point.
    const troughFrame = Math.round(2 * SIREN_SPEC.wailPeriodSeconds * header.sampleRate) - window / 2;
    const crestFrame = Math.round(2.5 * SIREN_SPEC.wailPeriodSeconds * header.sampleRate) - window / 2;

    expect(magnitudeAt(SIREN_SPEC.lowHz, troughFrame, window)).toBeGreaterThan(
      magnitudeAt(SIREN_SPEC.highHz, troughFrame, window),
    );
    expect(magnitudeAt(SIREN_SPEC.highHz, crestFrame, window)).toBeGreaterThan(
      magnitudeAt(SIREN_SPEC.lowHz, crestFrame, window),
    );
  });

  it('is exactly what the committed generator produces', () => {
    const regenerated = buildEscalationSiren();
    expect(regenerated.length).toBe(committed.length);
    // The 44-byte RIFF/WAVE header is pure integer arithmetic, so it must match
    // to the byte.
    expect(regenerated.subarray(0, 44).equals(committed.subarray(0, 44))).toBe(true);

    // The samples are compared with a tolerance of two least-significant bits,
    // about -84 dBFS. ECMAScript does not require Math.sin to be correctly
    // rounded, so a future V8 could move a sample by one unit; that must not
    // turn into a red build, while a genuinely different sound still fails by a
    // mile. (Measured drift on Node 22 is zero: the files are byte-identical.)
    const regeneratedSamples = readPcm16Samples(regenerated);
    let worstDelta = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const delta = Math.abs(regeneratedSamples[i] - samples[i]);
      if (delta > worstDelta) worstDelta = delta;
    }
    expect(worstDelta).toBeLessThanOrEqual(2);
  });
});
