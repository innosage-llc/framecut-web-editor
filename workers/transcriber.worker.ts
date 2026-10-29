/// <reference lib="webworker" />
/**
 * #27 Transcriber worker STUB. No speech-to-text engine is bundled: it makes no network
 * requests and loads no model. It only answers the protocol in utils/transcriber.ts with an
 * error, so the plumbing can be exercised end to end. A real on-device engine replaces this
 * once the provider question is answered.
 */
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (!m || m.type !== 'transcribe') return;
  (self as unknown as Worker).postMessage({ type: 'error', id: m.id, message: 'No speech-to-text engine is installed in this build.' });
};
export {};
