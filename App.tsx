
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Circle, StopCircle, CheckCircle, Download, MousePointer2, Upload, Loader2 } from 'lucide-react';
import Player from './components/Player';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import { DebugPanel } from './components/DebugPanel';
import RecordingBar from './components/RecordingBar';
import ExportModal, { GifWebLimitPrompt } from './components/ExportModal';
import HeaderControls from './components/HeaderControls';
import { formatTimecode, formatTimeShort } from './utils';
import { useEditor } from './hooks/useEditor';
import { useScreenRecorder } from './hooks/useScreenRecorder';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAssetOperations } from './hooks/useAssetOperations';
import { usePlaybackContext } from './hooks/usePlaybackContext';
import { useExport } from './hooks/useExport';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import { useSubtitleTools } from './hooks/useSubtitleTools';
import SubtitleTools from './components/SubtitleTools';
import { setTranscriber, createWorkerTranscriber, createStubWorker, installDefaultTranscriber } from './utils/transcriber';
import { createWhisperTranscriber, ortWasmAbsoluteUrl } from './utils/whisperTranscriber';
import { chooseWhisperThreads, currentThreadEnv } from './utils/whisperThreads';

// #27: on-device Whisper is the default engine (opt-in download on first use).
installDefaultTranscriber(createWhisperTranscriber());
import { VideoExportFormat, VideoExportSettings } from './utils/exportPresets';
import { PlayerRef, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, Clip, RecordingEvent, AudioRole } from './types';
import { useRecordingDevices } from './hooks/useRecordingDevices';
import RecordingSetup from './components/RecordingSetup';
import { effectiveMutedRoles } from './utils/audioLanes';
import { renderProjectAudio } from './utils/audioRenderer';

const App: React.FC = () => {
  const {
    state, setState, stateRef, pushHistory, handleUndo, handleRedo,
    recalculateDuration, handleDelete, handleSplit, handleCrop, handleUpdateClip,
    handleUpdateSubtitle, handleUpdateZoomEffect, handleUpdateSpotlightEffect,
    handleUpdateMosaicEffect, handleDetachAudio, handleAddSubtitle,
    handleAddZoom, handleAddSpotlight, handleAddMosaic, handleZoomScaleChange,
    handleMosaicBrushSizeChange, handleClipSpeedChange, handleToggleDebug,
    handleSeek, handleSetCoverImage, handleUpdateProjectSettings, currentTimeRef,
    handleSetAudioRoleMuted, handleToggleNarrationClipMute
  } = useEditor();

  const playerRef = useRef<PlayerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track mouse hover over the preview player to target Zoom effects
  const previewHoverRef = useRef<{x: number, y: number} | null>(null);

  const { handleLoadProject, handleMagicPolish, handleAutoZoom, handleRemoveAutoZooms, handleAutoSpotlight, handleSetClickRipplesEnabled, handleSetAutoZoomEnabled, handleSetAutoZoomSensitivity, handleUrlImport, handleUploadAsset, handleSetColorAsset, handleRemoveAsset } = useAssetOperations({ setState, pushHistory, recalculateDuration, currentTimeRef, stateRef });
  const { videoCtx, audioCtx } = usePlaybackContext({ state });
  // #28: non-blocking notices (microphone denied / disconnected).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<any>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 8000);
  }, []);
  const { 
      isScreenRecording, 
      recordingMarkersCount, 
      capturedEventsCount, // Get new counter
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
  } = useScreenRecorder({ onRecordingComplete: handleLoadProject, onNotice: (m: string) => showNotice(m) });
  // #28: recording setup devices (mic/camera Off by default, locked while recording).
  const recordingDevices = useRecordingDevices({ locked: isScreenRecording });
  const startRecordingWithSetup = useCallback(() => {
    const micDeviceId = recordingDevices.micId;
    recordingDevices.releasePreviews();
    handleStartScreenRecording({ micDeviceId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingDevices.micId, recordingDevices.releasePreviews, handleStartScreenRecording]);
  const mutedRoles = effectiveMutedRoles(state);
  
  const { handleExportAction, gifWebLimit, dismissGifWebLimit } = useExport({ state, setState, playerRef, currentTimeRef });

  // Export settings dialog (aspect-ratio presets + MP4/WebM/GIF)
  const [exportSettingsFormat, setExportSettingsFormat] = useState<VideoExportFormat | null>(null);
  const [pendingExport, setPendingExport] = useState<VideoExportSettings | null>(null);

  const handleConfirmExport = useCallback((settings: VideoExportSettings) => {
    setExportSettingsFormat(null);
    if (Math.abs(settings.aspectRatio - state.aspectRatio) > 0.001) {
      handleUpdateProjectSettings({ aspectRatio: settings.aspectRatio });
    }
    setPendingExport(settings);
  }, [state.aspectRatio, handleUpdateProjectSettings]);

  // Start the export once the (possibly re-sized) canvas has been laid out and painted.
  useEffect(() => {
    if (!pendingExport) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const settings = pendingExport;
        setPendingExport(null);
        handleExportAction(false, settings.format, settings.gif);
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [pendingExport, handleExportAction]);

  // Persistence Hook
  const { lastSaved, isSaving, isResetting, saveProject, handleExportProject, handleImportProject, handleResetProject } = useProjectPersistence({ state, setState, recalculateDuration });

  // Zoom at cursor logic
  const handleAddZoomWrapper = useCallback(() => {
      const hover = previewHoverRef.current;
      if (hover) {
          handleAddZoom(hover.x, hover.y);
      } else {
          handleAddZoom();
      }
  }, [handleAddZoom]);

  const handlePreviewHover = useCallback((x: number, y: number) => {
      previewHoverRef.current = { x, y };
  }, []);

  const handlePreviewLeave = useCallback(() => {
      previewHoverRef.current = null;
  }, []);

  // New: Handle direct preview update from timeline scrubbing
  const handlePreviewTime = useCallback((time: number | null) => {
      if (playerRef.current) {
          playerRef.current.previewSeek(time);
      }
  }, []);

  const subtitleTools = useSubtitleTools({ setState, stateRef, pushHistory, recalculateDuration });

  useKeyboardShortcuts({ onDelete: handleDelete, onUndo: handleUndo, onRedo: handleRedo, onToggleDebug: handleToggleDebug, onAddZoom: handleAddZoomWrapper });

  useEffect(() => {
    document.title = isScreenRecording ? `${formatTimeShort(recordingDuration)} • Recording` : "FrameCut Web Editor";
  }, [isScreenRecording, recordingDuration]);

  // Playwright E2E seam (opt-in via window.__FRAMECUT_E2E_ENABLED__). Not used in production UI.
  useEffect(() => {
    const w = window as any;
    if (!w.__FRAMECUT_E2E_ENABLED__) return;
    w.__FRAMECUT_E2E__ = {
      getSnapshot: () => ({
        recordingEvents: state.recordingEvents,
        zoomEffects: state.zoomEffects.map(z => ({
          id: z.id,
          start: z.start,
          end: z.end,
          auto: !!z.auto,
          followCursor: !!z.followCursor,
          width: z.width,
          height: z.height,
          x: z.x,
          y: z.y,
          cursorPathLen: z.cursorPath?.length ?? 0,
          cursorPath: z.cursorPath ?? [],
        })),
        spotlightEffects: state.spotlightEffects.map(s => ({ id: s.id, start: s.start, end: s.end, x: s.x, y: s.y, width: s.width, height: s.height, auto: !!s.auto })),
        clickRipplesEnabled: state.clickRipplesEnabled !== false,
        backgroundFrame: state.backgroundFrame,
        clips: state.clips.map(c => ({ id: c.id, mediaType: c.mediaType, offset: c.offset, sourceStart: c.sourceStart, sourceEnd: c.sourceEnd, speed: c.speed })),
        mosaicEffects: state.mosaicEffects.map(m => ({ id: m.id, start: m.start, end: m.end, mode: m.mode, paths: m.paths, x: m.x, y: m.y, width: m.width, height: m.height })),
        subtitleTransforms: state.subtitles.map(s => ({ id: s.id, x: s.x, y: s.y, rotation: s.rotation, scale: s.scale })),
        subtitles: state.subtitles.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text, autoGenerated: !!s.autoGenerated })),
        autoZoomEnabled: state.autoZoomEnabled !== false,
        duration: state.duration,
        currentTime: state.currentTime,
        hasMainVideo: !!state.mainVideo,
        // #28
        narration: state.narration ? { timeOffset: state.narration.timeOffset ?? 0, duration: state.narration.duration, stored: !!state.narration.storageId, hasWaveform: !!state.narration.waveformData?.length } : null,
        narrationClips: (state.narrationClips ?? []).map(c => ({ id: c.id, offset: c.offset, sourceStart: c.sourceStart, sourceEnd: c.sourceEnd, speed: c.speed, muted: !!c.muted, recordingLinkID: c.recordingLinkID ?? null })),
        linkedClips: state.clips.map(c => ({ id: c.id, recordingLinkID: c.recordingLinkID ?? null, muted: !!c.muted })),
        mutedAudioRoles: state.mutedAudioRoles ?? [],
        isAudioTrackMuted: !!state.isAudioTrackMuted,
      }),
      /** #28: import a recording with microphone narration (same path as a real recording). */
      loadWithNarration: async (blob: Blob, events: RecordingEvent[], durationHint: number, narrationBlob: Blob, timeOffset: number, narrationDuration: number) => {
        await handleLoadProject(blob, 'E2E Narrated Recording', events, durationHint, { narration: { blob: narrationBlob, timeOffset, duration: narrationDuration } });
      },
      select: (sel: any) => setState(prev => ({ ...prev, selection: sel })),
      split: () => handleSplit(),
      deleteSelected: () => handleDelete(),
      setSelectedSpeed: (speed: number) => handleClipSpeedChange(speed),
      updateClip: (id: string, patch: Partial<Clip>) => {
        const clip = stateRef.current.clips.find(c => c.id === id);
        if (clip) { pushHistory(); handleUpdateClip({ ...clip, ...patch }); }
      },
      setLaneMuted: (role: AudioRole, muted: boolean) => handleSetAudioRoleMuted(role, muted),
      toggleNarrationClipMute: (id: string) => handleToggleNarrationClipMute(id),
      /** Render the project mix (same as MP4/WAV/M4A export) and return a 10 ms RMS envelope of channel 0. */
      renderAudioEnvelope: async () => {
        const buf = await renderProjectAudio(stateRef.current);
        if (!buf) return null;
        const ch = buf.getChannelData(0);
        const win = Math.round(buf.sampleRate / 100);
        const env: number[] = [];
        for (let i = 0; i < ch.length; i += win) {
          let sum = 0; const end = Math.min(ch.length, i + win);
          for (let j = i; j < end; j++) sum += ch[j] * ch[j];
          env.push(Math.sqrt(sum / Math.max(1, end - i)));
        }
        return { sampleRate: buf.sampleRate, duration: buf.duration, env };
      },
      loadWithEvents: async (blob: Blob, events: RecordingEvent[], durationHint?: number) => {
        await handleLoadProject(blob, 'E2E In-tab Recording', events, durationHint);
      },
      generateAutoZoom: () => handleAutoZoom(stateRef.current.recordingEvents),
      removeAutoZooms: () => handleRemoveAutoZooms(),
      setBackgroundFrame: (patch: any) => handleUpdateProjectSettings({ backgroundFrame: { ...stateRef.current.backgroundFrame, ...patch } } as any),
      /** Render one export-mode frame and sample RGBA at [x%, y%] points of the export canvas. */
      sampleExportFrame: async (t: number, points: [number, number][], width = 640, height = 360) => {
        const p = playerRef.current;
        if (!p?.renderExportFrameAt) return null;
        const c = await p.renderExportFrameAt(t, width, height);
        const ctx = c.getContext('2d')!;
        const out = points.map(([x, y]) => Array.from(ctx.getImageData(Math.min(c.width - 1, Math.round(x / 100 * c.width)), Math.min(c.height - 1, Math.round(y / 100 * c.height)), 1, 1).data));
        p.releaseExportCanvas?.();
        return { width: c.width, height: c.height, pixels: out };
      },
      /** Test seam: rebuild the main track as back-to-back clips covering the given source ranges (simulates trims). */
      setMainSourceRanges: (ranges: [number, number][]) => setState(prev => {
        const main = prev.clips.find(c => c.mediaType === 'main');
        if (!main) return prev;
        let offset = main.offset;
        const mains = ranges.map(([a, b], i) => { const c = { ...main, id: `${main.id}-r${i}`, sourceStart: a, sourceEnd: b, offset }; offset += (b - a) / (main.speed || 1); return c; });
        const clips = [...prev.clips.filter(c => c.mediaType !== 'main'), ...mains];
        return { ...prev, clips, duration: recalculateDuration(clips, prev.audioClips, prev.subtitles, prev.zoomEffects, prev.spotlightEffects, prev.mosaicEffects) };
      }),
      seek: (t: number) => handleSeek(t),
      uploadMainAsset: (blob: Blob, name = 'replacement.webm') => handleUploadAsset('main', new File([blob], name, { type: blob.type || 'video/webm' })),
      generateAutoSpotlight: () => handleAutoSpotlight(stateRef.current.recordingEvents),
      /** #27 test seams: inject a transcriber (object or worker-backed), shorten the timeout, undo. */
      setTranscriber,
      createWorkerTranscriber,
      createStubWorker,
      createWhisperTranscriber,
      ortWasmUrl: ortWasmAbsoluteUrl,
      whisperThreads: () => chooseWhisperThreads(currentThreadEnv()),
      setSubtitleGenerationTimeoutMs: (ms: number) => subtitleTools.setTimeoutMs(ms),
      updateSubtitle: (id: string, patch: Partial<Subtitle>) => {
        const sub = stateRef.current.subtitles.find(x => x.id === id);
        if (sub) { pushHistory(); handleUpdateSubtitle({ ...sub, ...patch }); }
      },
      undo: () => handleUndo(),
      redo: () => handleRedo(),
    };
    return () => { delete w.__FRAMECUT_E2E__; };
  }, [state.recordingEvents, state.zoomEffects, state.spotlightEffects, state.clickRipplesEnabled, state.backgroundFrame, state.clips, handleAutoSpotlight, setState, recalculateDuration, handleSeek, state.autoZoomEnabled, state.duration, state.mainVideo, handleLoadProject, handleAutoZoom, handleRemoveAutoZooms, state.mosaicEffects, state.subtitles, handleUploadAsset, state.currentTime, handleUpdateProjectSettings, stateRef, subtitleTools.setTimeoutMs, handleUndo, handleRedo, handleUpdateSubtitle, pushHistory, state.narration, state.narrationClips, state.mutedAudioRoles, state.isAudioTrackMuted, handleSplit, handleDelete, handleClipSpeedChange, handleUpdateClip, handleSetAudioRoleMuted, handleToggleNarrationClipMute]);

  const handleTogglePlay = useCallback(() => setState(prev => ({ ...prev, isPlaying: !prev.isPlaying })), [setState]);
  const handleSelect = useCallback((sel: any) => setState(prev => ({ ...prev, selection: sel })), [setState]);
  const handleStepFrame = useCallback((dir: -1 | 1) => handleSeek(Math.max(0, Math.min(stateRef.current.duration, stateRef.current.currentTime + (dir * (1/30))))), [handleSeek, stateRef]);
  const handleZoom = useCallback((dir: -1 | 1) => setState(prev => ({ ...prev, zoomLevel: Math.max(10, prev.zoomLevel + (dir * 10)) })), [setState]);
  const handleToggleAudioTrackMute = useCallback(() => handleSetAudioRoleMuted('music', !effectiveMutedRoles(stateRef.current).has('music')), [handleSetAudioRoleMuted, stateRef]);

  const handleScreenshot = useCallback(() => {
    if (playerRef.current) {
      const dataUrl = playerRef.current.captureFrame();
      if (dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `frame-${formatTimecode(stateRef.current.currentTime).replace(/:/g, '-')}.png`;
        a.click();
      }
    }
  }, [stateRef]);

  const handleCaptureCover = useCallback(() => {
    if (playerRef.current) {
      const dataUrl = playerRef.current.captureFrame();
      if (dataUrl) {
        handleSetCoverImage(dataUrl);
      }
    }
  }, [handleSetCoverImage]);

  const handleMainVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        handleUploadAsset('main', e.target.files[0]);
    }
    e.target.value = '';
  };

  // Show empty state if the timeline is empty (no clips) AND we are NOT recording.
  // If we ARE recording, we hide the empty state overlay so the user can interact with the app (generating events).
  const showEmptyState = (state.clips.length === 0 && state.audioClips.length === 0) && !isScreenRecording;

  // Selected item helpers
  const selectedZoomEffect = state.selection?.type === 'zoom' ? state.zoomEffects.find(z => z.id === state.selection!.id) : undefined;
  const selectedSpotlightEffect = state.selection?.type === 'spotlight' ? state.spotlightEffects.find(s => s.id === state.selection!.id) : undefined;
  const selectedMosaicEffect = state.selection?.type === 'mosaic' ? state.mosaicEffects.find(m => m.id === state.selection!.id) : undefined;

  return (
    <div className="flex h-screen w-screen bg-black text-white overflow-hidden font-sans">
      {/* Hidden elements for PiP functionality */}
      <canvas ref={pipCanvasRef} className="hidden" />
      <video ref={pipVideoRef} className="hidden" muted />

      {state.showDebug && <DebugPanel state={state} videoTime={videoCtx.time} />}
      
      {/* Floating Recording Bar (Visible during recording) */}
      {isScreenRecording && showFloatingBar && (
          <RecordingBar 
              duration={recordingDuration}
              markersCount={recordingMarkersCount}
              capturedEventsCount={capturedEventsCount}
              isPiPActive={isPiPActive}
              onMarker={handleMarker}
              onStop={handleStopScreenRecording}
              onTogglePiP={handleTogglePiP}
              onClose={() => setShowFloatingBar(false)}
          />
      )}

      <Sidebar intro={state.intro} mainVideo={state.mainVideo} outro={state.outro} onUpload={handleUploadAsset} onImportUrl={handleUrlImport} onRemove={handleRemoveAsset} onSetColor={handleSetColorAsset} />

      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Top Header Bar - Z-Index bumped to 60 to sit above EmptyState (50) */}
        <header className="h-14 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0 z-[60] relative">
            <div className="flex items-center gap-3">
                <div className="font-semibold text-lg tracking-tight text-zinc-100 flex items-center gap-2">
                    FrameCut <span className="text-zinc-600 font-normal text-xs border border-zinc-800 px-1.5 py-0.5 rounded">Beta</span>
                </div>
                <a
                    href="/download/mac"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/20 hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    aria-label="Download FrameCut for macOS"
                    title="Download FrameCut for macOS 26 on Apple silicon"
                >
                    <Download size={15} aria-hidden="true" />
                    <span>Download for macOS</span>
                </a>
            </div>
            
            <HeaderControls 
                hasClips={state.clips.length > 0 || state.audioClips.length > 0} 
                coverImage={state.coverImage} 
                isSaving={isSaving}
                lastSaved={lastSaved}
                onCaptureCover={handleCaptureCover} 
                onSetCover={handleSetCoverImage} 
                onExport={handleExportAction}
                onExportProject={handleExportProject}
                onOpenExportSettings={(format) => setExportSettingsFormat(format ?? 'mp4')}
                onImportProject={handleImportProject}
                onResetProject={handleResetProject}
                onManualSave={saveProject}
            />
        </header>

        <div className="flex-1 flex min-h-0 relative bg-zinc-950">
          {/* Middle Section: Player (Full Width now) */}
          <div className="flex-1 flex items-center justify-center p-4 bg-zinc-950 relative">
            <Player
                ref={playerRef}
                src={videoCtx.src}
                introSrc={state.intro?.src}
                mainSrc={state.mainVideo?.src}
                outroSrc={state.outro?.src}
                currentTimeRef={currentTimeRef} 
                currentTime={state.currentTime}
                isMuted={videoCtx.muted || mutedRoles.has('system')}
                corsCompatible={videoCtx.corsCompatible}
                audioSrc={audioCtx.src}
                narrationSrc={state.narration?.src ?? null}
                narrationClips={state.narrationClips ?? []}
                narrationTimeOffset={state.narration?.timeOffset ?? 0}
                isNarrationMuted={mutedRoles.has('narration')}
                audioPlaybackRate={audioCtx.playbackRate}
                allSubtitles={state.subtitles} 
                selectedSubtitleId={state.selection?.type === 'subtitle' ? state.selection.id : null}
                
                // Pass FULL lists instead of calculating 'active' props
                zoomEffects={state.zoomEffects}
                spotlightEffects={state.spotlightEffects}
                mosaicEffects={state.mosaicEffects}
                recordingEvents={state.recordingEvents}
                clickRipplesEnabled={state.clickRipplesEnabled !== false}
                
                selectedZoomEffect={selectedZoomEffect || null}
                selectedSpotlightEffect={selectedSpotlightEffect || null}
                selectedMosaicEffect={selectedMosaicEffect || null}
                isPlaying={state.isPlaying}
                playbackRate={state.playbackRate}
                currentBrushSize={state.currentBrushSize}
                onDurationChange={() => { }}
                onEnded={() => setState(prev => ({ ...prev, isPlaying: false }))}
                onUpdateSubtitle={handleUpdateSubtitle}
                onUpdateZoomEffect={handleUpdateZoomEffect}
                onUpdateSpotlightEffect={handleUpdateSpotlightEffect}
                onUpdateMosaicEffect={handleUpdateMosaicEffect}
                onSelectSubtitle={(id) => handleSelect(id ? { type: 'subtitle', id } : null)}
                onSelectZoomEffect={(id) => handleSelect({ type: 'zoom', id })}
                onSelectSpotlightEffect={(id) => handleSelect({ type: 'spotlight', id })}
                onSelectMosaicEffect={(id) => handleSelect({ type: 'mosaic', id })}
                onTogglePlay={handleTogglePlay}
                onInteractionStart={pushHistory}
                isAudioTrackMuted={state.isAudioTrackMuted}
                coverImage={state.coverImage}
                onAutoCover={handleSetCoverImage}
                isExporting={state.isExporting} 
                
                activeClipId={state.selection?.type === 'crop' ? state.selection.id : undefined}
                isEditingCrop={state.selection?.type === 'crop'}
                onUpdateClip={handleUpdateClip}
                onConfirmCrop={handleCrop}
                activeClips={state.clips}
                audioClips={state.audioClips} 
                onPreviewHover={handlePreviewHover}
                onPreviewLeave={handlePreviewLeave}
                
                // Project Settings
                aspectRatio={state.aspectRatio}
                canvasBackgroundColor={state.canvasBackgroundColor}
                backgroundFrame={state.backgroundFrame}
                projectName={state.fileName}
                onUpdateProjectSettings={handleUpdateProjectSettings}
                onMosaicBrushSizeChange={handleMosaicBrushSizeChange}
            />
          </div>

          {showEmptyState && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-50">
              <div className="text-center max-w-md p-6 w-full">
                  <div className="animate-in fade-in slide-in-from-bottom-5 duration-500 flex flex-col items-center">
                    <h1 className="text-4xl font-bold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 tracking-tight">FrameCut</h1>
                    
                    <div className="flex flex-col gap-4 w-full max-w-xs">
                        <RecordingSetup
                            mics={recordingDevices.mics}
                            cameras={recordingDevices.cameras}
                            micId={recordingDevices.micId}
                            cameraId={recordingDevices.cameraId}
                            micError={recordingDevices.micError}
                            cameraError={recordingDevices.cameraError}
                            micLevel={recordingDevices.micLevel}
                            cameraStream={recordingDevices.cameraStream}
                            locked={isScreenRecording}
                            onSelectMic={recordingDevices.selectMic}
                            onSelectCamera={recordingDevices.selectCamera}
                        />
                        <button onClick={startRecordingWithSetup} className="group relative flex items-center justify-center gap-3 px-6 py-4 bg-white text-black rounded-xl hover:bg-zinc-200 transition-all font-bold shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:scale-[1.02]">
                            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-colors">
                                <Circle size={14} className="fill-red-500 text-red-500 animate-pulse" />
                            </div>
                            Start Recording
                        </button>
                        
                        <div className="relative flex items-center py-2 opacity-50">
                            <div className="flex-grow border-t border-zinc-800"></div>
                            <span className="flex-shrink-0 mx-4 text-zinc-600 text-xs font-medium uppercase tracking-wider">Or</span>
                            <div className="flex-grow border-t border-zinc-800"></div>
                        </div>

                        <button onClick={() => fileInputRef.current?.click()} className="group flex items-center justify-center gap-3 px-6 py-4 bg-zinc-800 text-zinc-200 rounded-xl hover:bg-zinc-700 transition-all font-semibold border border-zinc-700 hover:border-zinc-700 hover:scale-[1.02]">
                            <Upload size={20} className="text-blue-400" />
                            Upload Video
                        </button>
                    </div>
                    <p className="mt-8 text-zinc-600 text-xs">Drag & drop files or paste URL in sidebar</p>
                  </div>
              </div>
            </div>
          )}
          <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={handleMainVideoUpload} />
        </div>

        <Toolbar
          isPlaying={state.isPlaying}
          selection={state.selection}
          hasVideo={!!state.mainVideo || !!state.intro || !!state.outro}
          isPolishing={state.isPolishing}
          currentTimeRef={currentTimeRef} 
          onPlayPause={handleTogglePlay}
          onStepFrame={handleStepFrame}
          onZoom={handleZoom}
          onSplit={handleSplit}
          onCrop={handleCrop}
          onMagicPolish={() => handleMagicPolish(state.mainVideo, state.recordingEvents)}
          onAutoZoom={() => handleAutoZoom(state.recordingEvents)}
          onRemoveAutoZooms={handleRemoveAutoZooms}
          autoZoomEnabled={state.autoZoomEnabled !== false}
          onToggleAutoZoom={handleSetAutoZoomEnabled}
          autoZoomSensitivity={state.autoZoomSensitivity ?? 0.5}
          onAutoZoomSensitivity={handleSetAutoZoomSensitivity}
          hasRecordingEvents={state.recordingEvents.some(e => e.type === 'click')}
          clickRipplesEnabled={state.clickRipplesEnabled !== false}
          onToggleClickRipples={handleSetClickRipplesEnabled}
          onAutoSpotlight={() => handleAutoSpotlight(state.recordingEvents)}
          onDelete={handleDelete}
          onDetachAudio={handleDetachAudio}
          onToggleDebug={handleToggleDebug}
          showDebug={state.showDebug}
          onScreenshot={handleScreenshot}
          subtitleTools={
            <SubtitleTools
              hasVideo={!!state.mainVideo}
              hasSubtitles={state.subtitles.length > 0}
              available={subtitleTools.availability.available}
              unavailableReason={'reason' in subtitleTools.availability ? subtitleTools.availability.reason : undefined}
              status={subtitleTools.status}
              onGenerate={() => subtitleTools.generate()}
              onConfirmDownload={() => subtitleTools.generate({ confirmed: true })}
              onCancel={subtitleTools.cancel}
              onImport={subtitleTools.importFile}
              onExport={subtitleTools.exportFile}
              onDismiss={subtitleTools.dismiss}
              model={subtitleTools.model}
              onModelChange={subtitleTools.setModel}
              modelSizes={subtitleTools.modelSizes}
            />
          }
        />

        <div className="h-72 border-t border-zinc-800 bg-zinc-900 shrink-0">
          <Timeline
            duration={state.duration}
            currentTimeRef={currentTimeRef} 
            zoomLevel={state.zoomLevel}
            intro={state.intro}
            outro={state.outro}
            mainVideo={state.mainVideo}
            audio={state.audio}
            clips={state.clips}
            audioClips={state.audioClips}
            subtitles={state.subtitles}
            zoomEffects={state.zoomEffects}
            spotlightEffects={state.spotlightEffects}
            mosaicEffects={state.mosaicEffects}
            selection={state.selection}
            isPlaying={state.isPlaying}
            onSeek={handleSeek}
            onTogglePlay={handleTogglePlay}
            onSelect={handleSelect}
            onUpdateClip={handleUpdateClip}
            onUpdateSubtitle={handleUpdateSubtitle}
            onUpdateZoomEffect={handleUpdateZoomEffect}
            onUpdateSpotlightEffect={handleUpdateSpotlightEffect}
            onUpdateMosaicEffect={handleUpdateMosaicEffect}
            onAddSubtitle={handleAddSubtitle}
            onAddZoom={handleAddZoom}
            onAddSpotlight={handleAddSpotlight}
            onAddMosaic={handleAddMosaic}
            onInteractionStart={pushHistory}
            isAudioTrackMuted={mutedRoles.has('music')}
            onToggleAudioTrackMute={handleToggleAudioTrackMute}
            narration={state.narration ?? null}
            narrationClips={state.narrationClips ?? []}
            mutedAudioRoles={[...mutedRoles]}
            onSetAudioRoleMuted={handleSetAudioRoleMuted}
            onToggleNarrationClipMute={handleToggleNarrationClipMute}
            onPreviewTime={handlePreviewTime} // New Prop
          />
        </div>
      </div>
      {notice && <div role="status" data-testid="recording-notice" className="fixed bottom-24 right-8 max-w-sm bg-amber-950/95 border border-amber-700 text-amber-100 px-4 py-3 rounded-lg shadow-2xl text-sm z-[200]">{notice}<button className="ml-3 text-amber-300 hover:text-white" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
      {state.showSuccessToast && <div className="fixed bottom-8 right-8 bg-zinc-900 border border-zinc-800 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 z-50"><CheckCircle className="text-emerald-500" size={20} /><div><h4 className="font-semibold text-sm">{state.toastMessage || "Export Complete!"}</h4></div></div>}
      {isResetting && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[9999] flex items-center justify-center flex-col gap-6 animate-in fade-in duration-300">
            <Loader2 size={48} className="animate-spin text-red-500" />
            <h2 className="text-xl font-bold text-white tracking-wide">Cleaning Project Data...</h2>
        </div>
      )}
      <ExportModal
        isExporting={state.isExporting}
        progress={state.exportProgress}
        showSettings={exportSettingsFormat !== null}
        initialFormat={exportSettingsFormat ?? 'mp4'}
        aspectRatio={state.aspectRatio}
        projectDuration={state.duration}
        canvasSize={(() => { const c = playerRef.current?.getCanvas(); return c ? { width: c.width, height: c.height } : { width: 1920, height: 1080 }; })()}
        onCloseSettings={() => setExportSettingsFormat(null)}
        onConfirmExport={handleConfirmExport}
      />
      <GifWebLimitPrompt info={gifWebLimit} onClose={dismissGifWebLimit} />
    </div>
  );
};

export default App;
