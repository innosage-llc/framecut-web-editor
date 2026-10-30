import React from 'react';
import { Video } from 'lucide-react';
import { CameraBubble, CameraBubbleShape, CAMERA_BUBBLE_LIMITS } from '../utils/cameraBubble';

/**
 * #28: camera bubble inspector for the selected screen clip (visibility, shape, size, border).
 * Sliders take one undo step per gesture (history on pointer-down, live updates without history).
 */
interface Props {
  bubble: CameraBubble;
  onChange: (bubble: CameraBubble, withHistory: boolean) => void;
}

const SHAPES: { id: CameraBubbleShape; label: string }[] = [
  { id: 'circle', label: 'Circle' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'rect', label: 'Rectangle' },
];

const CameraBubbleControls: React.FC<Props> = ({ bubble, onChange }) => {
  const set = (patch: Partial<CameraBubble>, withHistory = true) => onChange({ ...bubble, ...patch }, withHistory);
  const slider = (label: string, key: 'size' | 'borderWidth', min: number, max: number, step: number) => (
    <label className="flex items-center gap-2 text-[10px] text-zinc-400">
      <span className="w-12">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={bubble[key]}
        aria-label={`Camera ${label}`}
        onPointerDown={() => set({}, true)}
        onKeyDown={() => set({}, true)}
        onChange={e => set({ [key]: Number(e.target.value) } as Partial<CameraBubble>, false)}
        className="flex-1"
      />
      <span className="w-10 text-right font-mono text-zinc-300">{key === 'size' ? `${Math.round(bubble.size * 100)}%` : bubble.borderWidth.toFixed(3)}</span>
    </label>
  );
  return (
    <div data-testid="camera-bubble-controls" className="absolute top-0 left-full ml-4 w-64 bg-black/80 backdrop-blur-md border border-zinc-700/50 rounded-2xl shadow-2xl p-4 text-white z-50 space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-400"><Video size={16} /> Camera</div>
        <button
          type="button" role="switch" aria-checked={bubble.visible} aria-label="Camera bubble visible"
          onClick={() => set({ visible: !bubble.visible })}
          className={`relative w-9 h-5 rounded-full transition-colors ${bubble.visible ? 'bg-blue-600' : 'bg-zinc-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${bubble.visible ? 'translate-x-4' : ''}`} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {SHAPES.map(s => (
          <button key={s.id} type="button" aria-pressed={bubble.shape === s.id} aria-label={`Camera shape ${s.label}`}
            onClick={() => set({ shape: s.id })}
            className={`px-1 py-1.5 rounded text-[10px] border ${bubble.shape === s.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10'}`}>
            {s.label}
          </button>
        ))}
      </div>
      {slider('Size', 'size', CAMERA_BUBBLE_LIMITS.size.min, CAMERA_BUBBLE_LIMITS.size.max, 0.01)}
      {slider('Border', 'borderWidth', CAMERA_BUBBLE_LIMITS.borderWidth.min, CAMERA_BUBBLE_LIMITS.borderWidth.max, 0.001)}
      <label className="flex items-center gap-2 text-[10px] text-zinc-400">
        <span className="w-12">Colour</span>
        <input type="color" aria-label="Camera border colour" value={bubble.borderColor}
          onChange={e => set({ borderColor: e.target.value })} className="w-7 h-7 rounded border-0 p-0 bg-transparent" />
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" aria-label="Mirror camera" checked={bubble.mirrored} onChange={e => set({ mirrored: e.target.checked })} /> Mirror
        </label>
      </label>
    </div>
  );
};

export default CameraBubbleControls;
