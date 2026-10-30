/**
 * #28: pick a MediaRecorder container/codec the current browser actually supports.
 * Previously the recorder used the browser default and the blob was always labelled
 * `video/webm`, which is wrong on Safari (MP4) and on Firefox for audio-only (Ogg).
 */
export type RecorderKind = 'video' | 'audio';

/** Ordered by preference. Chrome/Edge/Firefox take WebM; Safari only records MP4. */
export const RECORDER_MIME_CANDIDATES: Record<RecorderKind, readonly string[]> = {
  video: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
  ],
  audio: [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
  ],
};

type IsTypeSupported = (type: string) => boolean;

const defaultIsTypeSupported: IsTypeSupported = (type) =>
  typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
    ? MediaRecorder.isTypeSupported(type)
    : false;

/** First supported candidate, or '' to let the browser choose its default. */
export const pickRecorderMimeType = (kind: RecorderKind, isTypeSupported: IsTypeSupported = defaultIsTypeSupported): string => {
  for (const type of RECORDER_MIME_CANDIDATES[kind]) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Some engines throw on malformed codec strings; treat as unsupported.
    }
  }
  return '';
};

/** Container type for the final Blob: prefer what the recorder reports, else the requested type, else a kind default. */
export const blobTypeFor = (kind: RecorderKind, recorderMimeType: string | undefined, requested: string): string => {
  const raw = (recorderMimeType || requested || (kind === 'video' ? 'video/webm' : 'audio/webm')).trim();
  return raw.split(';')[0].trim() || (kind === 'video' ? 'video/webm' : 'audio/webm');
};

export const fileExtensionFor = (blobType: string): string => {
  if (blobType.includes('mp4')) return blobType.startsWith('audio/') ? 'm4a' : 'mp4';
  if (blobType.includes('ogg')) return 'ogg';
  return 'webm';
};
