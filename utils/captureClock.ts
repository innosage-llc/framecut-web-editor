/**
 * #28: one monotonic clock for a capture session (screen now; mic and camera in later PRs).
 * Uses performance.now(), which cannot jump with wall-clock/NTP changes the way Date.now() can.
 * All times are seconds relative to `t0`, captured just before the recorders are started.
 */
export interface CaptureClock {
  /** performance.now() value (ms) at session start. */
  readonly t0: number;
  /** Seconds since t0. */
  now: () => number;
  /** Convert an absolute performance.now()-based ms timestamp to session seconds. */
  toSessionSeconds: (perfMs: number) => number;
}

export const createCaptureClock = (nowMs: () => number = () => performance.now()): CaptureClock => {
  const t0 = nowMs();
  return {
    t0,
    now: () => (nowMs() - t0) / 1000,
    toSessionSeconds: (perfMs: number) => (perfMs - t0) / 1000,
  };
};

/**
 * Re-base a session-clock time onto a source's media timeline. A recorder that started
 * `startOffset` seconds after t0 has media time 0 at session time `startOffset`.
 * Times before the media began are clamped to 0 (mirrors the macOS app trimming early samples).
 */
export const sessionToMediaTime = (sessionSeconds: number, startOffset: number): number =>
  Math.max(0, sessionSeconds - Math.max(0, startOffset));

/** Minimal timing of one recorded source (see CapturedSource in hooks/useCaptureSession). */
export interface SourceTiming {
  requestedOffset: number;
  startOffset: number;
  stopOffset: number;
}

/**
 * Best estimate of when a source's media time 0 happened on the session clock: the recorder's
 * `start` event when it is plausible (fired before the source stopped), else the start() call.
 * Chromium can delay `start` until stop for a source that produced no data (see PR-A).
 */
export const mediaStartOf = (t: SourceTiming): number =>
  t.startOffset >= t.requestedOffset && t.startOffset < t.stopOffset - 0.05 ? t.startOffset : t.requestedOffset;

/**
 * #28: offset of a companion source (mic) relative to the screen, in seconds of screen-source time.
 * Positive = the companion started later than the screen.
 */
export const companionTimeOffset = (screen: SourceTiming, companion: SourceTiming): number =>
  mediaStartOf(companion) - mediaStartOf(screen);
