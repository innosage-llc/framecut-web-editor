import { test, expect } from '@playwright/test';
import { voiceoverCues, voiceoverSignature, placeVoiceoverCue, generateVoiceover, VOICEOVER_SAMPLE_RATE } from '../utils/voiceover';

test('voiceover rejects invalid, overlapping and over-limit inputs before loading a model', () => {
  const cue = { text: 'Hello', start: 1, end: 2 };
  expect(voiceoverCues([{ ...cue, text: '  ' }, cue], 3)).toEqual([cue]);
  expect(() => voiceoverCues([], 3)).toThrow(/Add subtitles/);
  expect(() => voiceoverCues([cue], 181)).toThrow(/3 minutes/);
  expect(() => voiceoverCues([{ ...cue, end: NaN }], 3)).toThrow(/invalid timing/);
  expect(() => voiceoverCues([{ ...cue, start: -1 }], 3)).toThrow(/invalid timing/);
  expect(() => voiceoverCues([{ ...cue, end: 4 }], 3)).toThrow(/invalid timing/);
  expect(() => voiceoverCues([cue, { ...cue, start: 1.5 }], 3)).toThrow(/overlaps/);
  expect(() => voiceoverCues([{ ...cue, text: 'x'.repeat(201) }], 3)).toThrow(/too long/);
  expect(() => voiceoverCues(Array.from({ length: 121 }, (_, i) => ({ text: 'a', start: i, end: i + 1 })), 180)).toThrow(/120 cues/);
});

test('voiceover preserves silence and cue starts and refuses to truncate or accept invalid speech', () => {
  const output = new Float32Array(3 * VOICEOVER_SAMPLE_RATE);
  const cue = { text: 'Hello', start: 1, end: 2 };
  placeVoiceoverCue(output, new Float32Array([0.5, 0.25]), cue, 0);
  expect(output[VOICEOVER_SAMPLE_RATE - 1]).toBe(0);
  expect(output[VOICEOVER_SAMPLE_RATE]).toBe(0.5);
  expect(output[VOICEOVER_SAMPLE_RATE + 1]).toBe(0.25);
  expect(output[2 * VOICEOVER_SAMPLE_RATE]).toBe(0);
  expect(() => placeVoiceoverCue(output, new Float32Array(VOICEOVER_SAMPLE_RATE + 1), cue, 0)).toThrow(/subtitle 1 does not fit/);
  expect(() => placeVoiceoverCue(output, new Float32Array(), cue, 0)).toThrow(/invalid audio/);
  expect(() => placeVoiceoverCue(output, new Float32Array([NaN]), cue, 0)).toThrow(/invalid audio/);
});

test('voiceover detects text, timing and duration edits but ignores style and array order', () => {
  const a = { text: 'Hello', start: 1, end: 2 };
  const b = { text: 'World', start: 2, end: 3 };
  const signature = voiceoverSignature([a, b], 3);
  const styled = { ...a, color: 'red' };
  expect(voiceoverSignature([b, styled], 3)).toBe(signature);
  expect(voiceoverSignature([{ ...a, text: 'Changed' }, b], 3)).not.toBe(signature);
  expect(voiceoverSignature([{ ...a, start: 0 }, b], 3)).not.toBe(signature);
  expect(voiceoverSignature([a, b], 4)).not.toBe(signature);
});

test('worker cancellation, success and startup failure terminate the worker and release abort listeners', async () => {
  class StubWorker {
    static latest: StubWorker;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = 0;
    constructor() { StubWorker.latest = this; }
    postMessage() {}
    terminate() { this.terminated++; }
  }
  const original = globalThis.Worker;
  globalThis.Worker = StubWorker as unknown as typeof Worker;
  const request = { cues: [{ text: 'Hello', start: 0, end: 1 }], duration: 1, voice: 'af_heart' as const };
  try {
    const cancelled = new AbortController();
    const pending = generateVoiceover(request, cancelled.signal, () => {});
    const worker = StubWorker.latest;
    cancelled.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(1);

    const controller = new AbortController();
    const completed = generateVoiceover(request, controller.signal, () => {});
    const completedWorker = StubWorker.latest;
    completedWorker.onmessage?.({ data: { type: 'done', samples: new Float32Array([0.5]) } } as MessageEvent);
    expect(Array.from(await completed)).toEqual([0.5]);
    controller.abort();
    expect(completedWorker.terminated).toBe(1);

    const failed = generateVoiceover(request, new AbortController().signal, () => {});
    const failedWorker = StubWorker.latest;
    failedWorker.onerror?.();
    await expect(failed).rejects.toThrow(/could not start/);
    expect(failedWorker.terminated).toBe(1);
  } finally { globalThis.Worker = original; }
});
