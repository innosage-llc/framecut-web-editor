
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Circle, StopCircle, CheckCircle, MousePointer2, Upload, Loader2 } from 'lucide-react';
import Player from './components/Player';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import { DebugPanel } from './components/DebugPanel';
import RecordingBar from './components/RecordingBar';
import ExportModal from './components/ExportModal';
import HeaderControls from './components/HeaderControls';
import { formatTimecode, formatTimeShort } from './utils';
import { useEditor } from './hooks/useEditor';
import { useScreenRecorder } from './hooks/useScreenRecorder';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAssetOperations } from './hooks/useAssetOperations';
import { usePlaybackContext } from './hooks/usePlaybackContext';
import { useExport } from './hooks/useExport';
import { useProjectPersistence } from './hooks/useProjectPersistence';
import { PlayerRef, Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, Clip } from './types';

const App: React.FC = () => {
  const {
    state, setState, stateRef, pushHistory, handleUndo, handleRedo,
    recalculateDuration, handleDelete, handleSplit, handleCrop, handleUpdateClip,
    handleUpdateSubtitle, handleUpdateZoomEffect, handleUpdateSpotlightEffect,
    handleUpdateMosaicEffect, handleDetachAudio, handleAddSubtitle,
    handleAddZoom, handleAddSpotlight, handleAddMosaic, handleZoomScaleChange,
    handleMosaicBrushSizeChange, handleClipSpeedChange, handleToggleDebug,
    handleSeek, handleSetCoverImage, handleUpdateProjectSettings, currentTimeRef
  } = useEditor();

  const playerRef = useRef<PlayerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track mouse hover over the preview player to target Zoom effects
  const previewHoverRef = useRef<{x: number, y: number} | null>(null);

  const { handleLoadProject, handleMagicPolish, handleUrlImport, handleUploadAsset, handleSetColorAsset, handleRemoveAsset } = useAssetOperations({ setState, pushHistory, recalculateDuration, currentTimeRef });
  const { videoCtx, audioCtx } = usePlaybackContext({ state });
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
  } = useScreenRecorder({ onRecordingComplete: handleLoadProject });
  
  const { handleExportAction } = useExport({ state, setState, playerRef, currentTimeRef });

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

  useKeyboardShortcuts({ onDelete: handleDelete, onUndo: handleUndo, onRedo: handleRedo, onToggleDebug: handleToggleDebug, onAddZoom: handleAddZoomWrapper });

  useEffect(() => {
    document.title = isScreenRecording ? `${formatTimeShort(recordingDuration)} • Recording` : "FrameCut Web Editor";
  }, [isScreenRecording, recordingDuration]);

  const handleTogglePlay = useCallback(() => setState(prev => ({ ...prev, isPlaying: !prev.isPlaying })), [setState]);
  const handleSelect = useCallback((sel: any) => setState(prev => ({ ...prev, selection: sel })), [setState]);
  const handleStepFrame = useCallback((dir: -1 | 1) => handleSeek(Math.max(0, Math.min(stateRef.current.duration, stateRef.current.currentTime + (dir * (1/30))))), [handleSeek, stateRef]);
  const handleZoom = useCallback((dir: -1 | 1) => setState(prev => ({ ...prev, zoomLevel: Math.max(10, prev.zoomLevel + (dir * 10)) })), [setState]);
  const handleToggleAudioTrackMute = useCallback(() => { pushHistory(); setState(prev => ({ ...prev, isAudioTrackMuted: !prev.isAudioTrackMuted })); }, [pushHistory, setState]);

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
            <div className="font-semibold text-lg tracking-tight text-zinc-100 flex items-center gap-2">
                FrameCut <span className="text-zinc-600 font-normal text-xs border border-zinc-800 px-1.5 py-0.5 rounded">Beta</span>
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
                isMuted={videoCtx.muted}
                corsCompatible={videoCtx.corsCompatible}
                audioSrc={audioCtx.src}
                audioPlaybackRate={audioCtx.playbackRate}
                allSubtitles={state.subtitles} 
                selectedSubtitleId={state.selection?.type === 'subtitle' ? state.selection.id : null}
                
                // Pass FULL lists instead of calculating 'active' props
                zoomEffects={state.zoomEffects}
                spotlightEffects={state.spotlightEffects}
                mosaicEffects={state.mosaicEffects}
                
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
                        <button onClick={handleStartScreenRecording} className="group relative flex items-center justify-center gap-3 px-6 py-4 bg-white text-black rounded-xl hover:bg-zinc-200 transition-all font-bold shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] hover:scale-[1.02]">
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
          onDelete={handleDelete}
          onDetachAudio={handleDetachAudio}
          onToggleDebug={handleToggleDebug}
          showDebug={state.showDebug}
          onScreenshot={handleScreenshot}
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
            isAudioTrackMuted={state.isAudioTrackMuted}
            onToggleAudioTrackMute={handleToggleAudioTrackMute}
            onPreviewTime={handlePreviewTime} // New Prop
          />
        </div>
      </div>
      {state.showSuccessToast && <div className="fixed bottom-8 right-8 bg-zinc-900 border border-zinc-800 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 z-50"><CheckCircle className="text-emerald-500" size={20} /><div><h4 className="font-semibold text-sm">{state.toastMessage || "Export Complete!"}</h4></div></div>}
      {isResetting && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[9999] flex items-center justify-center flex-col gap-6 animate-in fade-in duration-300">
            <Loader2 size={48} className="animate-spin text-red-500" />
            <h2 className="text-xl font-bold text-white tracking-wide">Cleaning Project Data...</h2>
        </div>
      )}
      <ExportModal isExporting={state.isExporting} progress={state.exportProgress} />
    </div>
  );
};

export default App;
