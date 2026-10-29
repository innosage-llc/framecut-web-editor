import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // Same cross-origin isolation headers as production (public/_headers), so dev/preview/tests
      // run the multi-threaded Whisper path too.
      server: {
        port: 3000,
        host: '0.0.0.0',
        headers: ISOLATION_HEADERS,
      },
      preview: { headers: ISOLATION_HEADERS },
      plugins: [react()],
      // gifenc is only imported from the GIF encoder worker; pre-bundle it so the dev server
      // doesn't discover it lazily and force a full page reload mid-session.
      optimizeDeps: { include: ['gifenc'], exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
      worker: { format: 'es' },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: [
          { find: '@', replacement: path.resolve(__dirname, '.') },
          // #27: transformers.js imports the WebGPU build of ONNX Runtime, whose WASM (~28 MB) is over
          // Cloudflare Pages' 25 MiB per-file limit. We only use the CPU/WASM backend, so use the plain
          // WASM build (~14 MB binary, self-hosted from our own origin; no CDN).
          // The "extern wasm" build (ort.wasm.min.mjs) loads its Emscripten glue from a separate
          // file (wasmPaths.mjs) instead of inlining it. Multi-threaded WASM needs that: pthread
          // workers are started from the glue's own URL; with the inlined bundle they were started
          // from our whisper worker chunk and never initialised (transcription hung).
          { find: /^onnxruntime-web\/webgpu$/, replacement: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs') },
        ]
      }
    };
});