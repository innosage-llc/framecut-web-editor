/**
 * One known PCM clock for sync assertions. Chromium's independent fake input/display generators
 * can drift (and differ by platform); that is not a measurement of the editor's alignment.
 * Keep the real video capture, MediaRecorders, mono-mic graph and import path under test.
 */
export function installSharedCaptureAudio() {
  const media = navigator.mediaDevices;
  const getUserMedia = media.getUserMedia.bind(media);
  const getDisplayMedia = media.getDisplayMedia.bind(media);
  let shared: MediaStream | null = null;
  // Keep permission/device identity stable while replacing the audible test signal.
  const nativeAudio: MediaStreamTrack[] = [];
  window.addEventListener('pagehide', () => nativeAudio.forEach(track => track.stop()), { once: true });
  const audio = async () => {
    if (!shared) {
      const context = new AudioContext({ sampleRate: 48000 });
      const buffer = context.createBuffer(1, 24000, 48000);
      const samples = buffer.getChannelData(0);
      // A 50 ms tone every 500 ms gives unambiguous rising edges on a common sample clock.
      for (let i = 0; i < 2400; i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(silent);
      silent.connect(context.destination);
      source.start();
      await context.resume();
      shared = destination.stream;
      window.addEventListener('pagehide', () => {
        source.stop();
        shared?.getTracks().forEach(track => track.stop());
        void context.close();
      }, { once: true });
    }
    return shared.getAudioTracks()[0].clone();
  };
  media.getUserMedia = async constraints => {
    const stream = await getUserMedia(constraints);
    if (constraints?.audio) {
      const replacement = await audio();
      const deviceId = stream.getAudioTracks()[0].getSettings().deviceId;
      const settings = replacement.getSettings.bind(replacement);
      replacement.getSettings = () => ({ ...settings(), deviceId });
      stream.getAudioTracks().forEach(track => { stream.removeTrack(track); nativeAudio.push(track); });
      stream.addTrack(replacement);
    }
    return stream;
  };
  media.getDisplayMedia = async constraints => {
    const stream = await getDisplayMedia(constraints);
    const replacement = await audio();
    stream.getAudioTracks().forEach(track => { stream.removeTrack(track); nativeAudio.push(track); });
    stream.addTrack(replacement);
    return stream;
  };
}
