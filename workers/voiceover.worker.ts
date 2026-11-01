/// <reference lib="webworker" />
/// <reference types="vite/client" />
import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import ortGlueUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { placeVoiceoverCue, voiceoverCues, VOICEOVER_MODEL, VOICEOVER_SAMPLE_RATE, VOICEOVER_VOICES, type VoiceoverRequest } from '../utils/voiceover';

env.allowLocalModels = false;
env.useBrowserCache = true;
const wasm = env.backends.onnx.wasm;
wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortGlueUrl };
// Keep memory bounded and avoid competing with the subtitle worker's thread pool.
wasm.numThreads = 1;

self.onmessage = async (event: MessageEvent<VoiceoverRequest>) => {
  const progress = (message: string) => self.postMessage({ type: 'progress', message });
  let tts: KokoroTTS | undefined;
  try {
    const { duration, voice } = event.data;
    if (!(voice in VOICEOVER_VOICES)) throw new Error('Choose a supported English voice.');
    const cues = voiceoverCues(event.data.cues, duration);
    tts = await KokoroTTS.from_pretrained(VOICEOVER_MODEL, {
      dtype: 'q8', device: 'wasm',
      progress_callback: p => {
        if (p.status === 'progress') progress(`Loading speech model… ${Math.round(p.progress)}% of ${p.file}`);
      },
    });
    const output = new Float32Array(Math.ceil(duration * VOICEOVER_SAMPLE_RATE));
    for (let i = 0; i < cues.length; i++) {
      progress(`Generating speech on your device… ${i + 1}/${cues.length}`);
      const chunks: Float32Array[] = [];
      let length = 0;
      const text = new TextSplitterStream();
      text.push(cues[i].text);
      text.close();
      for await (const chunk of tts.stream(text, { voice })) {
        // Kokoro truncates long phoneme sequences internally. Reject the whole run if that
        // happened, so an unusually long number or abbreviation can never lose words silently.
        const { input_ids } = tts.tokenizer(chunk.phonemes, { truncation: false });
        if (input_ids.dims.at(-1)! > 512) throw new Error(`Subtitle ${i + 1} exceeds the speech model context. Split it into shorter cues.`);
        if (chunk.audio.sampling_rate !== VOICEOVER_SAMPLE_RATE) throw new Error('Unexpected speech sample rate.');
        const pcm = chunk.audio.audio;
        if (!(pcm instanceof Float32Array)) throw new Error('Expected mono speech audio.');
        chunks.push(pcm);
        length += pcm.length;
      }
      const samples = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      placeVoiceoverCue(output, samples, cues[i], i);
    }
    self.postMessage({ type: 'done', samples: output }, [output.buffer]);
  } catch (error: unknown) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Local speech generation failed.' });
  } finally {
    await tts?.model.dispose();
  }
};
