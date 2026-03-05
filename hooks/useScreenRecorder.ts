
import { useState, useRef, useCallback, useEffect } from 'react';
import { SpotlightEffect, RecordingEvent } from '../types';
import { generateId, formatTimeShort } from '../utils';

interface UseScreenRecorderProps {
  onRecordingComplete: (blob: Blob, name: string, events: RecordingEvent[], durationHint?: number) => void;
}

export const useScreenRecorder = ({ onRecordingComplete }: UseScreenRecorderProps) => {
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
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
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

  const handleStartScreenRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const recorder = new MediaRecorder(stream);
      screenChunksRef.current = [];
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

      recordingStartTimeRef.current = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) screenChunksRef.current.push(e.data); };
      
      recorder.onstop = () => {
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);

        // Exit PiP if active
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => { });
        }
        setIsPiPActive(false);

        const blob = new Blob(screenChunksRef.current, { type: 'video/webm' });
        const timestamp = new Date().toLocaleTimeString().replace(/:/g, '-');
        
        // Pass duration hint (current timer value) to help with WebM infinity duration issues
        onRecordingComplete(blob, `Screen Recording ${timestamp}`, recordingEventsRef.current, recordingDuration);
        
        setIsScreenRecording(false);
        stream.getTracks().forEach(track => track.stop());
      };
      
      stream.getVideoTracks()[0].onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };

      recorder.start();
      screenRecorderRef.current = recorder;
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
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    if (screenRecorderRef.current && screenRecorderRef.current.state !== 'inactive') screenRecorderRef.current.stop();
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => { });
    }
  };

  const handleMarker = useCallback(() => {
    if (!isScreenRecording) return;
    const time = (Date.now() - recordingStartTimeRef.current) / 1000;
    
    // Use last tracked mouse position instead of hardcoded 50/50
    const { x, y } = currentMousePosRef.current;
    
    // Manual marker
    recordingEventsRef.current.push({ x, y, time, type: 'click' }); 
    recordingMarkersRef.current.push(Date.now() - recordingStartTimeRef.current);
    setRecordingMarkersCount(prev => prev + 1);
  }, [isScreenRecording]);

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
          const now = Date.now();
          
          // Always update current position reference for Markers
          const { x, y } = getSafeCoordinates(e);
          currentMousePosRef.current = { x, y };

          if (now - lastMouseSampleTime.current < 33) return; // 30 FPS cap
          lastMouseSampleTime.current = now;

          const time = (now - recordingStartTimeRef.current) / 1000;

          recordingEventsRef.current.push({
              x,
              y,
              time,
              type: 'move'
          });
      };

      const handleMouseDown = (e: MouseEvent) => {
          if (!recordingStartTimeRef.current) return;
          const time = (Date.now() - recordingStartTimeRef.current) / 1000;
          
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
          const time = (Date.now() - recordingStartTimeRef.current) / 1000;
          
          setCapturedEventsCount(prev => prev + 1); 

          recordingEventsRef.current.push({
              type: 'keydown',
              time,
              key: e.key
          });
      };

      const handleBlur = () => {
          if (!recordingStartTimeRef.current) return;
          const time = (Date.now() - recordingStartTimeRef.current) / 1000;
          recordingEventsRef.current.push({ type: 'window_blur', time });
      };

      const handleFocus = () => {
          if (!recordingStartTimeRef.current) return;
          const time = (Date.now() - recordingStartTimeRef.current) / 1000;
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
  }, [isScreenRecording]);

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
