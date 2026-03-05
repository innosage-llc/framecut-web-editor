
import { Subtitle, ZoomEffect, SpotlightEffect, MosaicEffect, MosaicPath } from '../types';

// Easing functions for smooth animation
const easeInOutCubic = (t: number): number => {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const lerp = (start: number, end: number, t: number) => {
  return start + (end - start) * t;
};

// Helper to calculate zoom rect at a specific time
export const calculateZoomRect = (zoom: ZoomEffect, currentTime: number) => {
    const duration = zoom.end - zoom.start;
    const transitionDuration = Math.min(1.0, duration / 2); 
    
    if (currentTime < zoom.start || currentTime > zoom.end) {
        return { x: 0, y: 0, width: 100, height: 100, isTransitioning: false };
    }

    const localTime = currentTime - zoom.start;

    // 1. Entry Phase (Zoom In)
    if (localTime < transitionDuration) {
        const t = Math.max(0, Math.min(1, easeInOutCubic(localTime / transitionDuration)));
        return {
            x: lerp(0, zoom.x, t),
            y: lerp(0, zoom.y, t),
            width: lerp(100, zoom.width, t),
            height: lerp(100, zoom.height, t),
            isTransitioning: true
        };
    } 
    
    // 2. Exit Phase (Zoom Out)
    if (localTime > (duration - transitionDuration)) {
         const exitElapsed = localTime - (duration - transitionDuration);
         const t = Math.max(0, Math.min(1, easeInOutCubic(exitElapsed / transitionDuration)));
         return {
             x: lerp(zoom.x, 0, t),
             y: lerp(zoom.y, 0, t),
             width: lerp(zoom.width, 100, t),
             height: lerp(zoom.height, 100, t),
             isTransitioning: true
         };
    }

    // 3. Static Zoomed State (Hold)
    return {
        x: zoom.x,
        y: zoom.y,
        width: zoom.width,
        height: zoom.height,
        isTransitioning: false
    };
};

export interface RenderCropInfo {
    shouldCrop: boolean;
    // Source Crop in Percentages (0-100)
    sourceX: number;
    sourceY: number;
    sourceW: number;
    sourceH: number;
    // Destination Rect in Canvas Pixels (Letterboxed)
    destX: number;
    destY: number;
    destW: number;
    destH: number;
}

export const renderVideoFrame = (
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement | HTMLImageElement,
    canvasWidth: number,
    canvasHeight: number,
    zoom: ZoomEffect | undefined,
    crop: { x: number, y: number, width: number, height: number } | undefined,
    playing: boolean,
    selectedZoom: ZoomEffect | null,
    isEditingCrop: boolean,
    currentGlobalTime: number,
    activeClipTiming: { offset: number; sourceStart: number; speed: number } | null | undefined
): RenderCropInfo | null => {
    
    const shouldCrop = isEditingCrop ? false : !!(crop || (zoom && (playing || !selectedZoom)));
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = playing ? 'low' : 'high';
    
    // Abstract dimensions based on element type
    const mediaWidth = (video as HTMLVideoElement).videoWidth || (video as HTMLImageElement).naturalWidth || 0;
    const mediaHeight = (video as HTMLVideoElement).videoHeight || (video as HTMLImageElement).naturalHeight || 0;

    if (mediaWidth === 0 || mediaHeight === 0) return null;

    let finalRect = { x: 0, y: 0, width: 100, height: 100 };
    // Destination is ALWAYS full canvas to ensure we zoom/scale to fill, rather than resizing container
    let destRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };

    if (shouldCrop) {
       const baseCrop = crop || { x: 0, y: 0, width: 100, height: 100 };
       let zoomRect = { x: 0, y: 0, width: 100, height: 100 };
       
       if (zoom) {
           zoomRect = { x: zoom.x, y: zoom.y, width: zoom.width, height: zoom.height };
           let effectiveTime = currentGlobalTime;
           
           // Only calculate animation for Video elements (which have a currentTime property)
           // For images, we just use currentGlobalTime relative to clip
           if (video instanceof HTMLVideoElement && playing && !video.paused && !video.ended && activeClipTiming) {
                effectiveTime = ((video.currentTime - activeClipTiming.sourceStart) / activeClipTiming.speed) + activeClipTiming.offset;
           }
           if (effectiveTime != null) {
               const calculated = calculateZoomRect(zoom, effectiveTime);
               zoomRect = { x: calculated.x, y: calculated.y, width: calculated.width, height: calculated.height };
           }
       }

       finalRect.x = baseCrop.x + (zoomRect.x / 100) * baseCrop.width;
       finalRect.y = baseCrop.y + (zoomRect.y / 100) * baseCrop.height;
       finalRect.width = (zoomRect.width / 100) * baseCrop.width;
       finalRect.height = (zoomRect.height / 100) * baseCrop.height;

       const reqSx = (finalRect.x / 100) * mediaWidth;
       const reqSy = (finalRect.y / 100) * mediaHeight;
       const reqSw = (finalRect.width / 100) * mediaWidth;
       const reqSh = (finalRect.height / 100) * mediaHeight;

       const validSx = Math.max(0, reqSx);
       const validSy = Math.max(0, reqSy);
       const validRight = Math.min(mediaWidth, reqSx + reqSw);
       const validBottom = Math.min(mediaHeight, reqSy + reqSh);
       
       const validSw = validRight - validSx;
       const validSh = validBottom - validSy;

       if (validSw > 0 && validSh > 0) {
           const scaleX = destRect.width / reqSw;
           const scaleY = destRect.height / reqSh;
           const diffX = validSx - reqSx;
           const diffY = validSy - reqSy;
           const drawX = destRect.x + (diffX * scaleX);
           const drawY = destRect.y + (diffY * scaleY);
           const drawW = validSw * scaleX;
           const drawH = validSh * scaleY;

           try {
               ctx.drawImage(video, validSx, validSy, validSw, validSh, drawX, drawY, drawW, drawH);
           } catch(e) {
               console.warn("Frame render error", e);
           }
       }

    } else {
       // --- DEFAULT FILL MODE ---
       // Calculate "Cover" fit
       const scaleX = canvasWidth / mediaWidth;
       const scaleY = canvasHeight / mediaHeight;
       const scale = Math.max(scaleX, scaleY);
       
       const drawW = mediaWidth * scale;
       const drawH = mediaHeight * scale;
       const drawX = (canvasWidth - drawW) / 2;
       const drawY = (canvasHeight - drawH) / 2;

       try {
           ctx.drawImage(video, drawX, drawY, drawW, drawH);
       } catch(e) {}

       if (zoom && !playing && selectedZoom && selectedZoom.id === zoom.id) {
           const zx = (zoom.x / 100) * canvasWidth;
           const zy = (zoom.y / 100) * canvasHeight;
           const zw = (zoom.width / 100) * canvasWidth;
           const zh = (zoom.height / 100) * canvasHeight;

           ctx.save();
           ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
           ctx.beginPath();
           ctx.rect(0, 0, canvasWidth, canvasHeight);
           ctx.rect(zx, zy, zw, zh);
           ctx.fill('evenodd');
           ctx.restore();
       }

       if (isEditingCrop && crop) {
           const cx = (crop.x / 100) * canvasWidth;
           const cy = (crop.y / 100) * canvasHeight;
           const cw = (crop.width / 100) * canvasWidth;
           const ch = (crop.height / 100) * canvasHeight;

           ctx.save();
           ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
           ctx.beginPath();
           ctx.rect(0, 0, canvasWidth, canvasHeight);
           ctx.rect(cx, cy, cw, ch);
           ctx.fill('evenodd');
           ctx.restore();
       }
    }

    return shouldCrop ? { 
        shouldCrop: true, 
        sourceX: finalRect.x, 
        sourceY: finalRect.y, 
        sourceW: finalRect.width, 
        sourceH: finalRect.height,
        destX: destRect.x,
        destY: destRect.y,
        destW: destRect.width,
        destH: destRect.height
    } : null;
};

export const renderMosaic = (
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement | HTMLImageElement | null,
    mosaic: MosaicEffect,
    pixelCanvas: HTMLCanvasElement,
    maskCanvas: HTMLCanvasElement,
    canvasWidth: number,
    canvasHeight: number,
    cropInfo: RenderCropInfo | null,
    playing: boolean,
    bgColor?: string
) => {
    // Mode Check: 'box' vs 'path'
    // Default to 'path' if undefined for backward compatibility
    const mode = mosaic.mode || 'path';
    
    // Abstract dimensions
    let mediaWidth = 0;
    let mediaHeight = 0;
    if (video) {
        mediaWidth = (video as HTMLVideoElement).videoWidth || (video as HTMLImageElement).naturalWidth || 0;
        mediaHeight = (video as HTMLVideoElement).videoHeight || (video as HTMLImageElement).naturalHeight || 0;
    }

    if (mode === 'path') {
        if (mosaic.paths.length === 0) return;

        const scaleFactor = 0.25; 
        const wScaled = Math.floor(Math.max(1, canvasWidth * scaleFactor));
        const hScaled = Math.floor(Math.max(1, canvasHeight * scaleFactor));

        pixelCanvas.width = wScaled;
        pixelCanvas.height = hScaled;
        const pCtx = pixelCanvas.getContext('2d');
        if (!pCtx) return;

        pCtx.filter = 'blur(8px)';

        try {
            if (video && mediaWidth > 0) {
                if (cropInfo && cropInfo.shouldCrop) {
                   const reqSx = (cropInfo.sourceX / 100) * mediaWidth;
                   const reqSy = (cropInfo.sourceY / 100) * mediaHeight;
                   const reqSw = (cropInfo.sourceW / 100) * mediaWidth;
                   const reqSh = (cropInfo.sourceH / 100) * mediaHeight;

                   const validSx = Math.max(0, reqSx);
                   const validSy = Math.max(0, reqSy);
                   const validRight = Math.min(mediaWidth, reqSx + reqSw);
                   const validBottom = Math.min(mediaHeight, reqSy + reqSh);
                   
                   const validSw = validRight - validSx;
                   const validSh = validBottom - validSy;

                   if (validSw > 0 && validSh > 0) {
                       const destScaleX = wScaled / canvasWidth;
                       const destScaleY = hScaled / canvasHeight;
                       
                       const effectiveDestX = cropInfo.destX * destScaleX;
                       const effectiveDestY = cropInfo.destY * destScaleY;
                       const effectiveDestW = cropInfo.destW * destScaleX;
                       const effectiveDestH = cropInfo.destH * destScaleY;

                       const scaleX = effectiveDestW / reqSw;
                       const scaleY = effectiveDestH / reqSh;
                       const diffX = validSx - reqSx;
                       const diffY = validSy - reqSy;
                       
                       const drawX = effectiveDestX + (diffX * scaleX);
                       const drawY = effectiveDestY + (diffY * scaleY);
                       const drawW = validSw * scaleX;
                       const drawH = validSh * scaleY;

                       pCtx.drawImage(video, validSx, validSy, validSw, validSh, drawX, drawY, drawW, drawH);
                   }
                } else {
                   // Fill Mode logic for mosaic pass
                   const scaleX = wScaled / mediaWidth;
                   const scaleY = hScaled / mediaHeight;
                   const scale = Math.max(scaleX, scaleY);
                   const drawW = mediaWidth * scale;
                   const drawH = mediaHeight * scale;
                   const drawX = (wScaled - drawW) / 2;
                   const drawY = (hScaled - drawH) / 2;
                   
                   pCtx.drawImage(video, drawX, drawY, drawW, drawH);
                }
            } else if (bgColor) {
                pCtx.fillStyle = bgColor;
                pCtx.fillRect(0, 0, wScaled, hScaled);
            }
        } catch(e) { return; }
        
        pCtx.filter = 'none';

        maskCanvas.width = wScaled;
        maskCanvas.height = hScaled;
        const mCtx = maskCanvas.getContext('2d');
        if (!mCtx) return;

        mCtx.lineCap = 'round';
        mCtx.lineJoin = 'round';
        mCtx.fillStyle = 'white';
        mCtx.strokeStyle = 'white';
        mCtx.shadowBlur = 10 * scaleFactor; 
        mCtx.shadowColor = 'white';

        mosaic.paths.forEach(path => {
          if (path.points.length === 0) return;
          let brushPx = (path.brushSize / 100) * Math.min(wScaled, hScaled);
          if (cropInfo && cropInfo.shouldCrop) {
              const zoomFactor = 100 / cropInfo.sourceW;
              brushPx *= zoomFactor;
          }
          mCtx.lineWidth = brushPx;
          mCtx.beginPath();
          path.points.forEach((pt, i) => {
             let x = pt.x;
             let y = pt.y;
             if (cropInfo && cropInfo.shouldCrop) {
                 x = (x - cropInfo.sourceX) / cropInfo.sourceW * 100;
                 y = (y - cropInfo.sourceY) / cropInfo.sourceH * 100;
                 const destScaleX = wScaled / canvasWidth;
                 const destScaleY = hScaled / canvasHeight;
                 const effectiveDestX = cropInfo.destX * destScaleX;
                 const effectiveDestY = cropInfo.destY * destScaleY;
                 const effectiveDestW = cropInfo.destW * destScaleX;
                 const effectiveDestH = cropInfo.destH * destScaleY;
                 x = (effectiveDestX / wScaled * 100) + (x * (effectiveDestW / wScaled));
                 y = (effectiveDestY / hScaled * 100) + (y * (effectiveDestH / hScaled));
             }
             const cx = (x / 100) * wScaled;
             const cy = (y / 100) * hScaled;
             if (i === 0) mCtx.moveTo(cx, cy); else mCtx.lineTo(cx, cy);
          });
          if (path.points.length === 1) {
             let x = path.points[0].x;
             let y = path.points[0].y;
             if (cropInfo && cropInfo.shouldCrop) {
                 x = (x - cropInfo.sourceX) / cropInfo.sourceW * 100;
                 y = (y - cropInfo.sourceY) / cropInfo.sourceH * 100;
                 const destScaleX = wScaled / canvasWidth;
                 const destScaleY = hScaled / canvasHeight;
                 const effectiveDestX = cropInfo.destX * destScaleX;
                 const effectiveDestY = cropInfo.destY * destScaleY;
                 const effectiveDestW = cropInfo.destW * destScaleX;
                 const effectiveDestH = cropInfo.destH * destScaleY;
                 x = (effectiveDestX / wScaled * 100) + (x * (effectiveDestW / wScaled));
                 y = (effectiveDestY / hScaled * 100) + (y * (effectiveDestH / hScaled));
             }
             const cx = (x / 100) * wScaled;
             const cy = (y / 100) * hScaled;
             mCtx.moveTo(cx, cy);
             mCtx.lineTo(cx, cy);
          }
          mCtx.stroke();
        });

        pCtx.globalCompositeOperation = 'destination-in';
        pCtx.drawImage(maskCanvas, 0, 0);
        pCtx.globalCompositeOperation = 'source-over'; 
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(pixelCanvas, 0, 0, wScaled, hScaled, 0, 0, canvasWidth, canvasHeight);
        ctx.imageSmoothingQuality = playing ? 'low' : 'high';
    
    } else if (mode === 'box') {
        // --- BOX MODE (Rectangle/Circle) ---
        let mx = mosaic.x ?? 0;
        let my = mosaic.y ?? 0;
        let mw = mosaic.width ?? 30;
        let mh = mosaic.height ?? 30;
        const blurAmount = mosaic.blurAmount ?? 10;
        const shape = mosaic.shape || 'rectangle';

        // 1. Transform Coords if Cropped
        if (cropInfo && cropInfo.shouldCrop) {
            mx = (mx - cropInfo.sourceX) / cropInfo.sourceW * 100;
            my = (my - cropInfo.sourceY) / cropInfo.sourceH * 100;
            mw = (mw / cropInfo.sourceW) * 100;
            mh = (mh / cropInfo.sourceH) * 100;
            const destXPct = (cropInfo.destX / canvasWidth) * 100;
            const destYPct = (cropInfo.destY / canvasHeight) * 100;
            const destWPct = (cropInfo.destW / canvasWidth) * 100;
            const destHPct = (cropInfo.destH / canvasHeight) * 100;
            mx = destXPct + (mx / 100 * destWPct);
            my = destYPct + (my / 100 * destHPct);
            mw = (mw / 100) * destWPct;
            mh = (mh / 100) * destHPct;
        }

        const dx = (mx / 100) * canvasWidth;
        const dy = (my / 100) * canvasHeight;
        const dw = (mw / 100) * canvasWidth;
        const dh = (mh / 100) * canvasHeight;

        // 2. Prepare Blur
        ctx.save();
        ctx.beginPath();
        if (shape === 'rectangle') {
            ctx.rect(dx, dy, dw, dh);
        } else {
            const cx = dx + dw/2;
            const cy = dy + dh/2;
            ctx.ellipse(cx, cy, dw/2, dh/2, 0, 0, 2 * Math.PI);
        }
        ctx.clip();
        
        // 3. Draw Blurred Content
        ctx.filter = `blur(${blurAmount}px)`;
        
        if (video && mediaWidth > 0) {
             if (cropInfo && cropInfo.shouldCrop) {
                 const reqSx = (cropInfo.sourceX / 100) * mediaWidth;
                 const reqSy = (cropInfo.sourceY / 100) * mediaHeight;
                 const reqSw = (cropInfo.sourceW / 100) * mediaWidth;
                 const reqSh = (cropInfo.sourceH / 100) * mediaHeight;
                 
                 const validSx = Math.max(0, reqSx);
                 const validSy = Math.max(0, reqSy);
                 const validRight = Math.min(mediaWidth, reqSx + reqSw);
                 const validBottom = Math.min(mediaHeight, reqSy + reqSh);
                 const validSw = validRight - validSx;
                 const validSh = validBottom - validSy;
                 if(validSw > 0 && validSh > 0) {
                     const drawX = cropInfo.destX + (validSx - reqSx) * (cropInfo.destW / reqSw);
                     const drawY = cropInfo.destY + (validSy - reqSy) * (cropInfo.destH / reqSh);
                     const drawW = validSw * (cropInfo.destW / reqSw);
                     const drawH = validSh * (cropInfo.destH / reqSh);
                     
                     ctx.drawImage(video, validSx, validSy, validSw, validSh, drawX, drawY, drawW, drawH);
                 }
             } else {
                 // Box Blur Fill Mode
                 const scaleX = canvasWidth / mediaWidth;
                 const scaleY = canvasHeight / mediaHeight;
                 const scale = Math.max(scaleX, scaleY);
                 const drawW = mediaWidth * scale;
                 const drawH = mediaHeight * scale;
                 const drawX = (canvasWidth - drawW) / 2;
                 const drawY = (canvasHeight - drawH) / 2;
                 ctx.drawImage(video, drawX, drawY, drawW, drawH);
             }
        } else if (bgColor) {
             ctx.fillStyle = bgColor;
             ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        
        ctx.filter = 'none';
        ctx.restore();
    }
};

export const renderSpotlight = (
    ctx: CanvasRenderingContext2D,
    spotlight: SpotlightEffect,
    canvasWidth: number,
    canvasHeight: number,
    selectedSpotlight: SpotlightEffect | null,
    playing: boolean,
    currentTime: number,
    cropInfo: RenderCropInfo | null = null
) => {
    const transitionDuration = 0.3;
    let alphaFactor = 1.0;
    if (playing) {
        if (currentTime < spotlight.start + transitionDuration) {
            alphaFactor = easeInOutCubic((currentTime - spotlight.start) / transitionDuration);
        } else if (currentTime > spotlight.end - transitionDuration) {
            alphaFactor = easeInOutCubic((spotlight.end - currentTime) / transitionDuration);
        }
    }
    alphaFactor = Math.max(0, Math.min(1, alphaFactor));
    const intensity = spotlight.intensity ?? 0.85; 
    const shape = spotlight.shape ?? 'circle';
    let sx = spotlight.x;
    let sy = spotlight.y;
    let sw = spotlight.width;
    let sh = spotlight.height;

    if (cropInfo && cropInfo.shouldCrop) {
        sx = (sx - cropInfo.sourceX) / cropInfo.sourceW * 100;
        sy = (sy - cropInfo.sourceY) / cropInfo.sourceH * 100;
        sw = (sw / cropInfo.sourceW) * 100;
        sh = (sh / cropInfo.sourceH) * 100;
        const destXPct = (cropInfo.destX / canvasWidth) * 100;
        const destYPct = (cropInfo.destY / canvasHeight) * 100;
        const destWPct = (cropInfo.destW / canvasWidth) * 100;
        const destHPct = (cropInfo.destH / canvasHeight) * 100;
        sx = destXPct + (sx / 100 * destWPct);
        sy = destYPct + (sy / 100 * destHPct);
        sw = (sw / 100) * destWPct;
        sh = (sh / 100) * destHPct;
    }

    const lx = (sx / 100) * canvasWidth;
    const ly = (sy / 100) * canvasHeight;
    const lw = (sw / 100) * canvasWidth;
    const lh = (sh / 100) * canvasHeight;

    ctx.save();
    const maxAlpha = 0.95;
    const alpha = maxAlpha * alphaFactor * intensity;
    
    if (shape === 'rectangle') {
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = Math.min(canvasWidth, canvasHeight) * 0.2; 
        ctx.fillStyle = 'black'; 
        ctx.beginPath();
        if ((ctx as any).roundRect) {
            (ctx as any).roundRect(lx, ly, lw, lh, 16);
        } else {
            ctx.rect(lx, ly, lw, lh);
        }
        ctx.fill();
    } else {
        const cx = lx + lw / 2;
        const cy = ly + lh / 2;
        const radius = Math.max(lw, lh) / 2;
        const gradient = ctx.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius * 1.1);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${alpha})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    ctx.restore();
};

export const renderSubtitles = (
    ctx: CanvasRenderingContext2D,
    subtitles: Subtitle[],
    canvasWidth: number,
    canvasHeight: number,
    cropInfo: RenderCropInfo | null = null,
    isSkimming: boolean = false
) => {
    subtitles.forEach(sub => {
        ctx.save();
        
        let subX = sub.x ?? 50;
        let subY = sub.y ?? 80;
        let scale = sub.scale ?? 1;

        // FIXED: Subtitles are now screen-space relative. 
        // We do NOT apply cropInfo transforms to them. 
        // They stay static relative to the canvas frame.

        const x = subX / 100 * canvasWidth;
        const y = subY / 100 * canvasHeight;
        const rotation = (sub.rotation ?? 0) * Math.PI / 180;

        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(scale, scale);

        const fontSize = Math.max(12, canvasHeight * (0.05 * (sub.fontSize ? sub.fontSize / 100 : 1)));
        const fontFamily = sub.fontFamily || 'Arial';
        const fontWeight = sub.fontWeight || 'bold';
        const fontStyle = sub.fontStyle || 'normal';
        
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // --- Multi-line Support ---
        const text = sub.text || '';
        const lines = text.split('\n');
        const lineHeight = fontSize * 1.25; 
        const totalHeight = lines.length * lineHeight;
        
        // Calculate max width for background
        let maxWidth = 0;
        lines.forEach(line => {
            const metrics = ctx.measureText(line);
            if (metrics.width > maxWidth) maxWidth = metrics.width;
        });

        // 1. Draw Unified Background (if applicable)
        if (sub.backgroundColor && sub.backgroundColor !== 'transparent') {
            ctx.shadowColor = 'transparent'; 
            const bgPadX = fontSize * 0.8;
            const bgPadY = fontSize * 0.4;
            ctx.fillStyle = sub.backgroundColor;
            
            // Draw a rounded rectangle background covering the whole text block
            const bgX = -maxWidth / 2 - bgPadX / 2;
            const bgY = -totalHeight / 2 - bgPadY / 2;
            const bgW = maxWidth + bgPadX;
            const bgH = totalHeight + bgPadY;
            
            ctx.beginPath();
            if ((ctx as any).roundRect) {
                (ctx as any).roundRect(bgX, bgY, bgW, bgH, fontSize * 0.2);
            } else {
                ctx.rect(bgX, bgY, bgW, bgH);
            }
            ctx.fill();
        }

        // 2. Prepare Text Effects (Disable if skimming)
        if (sub.textShadow && !isSkimming) {
            ctx.shadowColor = sub.shadowColor || 'black';
            ctx.shadowBlur = sub.shadowBlur ? (sub.shadowBlur / 100 * fontSize) : (fontSize * 0.2);
            ctx.shadowOffsetX = fontSize * 0.05;
            ctx.shadowOffsetY = fontSize * 0.05;
        } else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        const textColor = sub.color || '#ffffff';
        ctx.fillStyle = textColor;

        // 3. Draw Lines
        // Start Y is shifted up by half the total height to keep the text block centered on (0,0)
        let currentY = -((lines.length - 1) * lineHeight) / 2;

        lines.forEach(line => {
            // Stroke (Disable or simplify if skimming?) 
            // Simplifying: Keep stroke but remove complex processing if any. Standard stroke is cheap-ish.
            // But let's skip stroke if skimming to be ultra fast if requested "Draw raw video". 
            // But we need to see text.
            if (sub.strokeWidth && sub.strokeWidth > 0 && sub.strokeColor && !isSkimming) {
                ctx.lineWidth = (sub.strokeWidth / 100) * fontSize;
                ctx.strokeStyle = sub.strokeColor;
                ctx.lineJoin = 'round';
                ctx.strokeText(line, 0, currentY);
            } else if ((!sub.backgroundColor || sub.backgroundColor === 'transparent') && !sub.textShadow) {
                // Default subtle outline if no background and no shadow for visibility
                ctx.strokeStyle = 'black';
                ctx.lineWidth = fontSize * 0.15;
                ctx.lineJoin = 'round';
                ctx.strokeText(line, 0, currentY);
            }

            // Fill
            ctx.fillText(line, 0, currentY);
            currentY += lineHeight;
        });

        ctx.restore();
    });
};

export const renderPreview = (
    previewCanvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    selectedZoom: ZoomEffect | null,
    activeZoom: ZoomEffect | undefined,
    selectedSpotlight: SpotlightEffect | null,
    activeSpotlight: SpotlightEffect | undefined,
    playing: boolean,
    currentTime: number
) => {
    const pCtx = previewCanvas.getContext('2d');
    if (!pCtx) return;

    previewCanvas.width = 160;
    previewCanvas.height = 90;

    pCtx.drawImage(video, 0, 0, previewCanvas.width, previewCanvas.height);
    
    // Draw indicators for effects on preview
    if (activeZoom) {
        pCtx.strokeStyle = '#10b981';
        pCtx.lineWidth = 2;
        pCtx.strokeRect(
            (activeZoom.x / 100) * previewCanvas.width,
            (activeZoom.y / 100) * previewCanvas.height,
            (activeZoom.width / 100) * previewCanvas.width,
            (activeZoom.height / 100) * previewCanvas.height
        );
    }
};
