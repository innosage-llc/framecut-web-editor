# Local AI voiceover (#46)

Open **AI voiceover** beside the subtitle tools, choose Heart (American English) or
Emma (British English), then generate and confirm the model download. The English
text-to-speech model runs in a dedicated browser worker using CPU/WASM. Text and
media stay on the device; there is no inference service, API key, or paid API.
Model and voice downloads use Hugging Face; runtime assets are served by this app.
Hosting and download bandwidth are distinct from inference costs.

## First-version limits

- Projects up to 180 seconds, 120 nonempty cues, 200 characters per cue.
- Cues must have finite, positive durations, lie within the project, and not overlap.
- Cue start times and gaps are preserved in a 24 kHz mono WAV. Speech that exceeds
  a cue's duration fails the run with the cue number; text is never cut to fit.
- Generated audio occupies an independent A4 lane. System audio, recorded microphone
  narration, and music remain intact. Use lane mutes for voiceover-only playback.
- This is an explicit snapshot, not a live subtitle binding. Regenerate after subtitle
  or video timing changes. Text/timing and duration changes show a stale notice;
  video trims do not automatically move generated speech.
- Regeneration replaces only the generated voiceover, and only after synthesis and
  IndexedDB storage succeed. Cancel, timeout (10 minutes), failure, or subtitle edits
  during generation leave the previous voiceover intact. Remove/regenerate and lane
  mutes support undo/redo.
- Generated audio is restored from IndexedDB and included in project ZIPs, preview,
  and video/WAV/M4A exports. Old projects without voiceover still load normally.
- Unsupported browsers and larger projects have a link to the macOS app. No cloud
  fallback is used. Quality and performance vary by browser and device; no latency
  guarantee is made. First-use download disclosure is approximate (about 130 MB),
  and is shown on every generation because cache eviction cannot be assumed.

## Engine and licenses

- `kokoro-js` 1.2.1: Apache-2.0, https://github.com/hexgrad/kokoro/tree/main/kokoro.js
- `onnx-community/Kokoro-82M-v1.0-ONNX`, q8: model card declares Apache-2.0;
  quantized model file is approximately 92.4 MB, plus tokenizer and voice assets:
  https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- `phonemizer` 1.2.1: package declares Apache-2.0 and embeds an eSpeak NG phonemizer:
  https://github.com/xenova/phonemizer.js. Its embedded eSpeak NG component is
  GPL-3.0-or-later (the wrapper declaration does not supersede that license):
  https://github.com/espeak-ng/espeak-ng. Notices, source links, and the GPL text
  are included in `public/licenses/`.
- The editor's existing Transformers.js 4.x and ONNX Runtime are shared with Whisper
  through an npm override and Vite deduplication. The browser inference path must be
  verified when upgrading any of these dependencies.

Package license texts are distributed in `public/licenses/`. Model downloads remain
external and their upstream notices apply. Voices are predefined; voice cloning and
translation are outside this version's scope.

## Validation

Run `./scripts/gatekeeper.sh`. Browser validation should cover cue placement and
overflow, no model download before confirmation, cancellation, errors and stale
results, independent mutes, undo/redo, reload, project ZIP round-trip, and rendered
audio inclusion. A real model generation is necessary to verify the dependency
override, worker startup, phonemization, and waveform output; mocks alone cannot
establish speech quality or inference performance.
