/**
 * Thread count for in-browser Whisper (ONNX Runtime WASM). Multi-threaded WASM needs
 * SharedArrayBuffer, which browsers only expose on cross-origin-isolated pages (COOP
 * same-origin + COEP credentialless/require-corp, see public/_headers). Without isolation
 * (Safari, which has no COEP credentialless; old browsers; a missing header) this is 1 and the
 * engine runs exactly as before.
 *
 * Cap: leave one core for the UI / video playback (hardwareConcurrency - 1), never more than 4
 * (measured: 4 threads gave 1.5-1.7x; ONNX Runtime's Whisper kernels scale poorly beyond that),
 * and at most 2 on devices reporting <= 4 GB RAM (navigator.deviceMemory, Chromium only), where
 * each extra thread's stack and the extra workers compete with video decoding.
 */
export const WHISPER_MAX_THREADS = 4;
export const LOW_MEMORY_GB = 4;
export const LOW_MEMORY_MAX_THREADS = 2;

export interface ThreadEnv { isolated: boolean; sharedArrayBuffer: boolean; hardwareConcurrency?: number; deviceMemory?: number }

export function chooseWhisperThreads(e: ThreadEnv): number {
  if (!e.isolated || !e.sharedArrayBuffer) return 1;
  const cores = Number.isFinite(e.hardwareConcurrency) && (e.hardwareConcurrency as number) > 0 ? Math.floor(e.hardwareConcurrency as number) : 1;
  const cap = e.deviceMemory !== undefined && e.deviceMemory <= LOW_MEMORY_GB ? LOW_MEMORY_MAX_THREADS : WHISPER_MAX_THREADS;
  return Math.max(1, Math.min(cap, cores - 1));
}

/** Read the current window/worker environment. */
export function currentThreadEnv(): ThreadEnv {
  const g = globalThis as any;
  return {
    isolated: g.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: g.navigator?.hardwareConcurrency,
    deviceMemory: g.navigator?.deviceMemory,
  };
}
