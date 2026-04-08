
import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle, memo } from 'react';
import { Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, PlayerRef, Clip, ExtendedEditorState } from '../types';
import { RotateCcw, Check, Crosshair } from 'lucide-react';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import { useCanvasRecorder } from '../hooks/useCanvasRecorder';
import { renderVideoFrame, renderMosaic, renderSpotlight, renderSubtitles, calculateZoomRect } from '../utils/canvasRenderer';
import PropertyHUD from './PropertyHUD';

type TimedItem = { start: number; end: number };

interface ActiveIntervalCursor<T extends TimedItem> {
  items: T[];
  nextIndex: number;
  active: T[];
  lastTime: number | null;
}

const PREVIEW_MAX_LONG_EDGE = 1280;
const CURSOR_RESET_THRESHOLD = 1;

const createActiveIntervalCursor = <T extends TimedItem>(items: T[] = []): ActiveIntervalCursor<T> => ({
  items: [...items].sort((a, b) => a.start - b.start),
  nextIndex: 0,
  active: [],
  lastTime: null
});

const upperBoundByStart = <T extends TimedItem>(items: T[], time: number) => {
  let low = 0;
  let high = items.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (items[mid].start <= time) low = mid + 1;
    else high = mid;
  }

  return low;
};

const resolveActiveItems = <T extends TimedItem>(cursor: ActiveIntervalCursor<T>, time: number): T[] => {
  const isJump =
    cursor.lastTime === null ||
    time < cursor.lastTime ||
    Math.abs(time - cursor.lastTime) > CURSOR_RESET_THRESHOLD;

  if (isJump) {
    cursor.nextIndex = upperBoundByStart(cursor.items, time);
    cursor.active = cursor.items.slice(0, cursor.nextIndex).filter(item => item.end > time);
  } else {
    while (cursor.nextIndex < cursor.items.length && cursor.items[cursor.nextIndex].start <= time) {
      const item = cursor.items[cursor.nextIndex];
      if (item.end > time) cursor.active.push(item);
      cursor.nextIndex += 1;
    }
    cursor.active = cursor.active.filter(item => item.end > time);
  }

  cursor.lastTime = time;
  return cursor.active;
};

const getClipDuration = (clip: Clip) => (clip.sourceEnd - clip.sourceStart) / clip.speed;
const getClipEnd = (clip: Clip) => clip.offset + getClipDuration(clip);

const alignEven = (value: number) => Math.max(2, Math.round(value / 2) * 2);

interface PlayerProps {
  src: string | null; 
  introSrc: string | null | undefined;
  mainSrc: string | null | undefined;
  outroSrc: string | null | undefined;
  
  // Removed time-dependent props (sourceTime, activeMediaType, currentTime)
  // Only Ref is used for time
  currentTimeRef: React.MutableRefObject<number>; 
  currentTime: number;
  
  isMuted?: boolean;
  corsCompatible?: boolean; 
  
  audioSrc: string | null;
  audioPlaybackRate: number;

  allSubtitles: Subtitle[]; 
  selectedSubtitleId: string | null; 
  
  // Pass FULL lists, resolve active inside render loop
  zoomEffects: ZoomEffect[];
  spotlightEffects: SpotlightEffect[];
  mosaicEffects: MosaicEffect[];

  selectedZoomEffect: ZoomEffect | null; 
  selectedSpotlightEffect: SpotlightEffect | null;
  selectedMosaicEffect: MosaicEffect | null;
  isPlaying: boolean;
  playbackRate: number;
  currentBrushSize?: number; 
  onDurationChange: (duration: number) => void;
  onEnded: () => void;
  onUpdateSubtitle: (sub: Subtitle) => void;
  onUpdateZoomEffect: (zoom: ZoomEffect) => void;
  onUpdateSpotlightEffect: (spotlight: SpotlightEffect) => void;
  onUpdateMosaicEffect: (mosaic: MosaicEffect) => void;
  onSelectSubtitle: (id: string | null) => void; 
  onSelectZoomEffect: (id: string) => void;
  onSelectSpotlightEffect: (id: string) => void;
  onSelectMosaicEffect: (id: string) => void;
  onTogglePlay?: () => void;
  onInteractionStart?: () => void;
  isAudioTrackMuted?: boolean;
  coverImage?: string | null; 
  onAutoCover?: (dataUrl: string) => void; 
  isExporting?: boolean;
  
  // Selection/UI Props
  activeClipId?: string; // ID of the currently selected clip (static selection state)
  isEditingCrop?: boolean;
  onUpdateClip?: (clip: Clip) => void;
  onConfirmCrop?: () => void;
  
  activeClips?: Clip[];
  audioClips?: Clip[]; 
  
  onPreviewHover?: (x: number, y: number) => void;
  onPreviewLeave?: () => void;
  
  aspectRatio: number;
  canvasBackgroundColor: string;
  projectName: string | null;
  onUpdateProjectSettings: (updates: Partial<ExtendedEditorState>) => void;
  onMosaicBrushSizeChange: (size: number) => void;
}

const Player = memo(forwardRef<PlayerRef, PlayerProps>(({
  src,
  introSrc,
  mainSrc,
  outroSrc,
  currentTimeRef,
  currentTime,
  isMuted = false,
  corsCompatible = true,
  audioSrc,
  audioPlaybackRate,
  allSubtitles,
  selectedSubtitleId,
  zoomEffects,
  spotlightEffects,
  mosaicEffects,
  selectedZoomEffect,
  selectedSpotlightEffect,
  selectedMosaicEffect,
  isPlaying,
  playbackRate,
  currentBrushSize = 10,
  onDurationChange,
  onEnded,
  onUpdateSubtitle,
  onUpdateZoomEffect,
  onUpdateSpotlightEffect,
  onUpdateMosaicEffect,
  onSelectSubtitle,
  onSelectZoomEffect,
  onSelectSpotlightEffect,
  onSelectMosaicEffect,
  onTogglePlay,
  onInteractionStart,
  isAudioTrackMuted = false,
  coverImage,
  onAutoCover,
  isExporting = false,
  activeClipId,
  isEditingCrop = false,
  onUpdateClip,
  onConfirmCrop,
  activeClips,
  audioClips,
  onPreviewHover,
  onPreviewLeave,
  aspectRatio,
  canvasBackgroundColor,
  projectName,
  onUpdateProjectSettings,
  onMosaicBrushSizeChange
}, ref) => {
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const outroVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // Image Element Ref for rendering static images
  const currentImageRef = useRef<HTMLImageElement>(new Image());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const maskCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const exportCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null); 
  const requestRef = useRef<number | null>(null);
  
  const internalPreviewTimeRef = useRef<number | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const sourceDimensionsRef = useRef({ width: 0, height: 0 });
  const exportCanvasLockRef = useRef<{ width: number; height: number } | null>(null);
  const exportPlaybackVideoRef = useRef<HTMLVideoElement | null>(null);
  const exportPlaybackModeRef = useRef<'playback' | 'seek' | null>(null);
  
  // Refs for Props (To avoid stale closures in RAF)
  const srcRef = useRef(src);
  const allSubtitlesRef = useRef(allSubtitles);
  const zoomEffectsRef = useRef(zoomEffects);
  const spotlightEffectsRef = useRef(spotlightEffects);
  const mosaicEffectsRef = useRef(mosaicEffects);
  const subtitleCursorRef = useRef<ActiveIntervalCursor<Subtitle>>(createActiveIntervalCursor(allSubtitles));
  const zoomCursorRef = useRef<ActiveIntervalCursor<ZoomEffect>>(createActiveIntervalCursor(zoomEffects));
  const spotlightCursorRef = useRef<ActiveIntervalCursor<SpotlightEffect>>(createActiveIntervalCursor(spotlightEffects));
  const mosaicCursorRef = useRef<ActiveIntervalCursor<MosaicEffect>>(createActiveIntervalCursor(mosaicEffects));
  
  const selectedZoomEffectRef = useRef(selectedZoomEffect);
  const selectedSpotlightEffectRef = useRef(selectedSpotlightEffect);
  const selectedMosaicEffectRef = useRef(selectedMosaicEffect);
  
  const isPlayingRef = useRef(isPlaying);
  const coverImageRef = useRef(coverImage);
  const isExportingRef = useRef(isExporting); 
  const autoCoverAttemptedRef = useRef(false);
  
  const activeClipIdRef = useRef(activeClipId);
  const isEditingCropRef = useRef(isEditingCrop);
  
  const canvasBackgroundColorRef = useRef(canvasBackgroundColor);
  const playbackRateRef = useRef(playbackRate);
  const isMutedRef = useRef(isMuted);
  const isAudioTrackMutedRef = useRef(isAudioTrackMuted);
  
  const introSrcRef = useRef(introSrc);
  const mainSrcRef = useRef(mainSrc);
  const outroSrcRef = useRef(outroSrc);
  const activeClipsRef = useRef(activeClips);
  const audioClipsRef = useRef(audioClips);

  // Sync Props to Refs
  useEffect(() => { srcRef.current = src; }, [src]);
  useEffect(() => {
    allSubtitlesRef.current = allSubtitles;
    subtitleCursorRef.current = createActiveIntervalCursor(allSubtitles);
  }, [allSubtitles]);
  useEffect(() => {
    zoomEffectsRef.current = zoomEffects;
    zoomCursorRef.current = createActiveIntervalCursor(zoomEffects);
  }, [zoomEffects]);
  useEffect(() => {
    spotlightEffectsRef.current = spotlightEffects;
    spotlightCursorRef.current = createActiveIntervalCursor(spotlightEffects);
  }, [spotlightEffects]);
  useEffect(() => {
    mosaicEffectsRef.current = mosaicEffects;
    mosaicCursorRef.current = createActiveIntervalCursor(mosaicEffects);
  }, [mosaicEffects]);
  
  useEffect(() => { selectedZoomEffectRef.current = selectedZoomEffect; }, [selectedZoomEffect]);
  useEffect(() => { selectedSpotlightEffectRef.current = selectedSpotlightEffect; }, [selectedSpotlightEffect]);
  useEffect(() => { selectedMosaicEffectRef.current = selectedMosaicEffect; }, [selectedMosaicEffect]);
  
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { coverImageRef.current = coverImage; }, [coverImage]);
  useEffect(() => { isExportingRef.current = isExporting; }, [isExporting]);
  useEffect(() => { activeClipIdRef.current = activeClipId; }, [activeClipId]);
  useEffect(() => { isEditingCropRef.current = isEditingCrop; }, [isEditingCrop]);
  useEffect(() => { canvasBackgroundColorRef.current = canvasBackgroundColor; }, [canvasBackgroundColor]);
  useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isAudioTrackMutedRef.current = isAudioTrackMuted; }, [isAudioTrackMuted]);
  
  useEffect(() => { introSrcRef.current = introSrc; }, [introSrc]);
  useEffect(() => { mainSrcRef.current = mainSrc; }, [mainSrc]);
  useEffect(() => { outroSrcRef.current = outroSrc; }, [outroSrc]);
  useEffect(() => {
    activeClipsRef.current = activeClips ? [...activeClips].sort((a, b) => a.offset - b.offset) : activeClips;
  }, [activeClips]);
  useEffect(() => {
    audioClipsRef.current = audioClips ? [...audioClips].sort((a, b) => a.offset - b.offset) : audioClips;
  }, [audioClips]);

  const { 
      subDragState,
      handleSubMouseDown, 
      handleZoomMouseDown, 
      handleSpotlightMouseDown, 
      handleCropMouseDown, 
      handleMosaicMouseDown, 
      handleMosaicMouseMove, 
      handleMosaicMouseUp
  } = useCanvasInteraction({
      allSubtitlesRef,
      zoomEffectsRef,
      spotlightEffectsRef,
      mosaicEffectsRef,
      selectedZoomEffect,
      selectedSpotlightEffect,
      selectedMosaicEffect,
      isPlaying,
      currentTimeRef,
      contentRef,
      currentBrushSize,
      onUpdateSubtitle,
      onUpdateZoomEffect,
      onUpdateSpotlightEffect,
      onUpdateMosaicEffect,
      onSelectSubtitle,
      onInteractionStart,
      activeClipId, // For highlighting logic
      onUpdateClip,
      activeClipsRef
  });

  const { startRecording, stopRecording, captureFrame, startOfflineSession, addVideoFrame, finishOfflineSession, encodeAudioAsM4a } = useCanvasRecorder({
      canvasRef,
      introRef: introVideoRef,
      mainRef: mainVideoRef,
      outroRef: outroVideoRef,
      audioRef,
      coverImageRef
  });

  const syncCanvasSize = (canvas: HTMLCanvasElement | null, width: number, height: number) => {
      if (!canvas || width <= 0 || height <= 0) return;

      const nextWidth = alignEven(width);
      const nextHeight = alignEven(height);

      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
          canvas.width = nextWidth;
          canvas.height = nextHeight;
      }
  };

  const syncExportCanvasSize = (width: number, height: number) => {
      sourceDimensionsRef.current = { width, height };

      const lockedSize = exportCanvasLockRef.current;
      if (lockedSize) {
          syncCanvasSize(exportCanvasRef.current, lockedSize.width, lockedSize.height);
          return;
      }

      syncCanvasSize(exportCanvasRef.current, width, height);
  };

  const lockExportCanvasSize = (width: number, height: number) => {
      const lockedSize = {
          width: alignEven(width),
          height: alignEven(height)
      };

      exportCanvasLockRef.current = lockedSize;
      syncCanvasSize(exportCanvasRef.current, lockedSize.width, lockedSize.height);

      return exportCanvasRef.current;
  };

  const releaseExportCanvasSize = () => {
      exportCanvasLockRef.current = null;

      if (sourceDimensionsRef.current.width > 0 && sourceDimensionsRef.current.height > 0) {
          syncCanvasSize(exportCanvasRef.current, sourceDimensionsRef.current.width, sourceDimensionsRef.current.height);
      }
  };

  const syncPreviewCanvasSize = () => {
      if (!canvasRef.current || containerSize.width <= 0 || containerSize.height <= 0) return;

      const devicePixelRatio = window.devicePixelRatio || 1;
      let width = Math.max(2, Math.round(containerSize.width * devicePixelRatio));
      let height = Math.max(2, Math.round(containerSize.height * devicePixelRatio));
      const longEdge = Math.max(width, height);

      if (longEdge > PREVIEW_MAX_LONG_EDGE) {
          const scale = PREVIEW_MAX_LONG_EDGE / longEdge;
          width = Math.max(2, Math.round(width * scale));
          height = Math.max(2, Math.round(height * scale));
      }

      syncCanvasSize(canvasRef.current, width, height);

      if (exportCanvasRef.current.width === 0 || exportCanvasRef.current.height === 0) {
          syncCanvasSize(exportCanvasRef.current, width, height);
      }
  };

  const findActiveClip = (clips: Clip[] | undefined, time: number) => {
      if (!clips || clips.length === 0) return null;

      let low = 0;
      let high = clips.length - 1;
      let candidate: Clip | null = null;

      while (low <= high) {
          const mid = (low + high) >> 1;
          const clip = clips[mid];

          if (clip.offset <= time) {
              candidate = clip;
              low = mid + 1;
          } else {
              high = mid - 1;
          }
      }

      if (!candidate) return null;
      return time < getClipEnd(candidate) ? candidate : null;
  };

  const waitForMediaReady = (video: HTMLVideoElement, minimumReadyState = 2) => new Promise<void>((resolve, reject) => {
      if (video.readyState >= minimumReadyState) {
          resolve();
          return;
      }

      const readyEvent = minimumReadyState >= 2 ? 'canplay' : 'loadedmetadata';

      const cleanup = () => {
          video.removeEventListener(readyEvent, handleReady);
          video.removeEventListener('error', handleError);
      };

      const handleReady = () => {
          cleanup();
          resolve();
      };

      const handleError = () => {
          cleanup();
          reject(video.error || new Error('Failed to prepare video for export.'));
      };

      video.addEventListener(readyEvent, handleReady, { once: true });
      video.addEventListener('error', handleError, { once: true });
  });

  const waitForSeek = (video: HTMLVideoElement, targetTime: number) => new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - targetTime) < 0.05) {
          resolve();
          return;
      }

      const handleSeeked = () => {
          video.removeEventListener('seeked', handleSeeked);
          resolve();
      };

      video.addEventListener('seeked', handleSeeked, { once: true });
      video.currentTime = targetTime;
  });

  const pauseAllExportVideos = () => {
      [introVideoRef.current, mainVideoRef.current, outroVideoRef.current].forEach(video => {
          if (video && !video.paused) {
              video.pause();
          }
      });
  };

  const resolveClipVideoState = (clip: Clip | null) => {
      if (!clip) return null;

      if (clip.mediaType === 'intro') {
          return { video: introVideoRef.current, src: introSrcRef.current || null };
      }

      if (clip.mediaType === 'main') {
          return { video: mainVideoRef.current, src: mainSrcRef.current || null };
      }

      if (clip.mediaType === 'outro') {
          return { video: outroVideoRef.current, src: outroSrcRef.current || null };
      }

      return null;
  };

  // --- MEDIA SYNC LOGIC ---
  const syncMediaState = (time: number) => {
      if (isExportingRef.current) return;

      const videos = [
          { ref: introVideoRef, type: 'intro', src: introSrcRef.current },
          { ref: mainVideoRef, type: 'main', src: mainSrcRef.current },
          { ref: outroVideoRef, type: 'outro', src: outroSrcRef.current }
      ];

      // 1. Find the currently active clip
      const activeClip = findActiveClip(activeClipsRef.current, time);

      // 2. Pre-roll Logic: Identify upcoming clip to warm up
      let prerollClip: Clip | null = null;
      if (isPlayingRef.current && activeClip) {
          const activeEnd = getClipEnd(activeClip);
          const timeRemaining = activeEnd - time;
          
          // If approaching the end (within 1 second), find immediate successor
          if (timeRemaining < 1.0) {
              prerollClip = activeClipsRef.current?.find(c => 
                  c.id !== activeClip.id && 
                  Math.abs(c.offset - activeEnd) < 0.2 // Starts within 200ms of current ending
              ) || null;
          }
      }

      let activeVideoRef: React.RefObject<HTMLVideoElement> | null = null;
      let targetTime = 0;
      let targetSpeed = 1;

      if (activeClip) {
          const v = videos.find(v => v.type === activeClip.mediaType);
          if (v && v.src && !v.src.startsWith('color:') && !v.src.startsWith('image:')) {
              activeVideoRef = v.ref;
              const timeIntoClip = (time - activeClip.offset) * activeClip.speed;
              targetTime = activeClip.sourceStart + timeIntoClip;
              targetSpeed = playbackRateRef.current * activeClip.speed;
          }
      }

      videos.forEach(v => {
          const el = v.ref.current;
          if (!el) return;

          if (v.ref === activeVideoRef) {
              // --- ACTIVE VIDEO ---
              el.muted = isMutedRef.current || (activeClip?.muted ?? false);
              el.playbackRate = targetSpeed;

              const diff = Math.abs(el.currentTime - targetTime);
              // Relax threshold significantly during playback to trust the video clock more.
              // Stuttering happens when we fight the video element with micro-seeks.
              const driftThreshold = isPlayingRef.current ? 1.0 : 0.05;

              // GUARD: Do not seek if video is already seeking (prevents shutter/lag)
              // Only apply this guard if we are NOT playing (i.e. scrubbing/hovering)
              // If playing, we trust the drift threshold logic more.
              const isBusySeeking = !isPlayingRef.current && el.seeking;

              if (diff > driftThreshold && el.readyState >= 1 && !isBusySeeking) {
                  el.currentTime = targetTime;
              }

              if (isPlayingRef.current && el.paused && el.readyState >= 2) {
                  el.play().catch(() => {});
              } else if (!isPlayingRef.current && !el.paused) {
                  el.pause();
              }
          } else {
              // --- INACTIVE VIDEO ---
              
              // Pre-roll: Seek to start if it's the next up (and not image/color)
              if (prerollClip && v.type === prerollClip.mediaType && v.src && !v.src.startsWith('color:') && !v.src.startsWith('image:')) {
                  const preTarget = prerollClip.sourceStart;
                  const preDiff = Math.abs(el.currentTime - preTarget);
                  if (preDiff > 0.1 && el.readyState >= 1 && !el.seeking) {
                      el.currentTime = preTarget;
                  }
              }

              // Always ensure inactive videos are paused
              if (!el.paused) el.pause();
          }
      });

      const activeAudioClip = findActiveClip(audioClipsRef.current, time);

      const audioEl = audioRef.current;
      if (audioEl && audioEl.src) {
          if (activeAudioClip) {
              const timeIntoClip = (time - activeAudioClip.offset) * activeAudioClip.speed;
              const audioTargetTime = activeAudioClip.sourceStart + timeIntoClip;
              const audioTargetSpeed = playbackRateRef.current * activeAudioClip.speed;

              audioEl.muted = isAudioTrackMutedRef.current;
              audioEl.playbackRate = audioTargetSpeed;

              const diff = Math.abs(audioEl.currentTime - audioTargetTime);
              const driftThreshold = isPlayingRef.current ? 1.0 : 0.05;

              const isBusySeeking = !isPlayingRef.current && audioEl.seeking;

              if (diff > driftThreshold && audioEl.readyState >= 1 && !isBusySeeking) {
                  audioEl.currentTime = audioTargetTime;
              }

              if (isPlayingRef.current && audioEl.paused && audioEl.readyState >= 2) {
                  audioEl.play().catch(() => {});
              } else if (!isPlayingRef.current && !audioEl.paused) {
                  audioEl.pause();
              }
          } else {
              if (!audioEl.paused) audioEl.pause();
          }
      }
  };

  const getFrameState = (time: number) => {
      const clip = findActiveClip(activeClipsRef.current, time);

      if (!clip) return null;

      let video: HTMLVideoElement | null = null;
      let currentSrc: string | null = null;

      if (clip.mediaType === 'intro') { 
          video = introVideoRef.current; 
          currentSrc = introSrcRef.current || null; 
      }
      else if (clip.mediaType === 'main') { 
          video = mainVideoRef.current; 
          currentSrc = mainSrcRef.current || null; 
      }
      else if (clip.mediaType === 'outro') { 
          video = outroVideoRef.current; 
          currentSrc = outroSrcRef.current || null; 
      }

      const timeIntoClip = (time - clip.offset) * clip.speed;
      const sourceTime = clip.sourceStart + timeIntoClip;

      return { video, src: currentSrc, sourceTime, clip };
  };

  const seekTo = async (time: number): Promise<void> => {
      const state = getFrameState(time);
      if (!state || !state.video || !state.src || state.src.startsWith('color:') || state.src.startsWith('image:')) {
          return Promise.resolve();
      }
      const { video, sourceTime } = state;
      return new Promise<void>((resolve) => {
          if (Math.abs(video!.currentTime - sourceTime) < 0.05) {
              resolve();
              return;
          }
          const onSeeked = () => {
              video!.removeEventListener('seeked', onSeeked);
              resolve();
          };
          video!.addEventListener('seeked', onSeeked, { once: true });
          video!.currentTime = sourceTime;
      });
  };

  const prepareExportPlayback = async (clip: Clip | null): Promise<'video' | 'static' | 'empty'> => {
      pauseAllExportVideos();
      exportPlaybackVideoRef.current = null;
      exportPlaybackModeRef.current = null;

      if (!clip) {
          return 'empty';
      }

      const resolved = resolveClipVideoState(clip);
      if (!resolved?.video || !resolved.src || resolved.src.startsWith('color:') || resolved.src.startsWith('image:')) {
          return 'static';
      }

      const { video } = resolved;

      await waitForMediaReady(video, 1);
      await waitForSeek(video, clip.sourceStart);

      let mode: 'playback' | 'seek' = 'seek';
      video.muted = true;
      video.playbackRate = clip.speed;

      try {
          await waitForMediaReady(video, 2);
          await video.play();
          mode = 'playback';
      } catch {
          video.pause();
      }

      exportPlaybackVideoRef.current = video;
      exportPlaybackModeRef.current = mode;

      return 'video';
  };

  const syncExportPlayback = async (sourceTime: number): Promise<void> => {
      const video = exportPlaybackVideoRef.current;
      const mode = exportPlaybackModeRef.current;

      if (!video || !mode) return;

      if (mode === 'seek') {
          await waitForSeek(video, sourceTime);
          return;
      }

      const tolerance = 1 / 240;
      if (video.currentTime + tolerance >= sourceTime || video.paused || video.ended) {
          return;
      }

      await new Promise<void>((resolve) => {
          let settled = false;
          let timeoutId: number | null = null;

          const finish = () => {
              if (settled) return;
              settled = true;
              if (timeoutId !== null) {
                  window.clearTimeout(timeoutId);
              }
              resolve();
          };

          const onFrame = () => {
              if (video.currentTime + tolerance >= sourceTime || video.paused || video.ended) {
                  finish();
                  return;
              }

              if (typeof video.requestVideoFrameCallback === 'function') {
                  video.requestVideoFrameCallback(onFrame);
              } else {
                  requestAnimationFrame(onFrame);
              }
          };

          timeoutId = window.setTimeout(finish, 1000);

          if (typeof video.requestVideoFrameCallback === 'function') {
              video.requestVideoFrameCallback(onFrame);
          } else {
              requestAnimationFrame(onFrame);
          }
      });
  };

  const stopExportPlayback = () => {
      pauseAllExportVideos();
      exportPlaybackVideoRef.current = null;
      exportPlaybackModeRef.current = null;
  };

  useEffect(() => { autoCoverAttemptedRef.current = false; }, [mainSrc]);

  useEffect(() => {
    if (!contentRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
            setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
    });
    resizeObserver.observe(contentRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
      const img = currentImageRef.current;
      const handleLoad = () => {
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              syncExportCanvasSize(img.naturalWidth, img.naturalHeight);
              if (!isPlayingRef.current && !isExportingRef.current) {
                  renderFrame('preview');
              }
          }
      };

      img.addEventListener('load', handleLoad);
      return () => img.removeEventListener('load', handleLoad);
  }, []);

  const handleContainerMouseMove = (e: React.MouseEvent) => {
      // Logic moved to loop or simplified
      if (onPreviewHover && contentRef.current) {
          const rect = contentRef.current.getBoundingClientRect();
          const viewX = ((e.clientX - rect.left) / rect.width) * 100;
          const viewY = ((e.clientY - rect.top) / rect.height) * 100;
          
          let visibleRect = { x: 0, y: 0, width: 100, height: 100 };
          const frameState = getFrameState(currentTimeRef.current);
          const crop = frameState?.clip?.crop || { x: 0, y: 0, width: 100, height: 100 };
          
          // Find Active Zoom
          const activeZoom = zoomEffectsRef.current?.find(z => currentTimeRef.current >= z.start && currentTimeRef.current < z.end);
          
          let zoomRect = { x: 0, y: 0, width: 100, height: 100 };
          if (activeZoom) {
             zoomRect = calculateZoomRect(activeZoom, currentTimeRef.current);
          }
          visibleRect.x = crop.x + (zoomRect.x / 100) * crop.width;
          visibleRect.y = crop.y + (zoomRect.y / 100) * crop.height;
          visibleRect.width = (zoomRect.width / 100) * crop.width;
          visibleRect.height = (zoomRect.height / 100) * crop.height;

          const sourceX = visibleRect.x + (viewX / 100) * visibleRect.width;
          const sourceY = visibleRect.y + (viewY / 100) * visibleRect.height;

          onPreviewHover(sourceX, sourceY);
      }
      if (selectedMosaicEffect && selectedMosaicEffectRef.current?.id === selectedMosaicEffect.id && !isPlaying && selectedMosaicEffect.mode !== 'box') {
          handleMosaicMouseDown(e);
      }
  };

  const renderFrame = (mode: 'preview' | 'export' = (isExportingRef.current ? 'export' : 'preview')) => {
    const currentGlobalTime = internalPreviewTimeRef.current ?? currentTimeRef.current;
    const renderForExport = mode === 'export';

    if (!renderForExport) {
        syncMediaState(currentGlobalTime);
    }

    const frameState = getFrameState(currentGlobalTime);
    const video = frameState?.video || null;
    const currentSrc = frameState?.src || null;
    const currentSourceTime = frameState?.sourceTime ?? null;
    const activeClipTiming = frameState ? { offset: frameState.clip.offset, sourceStart: frameState.clip.sourceStart, speed: frameState.clip.speed } : null;
    const canvas = renderForExport ? exportCanvasRef.current : canvasRef.current;

    if (!canvas) return;

    if (!renderForExport && video && !currentSrc?.startsWith('color:') && !currentSrc?.startsWith('image:') && video.readyState < 2) {
        return;
    }

    const subtitlesToRender = resolveActiveItems(subtitleCursorRef.current, currentGlobalTime);
    const activeZooms = resolveActiveItems(zoomCursorRef.current, currentGlobalTime);
    const activeSpotlights = resolveActiveItems(spotlightCursorRef.current, currentGlobalTime);
    const activeMosaics = resolveActiveItems(mosaicCursorRef.current, currentGlobalTime);
    const zoom = activeZooms[activeZooms.length - 1];
    const spotlight = activeSpotlights[activeSpotlights.length - 1];
    const mosaic = activeMosaics[activeMosaics.length - 1];

    const playing = isPlayingRef.current;
    const selectedZoom = renderForExport ? null : selectedZoomEffectRef.current;
    const selectedSpotlight = renderForExport ? null : selectedSpotlightEffectRef.current;
    const editingCrop = renderForExport ? false : isEditingCropRef.current;
    const clipCrop = frameState?.clip?.crop;

    let activeClipCrop = clipCrop;
    if (!activeClipCrop && activeClipIdRef.current && activeClipsRef.current) {
        const found = activeClipsRef.current.find(c => c.id === activeClipIdRef.current);
        if (found) activeClipCrop = found.crop;
    }

    const crop = activeClipCrop;
    const bgColor = canvasBackgroundColorRef.current || '#000000';
    const isEditingZoomState = !!(selectedZoom && zoom && selectedZoom.id === zoom.id && !playing);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const activeMediaType = frameState?.clip.mediaType;
    const isCapturingCover = !renderForExport && !coverImageRef.current && !autoCoverAttemptedRef.current && onAutoCover && activeMediaType === 'main';

    if (currentSourceTime !== null) {
        if (currentSrc && currentSrc.startsWith('color:')) {
            const color = currentSrc.split('color:')[1];
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (!isEditingZoomState && !editingCrop) {
                if (mosaic) renderMosaic(ctx, null, mosaic, pixelCanvasRef.current, maskCanvasRef.current, canvas.width, canvas.height, null, playing, color);
                if (spotlight) renderSpotlight(ctx, spotlight, canvas.width, canvas.height, selectedSpotlight, playing, currentGlobalTime);
            }
        } else if (currentSrc && currentSrc.startsWith('image:')) {
            const realSrc = currentSrc.split('image:')[1];
            const img = currentImageRef.current;

            if (img.src !== realSrc) {
                img.src = realSrc;
            }

            if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
                if (sourceDimensionsRef.current.width !== img.naturalWidth || sourceDimensionsRef.current.height !== img.naturalHeight) {
                    syncExportCanvasSize(img.naturalWidth, img.naturalHeight);
                }
                const cropInfo = renderVideoFrame(ctx, img, canvas.width, canvas.height, zoom, crop, playing, selectedZoom, editingCrop, currentGlobalTime, activeClipTiming);
                if (!isEditingZoomState && !editingCrop) {
                    if (mosaic) renderMosaic(ctx, img, mosaic, pixelCanvasRef.current, maskCanvasRef.current, canvas.width, canvas.height, cropInfo, playing);
                    if (spotlight) renderSpotlight(ctx, spotlight, canvas.width, canvas.height, selectedSpotlight, playing, currentGlobalTime, cropInfo);
                }
            }
        } else if (video && (video.readyState >= 2 || renderForExport)) {
            if (video.videoWidth > 0 && video.videoHeight > 0 && (sourceDimensionsRef.current.width !== video.videoWidth || sourceDimensionsRef.current.height !== video.videoHeight)) {
                syncExportCanvasSize(video.videoWidth, video.videoHeight);
            }
            const cropInfo = renderVideoFrame(ctx, video, canvas.width, canvas.height, zoom, crop, playing, selectedZoom, editingCrop, currentGlobalTime, activeClipTiming);
            if (!isEditingZoomState && !editingCrop) {
                if (mosaic) renderMosaic(ctx, video, mosaic, pixelCanvasRef.current, maskCanvasRef.current, canvas.width, canvas.height, cropInfo, playing);
                if (spotlight) renderSpotlight(ctx, spotlight, canvas.width, canvas.height, selectedSpotlight, playing, currentGlobalTime, cropInfo);
            }
        }
    }

    renderSubtitles(ctx, subtitlesToRender, canvas.width, canvas.height, null, !renderForExport && playing);

    if (isCapturingCover) {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        if (dataUrl && dataUrl !== 'data:,') {
            onAutoCover(dataUrl);
            autoCoverAttemptedRef.current = true;
        }
    }
  };

  const renderLoop = () => {
    renderFrame('preview');
    if (isPlayingRef.current && !isExportingRef.current) {
        requestRef.current = requestAnimationFrame(renderLoop);
    }
  };

  const previewSeek = (time: number | null) => {
      internalPreviewTimeRef.current = time;
      if (time !== null) {
          const state = getFrameState(time);
          if (state && state.video && !state.src?.startsWith('color:') && !state.src?.startsWith('image:') && !state.video.seeking) {
              state.video.currentTime = state.sourceTime;
          }
      }
      renderFrame('preview');
  };

  const renderFrameNow = () => renderFrame(isExportingRef.current ? 'export' : 'preview');
  const getCanvas = () => {
      if ((exportCanvasRef.current.width === 0 || exportCanvasRef.current.height === 0) && sourceDimensionsRef.current.width > 0 && sourceDimensionsRef.current.height > 0) {
          syncExportCanvasSize(sourceDimensionsRef.current.width, sourceDimensionsRef.current.height);
      }
      return (isExportingRef.current || exportCanvasLockRef.current) ? exportCanvasRef.current : canvasRef.current;
  };

  useImperativeHandle(ref, () => ({ 
      startRecording, stopRecording, captureFrame, seekTo, renderFrame: renderFrameNow, getCanvas, previewSeek,
      prepareExportPlayback, syncExportPlayback, stopExportPlayback,
      startOfflineSession: startOfflineSession as any, addVideoFrame: addVideoFrame as any, finishOfflineSession: finishOfflineSession as any,
      encodeAudioAsM4a,
      prepareExportCanvas: lockExportCanvasSize as any,
      releaseExportCanvas: releaseExportCanvasSize as any
  }));

  useEffect(() => {
      syncPreviewCanvasSize();
  }, [containerSize.width, containerSize.height, aspectRatio]);

  useEffect(() => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);

      if (isPlaying && !isExporting) {
          requestRef.current = requestAnimationFrame(renderLoop);
      } else if (!isExporting && internalPreviewTimeRef.current === null) {
          renderFrame('preview');
      }

      return () => {
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
          stopExportPlayback();
      };
  }, [isPlaying, isExporting]);

  useEffect(() => {
      if (isPlaying || isExporting || internalPreviewTimeRef.current !== null) return;
      renderFrame('preview');
  }, [
      currentTime,
      src,
      introSrc,
      mainSrc,
      outroSrc,
      allSubtitles,
      zoomEffects,
      spotlightEffects,
      mosaicEffects,
      selectedSubtitleId,
      selectedZoomEffect,
      selectedSpotlightEffect,
      selectedMosaicEffect,
      activeClipId,
      activeClips,
      canvasBackgroundColor,
      containerSize.width,
      containerSize.height
  ]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    const isMain = video === mainVideoRef.current;
    if (isMain || (!mainSrc && video === introVideoRef.current) || (!mainSrc && !introSrc && video === outroVideoRef.current)) {
        onDurationChange(video.duration);
        syncExportCanvasSize(video.videoWidth, video.videoHeight);
        if (!isPlayingRef.current && !isExportingRef.current) {
            renderFrame('preview');
        }
    }
  };

  // UI States for Overlay Editing (Calculated from Refs/State for current selection rendering)
  // For overlay UI, we still rely on React re-rendering when SELECTION changes (which is fine, not per-frame)
  // We need to resolve the "Active" item for the UI overlay based on current time from Ref? 
  // No, React renders UI. We can use currentTimeRef.current? 
  // Actually, for the EDITING UI (Box handles), we are usually PAUSED. 
  // If we are playing, we hide handles.
  
  // So standard React render is fine here.
  const isEditingZoom = selectedZoomEffect && !isPlaying;
  const isEditingSpotlight = selectedSpotlightEffect && !isPlaying;
  const isEditingMosaic = selectedMosaicEffect && !isPlaying && selectedMosaicEffect.mode === 'box';
  
  // Helper to find "Active" crop for UI
  const getActiveClipCropForUI = () => {
      if (activeClipId && activeClips) {
          const c = activeClips.find(c => c.id === activeClipId);
          return c?.crop;
      }
      return undefined;
  };
  
  const uiClipCrop = getActiveClipCropForUI();

  const currentScale = selectedZoomEffect ? (100 / selectedZoomEffect.width).toFixed(1) : '';
  const spotlightStyle = (isEditingSpotlight && selectedSpotlightEffect) ? { left: `${selectedSpotlightEffect.x}%`, top: `${selectedSpotlightEffect.y}%`, width: `${selectedSpotlightEffect.width}%`, height: `${selectedSpotlightEffect.height}%` } : {};
  const mosaicBoxStyle = (isEditingMosaic && selectedMosaicEffect) ? { left: `${selectedMosaicEffect.x ?? 35}%`, top: `${selectedMosaicEffect.y ?? 35}%`, width: `${selectedMosaicEffect.width ?? 30}%`, height: `${selectedMosaicEffect.height ?? 30}%` } : {};
  const cropStyle = (isEditingCrop && uiClipCrop) ? { left: `${uiClipCrop.x}%`, top: `${uiClipCrop.y}%`, width: `${uiClipCrop.width}%`, height: `${uiClipCrop.height}%` } : {};

  const zoomOverlayStyle: React.CSSProperties = (isEditingZoom && selectedZoomEffect) ? {
      left: `${(selectedZoomEffect.x || 0).toFixed(4)}%`,
      top: `${(selectedZoomEffect.y || 0).toFixed(4)}%`,
      width: `${(selectedZoomEffect.width || 50).toFixed(4)}%`,
      height: `${(selectedZoomEffect.height || 50).toFixed(4)}%`,
      touchAction: 'none',
      position: 'absolute',
      transform: 'none', 
      margin: 0
  } : {};

  let currentSelection: any = null;
  if (selectedSubtitleId) currentSelection = { type: 'subtitle', id: selectedSubtitleId };
  else if (selectedZoomEffect) currentSelection = { type: 'zoom', id: selectedZoomEffect.id };
  else if (selectedSpotlightEffect) currentSelection = { type: 'spotlight', id: selectedSpotlightEffect.id };
  else if (selectedMosaicEffect) currentSelection = { type: 'mosaic', id: selectedMosaicEffect.id };

  const selectedSubtitle = selectedSubtitleId ? allSubtitles.find(s => s.id === selectedSubtitleId) : undefined;
  
  const activeSubsForCanvas = allSubtitles; // Logic moved to renderFrame

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center rounded-lg shadow-xl overflow-visible" style={{ backgroundColor: canvasBackgroundColor }} onDoubleClick={() => onTogglePlay && onTogglePlay()}>
      {introSrc && !introSrc.startsWith('color:') && !introSrc.startsWith('image:') && <video ref={introVideoRef} src={introSrc} className="hidden" onLoadedMetadata={handleLoadedMetadata} playsInline muted={isMuted} crossOrigin="anonymous" />}
      {mainSrc && !mainSrc.startsWith('color:') && !mainSrc.startsWith('image:') && <video ref={mainVideoRef} src={mainSrc} className="hidden" onLoadedMetadata={handleLoadedMetadata} playsInline muted={isMuted} crossOrigin="anonymous" />}
      {outroSrc && !outroSrc.startsWith('color:') && !outroSrc.startsWith('image:') && <video ref={outroVideoRef} src={outroSrc} className="hidden" onLoadedMetadata={handleLoadedMetadata} playsInline muted={isMuted} crossOrigin="anonymous" />}
      <audio ref={audioRef} src={audioSrc || undefined} className="hidden" crossOrigin="anonymous" />

      <div 
        ref={contentRef} 
        className="relative shadow-2xl overflow-visible rounded-lg" 
        style={{ aspectRatio, maxWidth: '100%', maxHeight: '100%', backgroundColor: canvasBackgroundColor }} 
        onMouseDown={selectedMosaicEffect && selectedMosaicEffect.mode !== 'box' && !isPlaying ? (e) => handleMosaicMouseDown(e, null) : (e) => e.target === canvasRef.current && onSelectSubtitle(null)} 
        onMouseMove={handleContainerMouseMove} 
        onMouseLeave={onPreviewLeave}
      >
        {!isExporting && !isPlaying && (
            <PropertyHUD 
                selection={currentSelection}
                selectedSubtitle={selectedSubtitle}
                selectedZoom={selectedZoomEffect || undefined}
                selectedSpotlight={selectedSpotlightEffect || undefined}
                selectedMosaic={selectedMosaicEffect || undefined}
                currentBrushSize={currentBrushSize}
                projectName={projectName}
                canvasBackgroundColor={canvasBackgroundColor}
                aspectRatio={aspectRatio}
                onUpdateSubtitle={onUpdateSubtitle}
                onUpdateZoom={onUpdateZoomEffect}
                onUpdateSpotlight={onUpdateSpotlightEffect}
                onUpdateMosaic={onUpdateMosaicEffect}
                onBrushSizeChange={onMosaicBrushSizeChange}
                onUpdateProjectSettings={onUpdateProjectSettings}
                onDeselect={() => {
                    onSelectSubtitle(null);
                    onSelectZoomEffect('');
                    onSelectSpotlightEffect('');
                    onSelectMosaicEffect('');
                }}
            />
        )}

        <canvas ref={canvasRef} className={`w-full h-full object-contain block rounded-lg ${selectedMosaicEffect && !isPlaying && selectedMosaicEffect.mode !== 'box' ? 'cursor-crosshair' : 'pointer-events-none'}`} />
        
        {isEditingCrop && uiClipCrop && (
          <div className="absolute z-40" style={{ ...cropStyle, touchAction: 'none' }} onMouseDown={(e) => handleCropMouseDown(e, 'move')}>
            {/* Crop UI Content */}
            <div className="w-full h-full border-2 border-white bg-black/10 cursor-move relative shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]">
                <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-white border border-black cursor-nw-resize z-40" onMouseDown={(e) => handleCropMouseDown(e, 'resize-tl')} />
                <div className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-white border border-black cursor-ne-resize z-40" onMouseDown={(e) => handleCropMouseDown(e, 'resize-tr')} />
                <div className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-white border border-black cursor-sw-resize z-40" onMouseDown={(e) => handleCropMouseDown(e, 'resize-bl')} />
                <div className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border border-black cursor-se-resize z-40" onMouseDown={(e) => handleCropMouseDown(e, 'resize-br')} />
                <div className="absolute top-2 left-2 text-[10px] text-white bg-black/70 px-1.5 py-0.5 rounded pointer-events-none">Crop Area</div>
                <button 
                    className="absolute -bottom-10 right-0 bg-white text-black px-3 py-1 rounded-full font-bold text-xs flex items-center gap-1 shadow-lg hover:bg-zinc-200 pointer-events-auto transition-transform hover:scale-105 active:scale-95" 
                    onClick={(e) => { e.stopPropagation(); onConfirmCrop && onConfirmCrop(); }}
                    title="Apply Crop"
                >
                    <Check size={14} /> Done
                </button>
            </div>
          </div>
        )}

        {isEditingZoom && selectedZoomEffect && (
          <div className="absolute z-40" style={zoomOverlayStyle} onMouseDown={(e) => handleZoomMouseDown(e, 'move')}>
             {/* Zoom Edit UI */}
             <div className="w-full h-full border-2 border-emerald-400 bg-emerald-500/10 cursor-move relative shadow-sm">
                {/* ... Handles ... */}
                <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-white border border-emerald-500 cursor-nw-resize z-40" onMouseDown={(e) => handleZoomMouseDown(e, 'resize-tl')} />
                <div className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-white border border-emerald-500 cursor-ne-resize z-40" onMouseDown={(e) => handleZoomMouseDown(e, 'resize-tr')} />
                <div className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-white border border-emerald-500 cursor-sw-resize z-40" onMouseDown={(e) => handleZoomMouseDown(e, 'resize-bl')} />
                <div className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border border-emerald-500 cursor-se-resize z-40" onMouseDown={(e) => handleZoomMouseDown(e, 'resize-br')} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-emerald-400/50"><Crosshair size={24} strokeWidth={1} /></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] text-white bg-emerald-600 px-1.5 py-0.5 rounded shadow pointer-events-none whitespace-nowrap flex flex-col items-center z-50 mt-6">
                    <span className="font-bold">{currentScale}x</span>
                    <span className="text-[8px] font-mono opacity-90">X:{selectedZoomEffect.x.toFixed(1)}% Y:{selectedZoomEffect.y.toFixed(1)}%</span>
                </div>
            </div>
          </div>
        )}

        {isEditingSpotlight && selectedSpotlightEffect && (
          <div className="absolute z-30" style={{ ...spotlightStyle, touchAction: 'none' }} onMouseDown={(e) => handleSpotlightMouseDown(e, 'move')}>
             {/* Spotlight Edit UI */}
             <div className="w-full h-full border-2 border-amber-400 bg-amber-500/10 cursor-move relative shadow-sm rounded-full group">
                <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-white border border-amber-500 rounded-full cursor-nw-resize z-40" onMouseDown={(e) => handleSpotlightMouseDown(e, 'resize-tl')} />
                <div className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-white border border-amber-500 rounded-full cursor-ne-resize z-40" onMouseDown={(e) => handleSpotlightMouseDown(e, 'resize-tr')} />
                <div className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-white border border-amber-500 rounded-full cursor-sw-resize z-40" onMouseDown={(e) => handleSpotlightMouseDown(e, 'resize-bl')} />
                <div className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border border-amber-500 rounded-full cursor-se-resize z-40" onMouseDown={(e) => handleSpotlightMouseDown(e, 'resize-br')} />
            </div>
          </div>
        )}

        {isEditingMosaic && selectedMosaicEffect && (
          <div className="absolute z-30" style={{ ...mosaicBoxStyle, touchAction: 'none' }} onMouseDown={(e) => handleMosaicMouseDown(e, 'move')}>
             {/* Mosaic Edit UI */}
             <div className="w-full h-full border-2 border-pink-400 bg-pink-500/10 cursor-move relative shadow-sm rounded group">
                <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-white border border-pink-500 cursor-nw-resize z-40" onMouseDown={(e) => handleMosaicMouseDown(e, 'resize-tl')} />
                <div className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-white border border-pink-500 cursor-ne-resize z-40" onMouseDown={(e) => handleMosaicMouseDown(e, 'resize-tr')} />
                <div className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-white border border-pink-500 cursor-sw-resize z-40" onMouseDown={(e) => handleMosaicMouseDown(e, 'resize-bl')} />
                <div className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-white border border-pink-500 cursor-se-resize z-40" onMouseDown={(e) => handleMosaicMouseDown(e, 'resize-br')} />
                {selectedMosaicEffect.shape === 'circle' && <div className="absolute inset-0 border border-pink-300/50 rounded-full pointer-events-none" />}
            </div>
          </div>
        )}

        {/* Selected Subtitle Editor Overlay (Only show if selected and NOT playing) */}
        {!isExporting && !isPlaying && selectedSubtitle && (
            <div
                className={`absolute z-20 pointer-events-auto cursor-move ring-1 ring-purple-500`}
                style={{
                    left: `${selectedSubtitle.x ?? 50}%`,
                    top: `${selectedSubtitle.y ?? 80}%`,
                    transform: `translate(-50%, -50%) rotate(${selectedSubtitle.rotation ?? 0}deg) scale(${selectedSubtitle.scale ?? 1})`,
                    transformOrigin: 'center center',
                }}
                onMouseDown={(e) => handleSubMouseDown(e, selectedSubtitle, 'move')}
            >
                 <div style={{
                      color: selectedSubtitle.color || 'white',
                      fontFamily: selectedSubtitle.fontFamily || 'Arial',
                      fontWeight: selectedSubtitle.fontWeight || 'bold',
                      fontStyle: selectedSubtitle.fontStyle || 'normal',
                      backgroundColor: selectedSubtitle.backgroundColor || 'transparent',
                      padding: selectedSubtitle.backgroundColor && selectedSubtitle.backgroundColor !== 'transparent' ? '0.2em 0.4em' : '0',
                      borderRadius: '0.2em',
                      fontSize: `${Math.max(12, containerSize.height * 0.05 * (selectedSubtitle.fontSize ? selectedSubtitle.fontSize / 100 : 1))}px`,
                      lineHeight: 1,
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      textShadow: (!selectedSubtitle.backgroundColor || selectedSubtitle.backgroundColor === 'transparent') ? `-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0,0,0,0.5)` : 'none',
                 }}>
                     {selectedSubtitle.text}
                 </div>

                 <>
                    <div 
                        className="absolute -top-6 left-1/2 -translate-x-1/2 w-4 h-4 bg-purple-500 rounded-full cursor-grab active:cursor-grabbing shadow border border-white flex items-center justify-center"
                        onMouseDown={(e) => handleSubMouseDown(e, selectedSubtitle, 'rotate')}
                    >
                        <RotateCcw size={8} className="text-white" />
                    </div>
                    <div 
                        className="absolute -bottom-2 -right-2 w-3 h-3 bg-white border border-purple-500 rounded-full cursor-nwse-resize shadow"
                        onMouseDown={(e) => handleSubMouseDown(e, selectedSubtitle, 'scale')}
                    />
                </>
            </div>
        )}
      </div>
    </div>
  );
}));

export default Player;
