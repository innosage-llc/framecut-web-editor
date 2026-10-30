/**
 * #28 PR-C: camera bubble (macOS app #64 defaults). The bubble settings live on the screen clip;
 * the camera asset carries `timeOffset` (camera media time 0 in screen-source seconds), so camera
 * time follows the screen clip's source time and every linked edit (trim / split / speed / move)
 * carries the camera along with no extra bookkeeping.
 */
export type CameraBubbleShape = 'circle' | 'rounded' | 'rect';

export interface CameraBubble {
  visible: boolean;
  /** Top-left corner, fraction of canvas width / height (0–1), clamped so the bubble stays inside. */
  x: number;
  y: number;
  /** Bubble width as a fraction of the canvas's shorter side (0.1–0.8). */
  size: number;
  shape: CameraBubbleShape;
  /** Border width as a fraction of the canvas's shorter side (0–0.03). */
  borderWidth: number;
  borderColor: string;
}

export const CAMERA_BUBBLE_LIMITS = {
  size: { min: 0.1, max: 0.8 },
  borderWidth: { min: 0, max: 0.03 },
} as const;

export const DEFAULT_CAMERA_BUBBLE: CameraBubble = {
  visible: true,
  x: 0.72,
  y: 0.65,
  size: 0.3,
  shape: 'circle',
  borderWidth: 0.004,
  borderColor: '#ffffff',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Height / width of the bubble: 1 for circle, 3/4 (4:3) for the other shapes. */
export const bubbleAspect = (shape: CameraBubbleShape) => (shape === 'circle' ? 1 : 3 / 4);

/** Bubble rect in canvas pixels, with size / position clamped. */
export const bubbleRect = (bubble: CameraBubble, canvasW: number, canvasH: number) => {
  const short = Math.min(canvasW, canvasH);
  const size = clamp(bubble.size, CAMERA_BUBBLE_LIMITS.size.min, CAMERA_BUBBLE_LIMITS.size.max);
  const width = Math.min(canvasW, size * short);
  const height = Math.min(canvasH, width * bubbleAspect(bubble.shape));
  const x = clamp(bubble.x, 0, Math.max(0, 1 - width / canvasW)) * canvasW;
  const y = clamp(bubble.y, 0, Math.max(0, 1 - height / canvasH)) * canvasH;
  return { x, y, width, height };
};

/** Normalise a (possibly partial / legacy) bubble: clamps every value into range. */
// Never mirrored, like the macOS app (#64 has no mirror setting and captures unmirrored). A legacy
// `mirrored` field from an older saved project is dropped here.
export const normalizeBubble = (b: Partial<CameraBubble> | undefined | null): CameraBubble => {
  const m = { ...DEFAULT_CAMERA_BUBBLE, ...(b ?? {}) };
  const shape: CameraBubbleShape = m.shape === 'rounded' || m.shape === 'rect' ? m.shape : 'circle';
  return {
    visible: m.visible !== false,
    x: clamp(m.x, 0, 1),
    y: clamp(m.y, 0, 1),
    size: clamp(m.size, CAMERA_BUBBLE_LIMITS.size.min, CAMERA_BUBBLE_LIMITS.size.max),
    shape,
    borderWidth: clamp(m.borderWidth, CAMERA_BUBBLE_LIMITS.borderWidth.min, CAMERA_BUBBLE_LIMITS.borderWidth.max),
    borderColor: typeof m.borderColor === 'string' && m.borderColor ? m.borderColor : DEFAULT_CAMERA_BUBBLE.borderColor,
  };
};

/** Clamp a top-left position (fractions) so the bubble stays on canvas. */
export const clampBubblePosition = (bubble: CameraBubble, canvasW: number, canvasH: number, x: number, y: number) => {
  const r = bubbleRect({ ...bubble, x: 0, y: 0 }, canvasW, canvasH);
  return { x: clamp(x, 0, Math.max(0, 1 - r.width / canvasW)), y: clamp(y, 0, Math.max(0, 1 - r.height / canvasH)) };
};

/**
 * Camera media time for a screen-source time, or null when the camera has no frame there
 * (before it started, or after it ended / was disconnected: the bubble disappears).
 * Between the last frame and `duration` the last frame is held.
 */
export const cameraMediaTime = (sourceTime: number, timeOffset: number, duration: number): number | null => {
  const t = sourceTime - timeOffset;
  if (!Number.isFinite(t) || t < 0 || !(duration > 0) || t >= duration) return null;
  return t;
};

const shapePath = (ctx: CanvasRenderingContext2D, shape: CameraBubbleShape, x: number, y: number, w: number, h: number) => {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'rounded') {
    const r = Math.min(w, h) * 0.18;
    if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  } else {
    ctx.rect(x, y, w, h);
  }
};

/** Draw the bubble (cover-fit camera frame, clipped to the shape, then the border). */
export const drawCameraBubble = (
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number },
  bubble: CameraBubble,
  canvasW: number,
  canvasH: number,
) => {
  const sw = source.videoWidth || source.displayWidth || (source as any).width || 0;
  const sh = source.videoHeight || source.displayHeight || (source as any).height || 0;
  if (!sw || !sh) return false;
  const r = bubbleRect(bubble, canvasW, canvasH);
  // Cover-fit the camera frame into the bubble.
  const scale = Math.max(r.width / sw, r.height / sh);
  const cw = r.width / scale;
  const chh = r.height / scale;
  const sx = (sw - cw) / 2;
  const sy = (sh - chh) / 2;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  shapePath(ctx, bubble.shape, r.x, r.y, r.width, r.height);
  ctx.save();
  ctx.clip();
  ctx.drawImage(source, sx, sy, cw, chh, r.x, r.y, r.width, r.height);
  ctx.restore();
  const border = bubble.borderWidth * Math.min(canvasW, canvasH);
  if (border > 0) {
    ctx.lineWidth = border;
    ctx.strokeStyle = bubble.borderColor;
    shapePath(ctx, bubble.shape, r.x + border / 2, r.y + border / 2, r.width - border, r.height - border);
    ctx.stroke();
  }
  ctx.restore();
  return true;
};

/** Camera capture constraints: 720p ideal, 480p on low-memory devices (deviceMemory ≤ 4 GB). */
export const cameraResolutionFor = (deviceMemory: number | undefined) =>
  typeof deviceMemory === 'number' && deviceMemory <= 4 ? { width: 640, height: 480 } : { width: 1280, height: 720 };
