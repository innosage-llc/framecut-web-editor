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
