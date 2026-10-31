import React, { useEffect, useRef } from 'react';
import { Mic, Video } from 'lucide-react';
import { DeviceOption } from '../hooks/useRecordingDevices';

/**
 * #28: recording setup (macOS app behaviour). Microphone and camera are Off by default;
 * picking a device asks for permission, then shows a live level meter / camera preview.
 */
interface RecordingSetupProps {
  mics: DeviceOption[];
  cameras: DeviceOption[];
  micId: string;
  cameraId: string;
  micError: string | null;
  cameraError: string | null;
  micLevel: number;
  cameraStream: MediaStream | null;
  locked: boolean;
  onSelectMic: (id: string) => void;
  onSelectCamera: (id: string) => void;
}

const selectClass = 'flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50';

const RecordingSetup: React.FC<RecordingSetupProps> = ({
  mics, cameras, micId, cameraId, micError, cameraError, micLevel, cameraStream, locked, onSelectMic, onSelectCamera,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = cameraStream;
    if (cameraStream) v.play().catch(() => {});
  }, [cameraStream]);

  return (
    <div className="w-full flex flex-col gap-2 text-left" data-testid="recording-setup">
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <Mic size={14} className="text-teal-400 shrink-0" />
        <span className="w-16 shrink-0">Microphone</span>
        <select aria-label="Microphone" className={selectClass} value={micId} disabled={locked} onChange={e => onSelectMic(e.target.value)}>
          <option value="">Off</option>
          {mics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
      {micId && (
        <div className="ml-6 h-1.5 rounded bg-zinc-800 overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(micLevel.toFixed(2))}>
          <div className="h-full bg-teal-400 transition-[width] duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
        </div>
      )}
      {micError && <p role="alert" className="ml-6 text-[11px] text-red-400">{micError}</p>}

      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <Video size={14} className="text-blue-400 shrink-0" />
        <span className="w-16 shrink-0">Camera</span>
        <select aria-label="Camera" className={selectClass} value={cameraId} disabled={locked} onChange={e => onSelectCamera(e.target.value)}>
          <option value="">Off</option>
          {cameras.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
      {cameraId && (
        <div className="ml-6 flex items-center gap-2">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" className="w-28 aspect-video rounded bg-black object-cover" />
          <span className="text-[10px] text-zinc-500">Recorded as a camera bubble.</span>
        </div>
      )}
      {cameraError && <p role="alert" className="ml-6 text-[11px] text-red-400">{cameraError}</p>}
    </div>
  );
};

export default RecordingSetup;
