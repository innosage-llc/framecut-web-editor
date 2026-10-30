
import { useState, useRef, useCallback, useEffect } from 'react';
import { SpotlightEffect, RecordingEvent } from '../types';
import { generateId, formatTimeShort } from '../utils';
import { useCaptureSession, CaptureSourceSpec } from './useCaptureSession';
import { sessionToMediaTime, companionTimeOffset } from '../utils/captureClock';
import type { RecordingImportExtras } from './useAssetOperations';
import { MIC_CONSTRAINTS, describeMediaError } from './useRecordingDevices';
import { createMonoMicStream, MonoMic } from '../utils/monoMic';

interface UseScreenRecorderProps {
  onRecordingComplete: (blob: Blob, name: string, events: RecordingEvent[], durationHint?: number, extras?: RecordingImportExtras) => void;
  /** #28: user-facing notices (microphone unavailable / disconnected). */
  onNotice?: (message: string) => void;
}

export interface StartRecordingOptions {
  /** '' or undefined = microphone Off. */
  micDeviceId?: string;
}

export const useScreenRecorder = ({ onRecordingComplete, onNotice }: UseScreenRecorderProps) => {
  const [isScreenRecording, setIsScreenRecording] = useState(false);
  const [recordingMarkersCount, setRecordingMarkersCount] = useState(0);
  const [capturedEventsCount, setCapturedEventsCount] = useState(0); 
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showFloatingBar, setShowFloatingBar] = useState(true);
  
  // PiP State
  const [isPiPActive, setIsPiPActive] = useState(false);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);

  // Internal Refs
  const captureSession = useCaptureSession();
  const finishingRef = useRef(false);
  const micSettingsRef = useRef<{ sampleRate: number; channelCount: number; deviceSampleRate?: number; deviceChannelCount?: number } | null>(null);
  const monoMicRef = useRef<MonoMic | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingMarkersRef = useRef<number[]>([]);
  const recordingIntervalRef = useRef<any>(null);
  
  // Event Tracking Refs
  const recordingEventsRef = useRef<RecordingEvent[]>([]);
  const lastMouseSampleTime = useRef<number>(0);
  // Track current mouse position for manual markers
  const currentMousePosRef = useRef({ x: 50, y: 50 });

  // Helper to draw the PiP timer
  const updatePiP = useCallback((time: number) => {
    const canvas = pipCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 16:9 Small Canvas
    if (canvas.width !== 256) {
      canvas.width = 256;
      canvas.height = 144;
    }

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.font = '600 14px sans-serif';
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("● REC", cx, cy - 24);

    ctx.font = '700 48px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(formatTimeShort(time), cx, cy + 16);
  }, []);

  const handleTogglePiP = useCallback(async () => {
    if (isPiPActive) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      setIsPiPActive(false);
    } else {
      const canvas = pipCanvasRef.current;
      const video = pipVideoRef.current;
      if (canvas && video) {
        updatePiP(recordingDuration); // Force update
        const pipStream = canvas.captureStream(1);
        video.srcObject = pipStream;
        try {
          await video.play();
          await video.requestPictureInPicture();
          setIsPiPActive(true);
        } catch (e) {
          console.warn("Failed to enter PiP", e);
          alert("Failed to open floating timer. You may need to interact with the page first.");
          setIsPiPActive(false);
        }
        video.onleavepictureinpicture = () => {
          setIsPiPActive(false);
        };
      }
    }
  }, [isPiPActive, recordingDuration, updatePiP]);

  const finishSession = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    try {
      const result = await captureSession.stop();
      monoMicRef.current?.close();
      monoMicRef.current = null;
      // Exit PiP if active
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => { });
      }
      setIsPiPActive(false);
      recordingStartTimeRef.current = 0;
      setIsScreenRecording(false);
      const screen = result?.sources.find(src => src.id === 'screen');
      if (!result || !screen) return;

      // Events were stamped on the session clock; re-base them onto the screen recording, measured
      // from when its recorder was started (same reference the app used before #28).
      const events = recordingEventsRef.current.map(ev => ({ ...ev, time: sessionToMediaTime(ev.time, screen.requestedOffset) }));
      const durationHint = Math.max(0, screen.stopOffset - screen.requestedOffset);
      // #28: microphone narration, aligned to the screen on the common session clock.
      const mic = result.sources.find(src => src.id === 'mic');
      const extras: RecordingImportExtras | undefined = mic && mic.blob.size > 0
        ? { narration: { blob: mic.blob, timeOffset: companionTimeOffset(screen, mic), duration: Math.max(0, mic.stopOffset - mic.startOffset) } }
        : undefined;
      if ((window as any).__FRAMECUT_E2E_ENABLED__) {
        (window as any).__FRAMECUT_LAST_CAPTURE__ = {
          sources: result.sources.map(src => ({ id: src.id, kind: src.kind, mimeType: src.mimeType, size: src.blob.size, requestedOffset: src.requestedOffset, startOffset: src.startOffset, stopOffset: src.stopOffset })),
          narrationTimeOffset: extras?.narration?.timeOffset ?? null,
          micSettings: micSettingsRef.current,
          micBlob: mic?.blob ?? null,
          durationHint,
          eventCount: events.length,
        };
      }
      const timestamp = new Date().toLocaleTimeString().replace(/:/g, '-');
      onRecordingComplete(screen.blob, `Screen Recording ${timestamp}`, events, durationHint, extras);
    } finally {
      finishingRef.current = false;
    }
  }, [captureSession, onRecordingComplete]);


  const handleStartScreenRecording = async (options: StartRecordingOptions = {}) => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      // #28: the microphone is opened after the screen picker (keeps the user-gesture for the picker).
      // If it fails, recording continues without narration and the user is told why.
      let micStream: MediaStream | null = null;
      micSettingsRef.current = null;
      if (options.micDeviceId) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS(options.micDeviceId) });
        } catch (e) {
          onNotice?.(describeMediaError(e, 'Microphone') + ' Recording without narration.');
        }
      }
      recordingMarkersRef.current = [];
      recordingEventsRef.current = []; // Reset events
      setRecordingMarkersCount(0);
      setCapturedEventsCount(0);
      setShowFloatingBar(true);
      setIsPiPActive(false); // Reset PiP state

      // Start Timer logic
      setRecordingDuration(0);
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(d => d + 1);
      }, 1000);

      stream.getVideoTracks()[0].onended = () => { void finishSession(); };

      // One session clock for every source (#28).
      const specs: CaptureSourceSpec[] = [{ id: 'screen', kind: 'video', stream }];
      if (micStream) {
        const micTrack = micStream.getAudioTracks()[0];
        const device = micTrack?.getSettings?.() ?? {};
        const mono = createMonoMicStream(micStream);
        monoMicRef.current = mono;
        micSettingsRef.current = {
          sampleRate: mono?.sampleRate ?? (device.sampleRate as number),
          channelCount: mono?.channelCount ?? (device.channelCount as number),
          deviceSampleRate: device.sampleRate as number | undefined,
          deviceChannelCount: device.channelCount as number | undefined,
        };
        // Disconnect: stop only the microphone; keep what it recorded; screen continues.
        micTrack?.addEventListener('ended', () => {
          captureSession.stopSource('mic');
          onNotice?.('Microphone disconnected. Narration was kept up to that point; the screen is still recording.');
        });
        specs.push({ id: 'mic', kind: 'audio', stream: mono?.stream ?? micStream });
      }
      captureSession.start(specs);
      recordingStartTimeRef.current = performance.now();
      setIsScreenRecording(true);
    } catch (err: any) {
      console.error("Screen recording cancelled or failed", err);
      setIsScreenRecording(false);
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        console.log("User cancelled screen selection.");
      } else {
        alert("Failed to start screen recording: " + (err.message || "Unknown error"));
      }
    }
  };

  const handleStopScreenRecording = () => {
    void finishSession();
  };

  const handleMarker = useCallback(() => {
    if (!isScreenRecording) return;
    const time = captureSession.now();
    
    // Use last tracked mouse position instead of hardcoded 50/50
    const { x, y } = currentMousePosRef.current;
    
    // Manual marker
    recordingEventsRef.current.push({ x, y, time, type: 'click' }); 
    recordingMarkersRef.current.push(time * 1000);
    setRecordingMarkersCount(prev => prev + 1);
  }, [isScreenRecording, captureSession]);

  // Capture Input Events (Mouse, Keyboard, Window)
  useEffect(() => {
      if (!isScreenRecording) return;

      const getSafeCoordinates = (e: MouseEvent) => {
          // Robust viewport dimensions
          const w = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
          const h = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
          
          // Calculate percentage with rigorous clamping
          // Note: e.clientX/Y are relative to the viewport (window)
          const rawPctX = (e.clientX / w) * 100;
          const rawPctY = (e.clientY / h) * 100;
          
          const pctX = Math.max(0, Math.min(100, rawPctX));
          const pctY = Math.max(0, Math.min(100, rawPctY));
          
          return { x: pctX, y: pctY };
      };

      const handleMouseMove = (e: MouseEvent) => {
          if (!recordingStartTimeRef.current) return;
          const now = performance.now();
          
          // Always update current position reference for Markers
          const { x, y } = getSafeCoordinates(e);
          currentMousePosRef.current = { x, y };

          if (now - lastMouseSampleTime.current < 33) return; // 30 FPS cap
          lastMouseSampleTime.current = now;

          const time = captureSession.now();

          recordingEventsRef.current.push({
              x,
              y,
              time,
              type: 'move'
          });
      };

      const handleMouseDown = (e: MouseEvent) => {
          if (!recordingStartTimeRef.current) return;
          const time = captureSession.now();
          
          const { x, y } = getSafeCoordinates(e);
          currentMousePosRef.current = { x, y };

          // DEBUG: Verify coordinate capture
          // console.log(`[Recorder] Click Captured: Client(${e.clientX}, ${e.clientY}) -> Pct(${x.toFixed(2)}%, ${y.toFixed(2)}%)`);

          setCapturedEventsCount(prev => prev + 1); 

          recordingEventsRef.current.push({
              x,
              y,
              time,
              type: 'click'
          });
      };

      const handleKeyDown = (e: KeyboardEvent) => {
          if (!recordingStartTimeRef.current) return;
          const time = captureSession.now();
          
          setCapturedEventsCount(prev => prev + 1); 

          recordingEventsRef.current.push({
              type: 'keydown',
              time,
              key: e.key
          });
      };

      const handleBlur = () => {
          if (!recordingStartTimeRef.current) return;
          const time = captureSession.now();
          recordingEventsRef.current.push({ type: 'window_blur', time });
      };

      const handleFocus = () => {
          if (!recordingStartTimeRef.current) return;
          const time = captureSession.now();
          recordingEventsRef.current.push({ type: 'window_focus', time });
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('blur', handleBlur);
      window.addEventListener('focus', handleFocus);

      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mousedown', handleMouseDown);
          window.removeEventListener('keydown', handleKeyDown);
          window.removeEventListener('blur', handleBlur);
          window.removeEventListener('focus', handleFocus);
      };
  }, [isScreenRecording, captureSession]);

  // Update PiP Canvas if active
  useEffect(() => {
    if (isScreenRecording && isPiPActive) {
      updatePiP(recordingDuration);
    }
  }, [recordingDuration, isPiPActive, isScreenRecording, updatePiP]);

  return {
    isScreenRecording,
    recordingMarkersCount,
    capturedEventsCount, 
    recordingDuration,
    showFloatingBar,
    setShowFloatingBar,
    isPiPActive,
    pipCanvasRef,
    pipVideoRef,
    handleStartScreenRecording,
    handleStopScreenRecording,
    handleMarker,
    handleTogglePiP
  };
};
