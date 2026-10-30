import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * #28: recording setup devices (macOS app behaviour): microphone and camera default to Off,
 * permission is requested only after a device is picked, a live level meter / camera preview
 * is shown, and choices are locked while recording.
 */
export interface DeviceOption { deviceId: string; label: string; }

export const MIC_CONSTRAINTS = (deviceId: string): MediaTrackConstraints => ({
  deviceId: { exact: deviceId },
  // Same capture as the macOS app: mono, 48 kHz, unprocessed. Browser voice processing
  // (echo cancellation / noise suppression / AGC) is off: it is tuned for calls and can
  // suppress or pump narration (it silences Chromium's fake test tone entirely).
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
});

export const CAMERA_CONSTRAINTS = (deviceId: string): MediaTrackConstraints => ({
  deviceId: { exact: deviceId },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
});

export const describeMediaError = (e: any, device: 'Microphone' | 'Camera'): string => {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return `${device} access was denied. Allow it in your browser's site settings, then pick the device again.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `${device} not found. It may have been disconnected.`;
    case 'NotReadableError':
    case 'AbortError':
      return `${device} is in use by another app or couldn't be started.`;
    default:
      return `${device} couldn't be started: ${e?.message || 'unknown error'}`;
  }
};

const labelled = (list: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: string): DeviceOption[] =>
  list.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));

export const useRecordingDevices = ({ locked }: { locked: boolean }) => {
  const [mics, setMics] = useState<DeviceOption[]>([]);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [micId, setMicId] = useState('');      // '' = Off (default)
  const [cameraId, setCameraId] = useState(''); // '' = Off (default)
  const [micError, setMicError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Keep the source/analyser referenced: Chromium can garbage-collect an unreferenced
  // MediaStreamAudioSourceNode that isn't connected to the destination, silencing the meter.
  const meterRef = useRef<{ ctx: AudioContext; raf: number; source: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null>(null);
  const micIdRef = useRef(micId); micIdRef.current = micId;
  const cameraIdRef = useRef(cameraId); cameraIdRef.current = cameraId;
  const cameraStreamRef = useRef<MediaStream | null>(null); cameraStreamRef.current = cameraStream;

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const nextMics = labelled(list, 'audioinput', 'Microphone');
      const nextCams = labelled(list, 'videoinput', 'Camera');
      setMics(nextMics);
      setCameras(nextCams);
      // A selected device that disappeared falls back to Off with a notice.
      if (micIdRef.current && !nextMics.some(d => d.deviceId === micIdRef.current)) {
        stopMeter();
        setMicId('');
        setMicError('Microphone disconnected. Pick another device or leave it Off.');
      }
      if (cameraIdRef.current && !nextCams.some(d => d.deviceId === cameraIdRef.current)) {
        cameraStreamRef.current?.getTracks().forEach(t => t.stop());
        setCameraStream(null);
        setCameraId('');
        setCameraError('Camera disconnected. Pick another device or leave it Off.');
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopMeter = useCallback(() => {
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.raf);
      meterRef.current.ctx.close().catch(() => {});
      meterRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    setMicLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    const analyser = ctx.createAnalyser();
    // 4096 samples ≈ 85 ms at 48 kHz: each update sees the whole interval since the last one,
    // so short sounds between updates aren't missed.
    analyser.fftSize = 4096;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    // Pull the graph through a muted path to the destination; some engines don't process
    // a branch that never reaches the destination.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    const data = new Float32Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number) => {
      if (!meterRef.current) return;
      // Limit meter updates (≈12/s) so the rest of the UI doesn't re-render per frame.
      if (t - last > 80) {
        last = t;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) { sum += data[i] * data[i]; peak = Math.max(peak, Math.abs(data[i])); }
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, Math.max(rms * 4, peak * 0.8));
        // Meter ballistics: instant attack, gradual release, so brief sounds stay visible.
        setMicLevel(prev => {
          const next = Math.max(level, prev * 0.85);
          return next < 0.005 ? 0 : next;
        });
      }
      meterRef.current.raf = requestAnimationFrame(tick);
    };
    meterRef.current = { ctx, raf: requestAnimationFrame(tick), source, analyser };
    ctx.resume?.().catch(() => {});
    // Autoplay policy can leave the context suspended until the next user gesture.
    if (ctx.state === 'suspended') {
      const resume = () => { ctx.resume().catch(() => {}); };
      window.addEventListener('pointerdown', resume, { once: true, capture: true });
      window.addEventListener('keydown', resume, { once: true, capture: true });
    }
  }, []);

  const selectMic = useCallback(async (deviceId: string) => {
    if (locked) return;
    stopMeter();
    setMicError(null);
    setMicId(deviceId);
    if (!deviceId) return;
    try {
      // Permission is requested only now, when a device is picked.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS(deviceId) });
      if (micIdRef.current !== deviceId) { stream.getTracks().forEach(t => t.stop()); return; }
      micStreamRef.current = stream;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (micIdRef.current === deviceId) {
          stopMeter();
          setMicId('');
          setMicError('Microphone disconnected. Pick another device or leave it Off.');
        }
      });
      startMeter(stream);
      refresh();
    } catch (e) {
      if (micIdRef.current === deviceId) {
        setMicId('');
        setMicError(describeMediaError(e, 'Microphone'));
      }
    }
  }, [locked, refresh, startMeter, stopMeter]);

  const selectCamera = useCallback(async (deviceId: string) => {
    if (locked) return;
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setCameraError(null);
    setCameraId(deviceId);
    if (!deviceId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS(deviceId) });
      if (cameraIdRef.current !== deviceId) { stream.getTracks().forEach(t => t.stop()); return; }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (cameraIdRef.current === deviceId) {
          setCameraStream(null);
          setCameraId('');
          setCameraError('Camera disconnected. Pick another device or leave it Off.');
        }
      });
      setCameraStream(stream);
      refresh();
    } catch (e) {
      if (cameraIdRef.current === deviceId) {
        setCameraId('');
        setCameraError(describeMediaError(e, 'Camera'));
      }
    }
  }, [locked, refresh]);

  /** Release preview/meter streams (e.g. when recording starts or the setup closes). */
  const releasePreviews = useCallback(() => {
    stopMeter();
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
  }, [stopMeter]);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    md.addEventListener('devicechange', refresh);
    return () => md.removeEventListener('devicechange', refresh);
  }, [refresh]);

  useEffect(() => () => {
    stopMeter();
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
  }, [stopMeter]);

  return { mics, cameras, micId, cameraId, micError, cameraError, micLevel, cameraStream, selectMic, selectCamera, releasePreviews, setMicError };
};
