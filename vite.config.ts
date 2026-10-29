import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
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
          { find: /^onnxruntime-web\/webgpu$/, replacement: 'onnxruntime-web/wasm' },
        ]
      }
    };
});