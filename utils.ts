// ... existing imports ...

/**
 * Formats seconds into HH:MM:SS:FF (Frames)
 */
export const formatTimecode = (timeInSeconds: number, fps: number = 30): string => {
  const totalFrames = Math.floor(Math.max(0, timeInSeconds) * fps);
  const hours = Math.floor(totalFrames / (fps * 60 * 60));
  const minutes = Math.floor((totalFrames % (fps * 60 * 60)) / (fps * 60));
  const seconds = Math.floor((totalFrames % (fps * 60)) / fps);
  const frames = totalFrames % fps;

  const pad = (num: number) => num.toString().padStart(2, '0');

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
};

/**
 * Formats seconds into MM:SS
 */
export const formatTimeShort = (timeInSeconds: number): string => {
  const minutes = Math.floor(Math.max(0, timeInSeconds) / 60);
  const seconds = Math.floor(Math.max(0, timeInSeconds) % 60);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds)}`;
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};

export const getVideoDuration = (url: string): Promise<{ duration: number; corsCompatible: boolean }> => {
  return new Promise((resolve, reject) => {
    // Note: We used to block YouTube links here. 
    // We now allow them to proceed so that if the user provides a direct media link 
    // (or uses a tool that resolves to one), it might work via the fallback logic below.

    // Try CORS first
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    const isBlob = url.startsWith('blob:') || url.startsWith('data:');
    if (!isBlob) {
      video.crossOrigin = 'anonymous';
    }
    
    video.onloadedmetadata = () => {
      // Fix for Chrome bug where MediaRecorder WebM blobs report Infinity duration
      if (video.duration === Infinity) {
          video.currentTime = 1e101; // Seek to end
          video.ontimeupdate = () => {
              video.ontimeupdate = null;
              // Reset and resolve with new calculated duration
              video.currentTime = 0;
              // Fallback to 0 if still invalid to prevent UI crashes
              const fixedDuration = Number.isFinite(video.duration) ? video.duration : 0;
              resolve({ duration: fixedDuration, corsCompatible: true });
          };
      } else {
          resolve({ duration: video.duration, corsCompatible: true });
      }
    };
    
    video.onerror = () => {
      // If CORS failed (common with AWS S3 etc without headers), try without CORS (opaque response)
      // This allows playback but disables canvas read/export
      if (!isBlob && video.crossOrigin === 'anonymous') {
         const retryVideo = document.createElement('video');
         retryVideo.preload = 'metadata';
         // Important: Do NOT set crossOrigin here to allow opaque response
         
         retryVideo.onloadedmetadata = () => {
             // Same Infinity check for fallback video
             if (retryVideo.duration === Infinity) {
                 retryVideo.currentTime = 1e101;
                 retryVideo.ontimeupdate = () => {
                     retryVideo.ontimeupdate = null;
                     retryVideo.currentTime = 0;
                     const fixedDuration = Number.isFinite(retryVideo.duration) ? retryVideo.duration : 0;
                     resolve({ duration: fixedDuration, corsCompatible: false });
                 };
             } else {
                 resolve({ duration: retryVideo.duration, corsCompatible: false });
             }
         };
         
         retryVideo.onerror = () => {
             const code = retryVideo.error?.code;
             // Check if it looks like a YouTube link to provide a specific hint
             if (url.includes('youtube.com') || url.includes('youtu.be')) {
                reject("YouTube links cannot be loaded directly. Please convert the video to a direct .mp4 link or download it first.");
             } else {
                reject(`Failed to load video (Error Code: ${code}). Ensure the URL points to a valid video file (not a webpage).`);
             }
         };
         
         retryVideo.src = url;
      } else {
         const code = video.error?.code;
         if (url.includes('youtube.com') || url.includes('youtu.be')) {
             reject("YouTube links cannot be loaded directly. Please convert the video to a direct .mp4 link or download it first.");
         } else {
             reject(`Error loading video (Code: ${code}). Ensure the URL is valid and accessible.`);
         }
      }
    };
    video.src = url;
  });
};

/**
 * Extracts a waveform from a video/audio url.
 * Returns an array of normalized values (0-1).
 * Samples ~100 points per second.
 */
export const extractWaveform = async (url: string): Promise<number[]> => {
  // If it's a color asset, return empty
  if (url.startsWith('color:')) return [];

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return [];
    
    const audioContext = new AudioContextClass();
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Guard against infinite duration to prevent loops/allocation errors
    if (!Number.isFinite(audioBuffer.duration)) {
        await audioContext.close();
        return [];
    }

    const rawData = audioBuffer.getChannelData(0); // Use first channel
    const samplesPerSec = 50; // Points per second for visualization
    const totalSamples = Math.floor(audioBuffer.duration * samplesPerSec);
    
    // Safety check for empty or invalid samples
    if (totalSamples <= 0 || !Number.isFinite(totalSamples)) {
        await audioContext.close();
        return [];
    }

    const blockSize = Math.floor(rawData.length / totalSamples);
    const waveform = [];

    // Compress data into peaks
    for (let i = 0; i < totalSamples; i++) {
      let sum = 0;
      const start = i * blockSize;
      // Simple average of absolute values (rectified) for visualization
      for (let j = 0; j < blockSize; j++) {
        // Safe check
        if (rawData[start + j]) {
           sum += Math.abs(rawData[start + j]);
        }
      }
      waveform.push(sum / blockSize);
    }
    
    // Normalize to 0-1 range to handle different volumes consistently
    const max = Math.max(...waveform, 0.001); // avoid div by zero
    const normalized = waveform.map(n => n / max);
    
    // Cleanup
    await audioContext.close();
    
    return normalized;
  } catch (e) {
    console.warn("Waveform generation failed (likely due to CORS or format)", e);
    return [];
  }
};