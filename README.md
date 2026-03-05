<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FrameCut Web Editor

FrameCut Web is a high-performance, web-based video editor built with React 19 and Vite. It supports advanced features like multi-track timeline editing, dynamic effects (Zoom, Spotlight, Mosaic), and real-time screen recording with a built-in PiP timer.

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or higher recommended)

### Local Development
1. **Clone and Install**:
   ```bash
   npm install
   ```
2. **Setup Environment**:
   Create a `.env.local` file and add your Gemini API key (if using AI features):
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```
3. **Run Dev Server**:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## 🏗 Architecture

The project follows a **Centralized State + Pure Rendering** architecture to ensure timeline precision and performance.

- **State Management**: Centralized in `App.tsx` using React hooks. The state includes assets (Intro, Main, Outro, Audio), timeline clips, subtitles, and effect configurations.
- **Rendering Engine**: Located in `components/Player.tsx`. It uses a **RequestAnimationFrame loop** to draw directly onto an HTML5 Canvas. This bypasses React's reconciliation lag for smooth frame-accurate previews and effects.
- **Timeline Engine**: Located in `components/Timeline.tsx`. Focuses on visual representation of clips and drag-and-drop interaction.
- **Utility Layer**: `utils.ts` handles timecode formatting, waveform extraction (Web Audio API), and media metadata fetching.
- **Type System**: Heavily typed in `types.ts` to ensure consistency across the editor's complex data structures.

## ✨ Features

- **Video Editing**: 
  - Manage Intro, Main Video, and Outro assets separately.
  - Frame-accurate clipping and timeline positioning.
  - Multi-source support (URL import or Local file upload).
- **Audio & Waveforms**:
  - Independent background audio track.
  - Real-time waveform generation for visual syncing.
- **Dynamic Effects**:
  - **Zoom**: Smooth interpolation and cropping.
  - **Spotlight**: Focus on specific areas with custom gradients.
  - **Mosaic**: Interactive drawing on the video to blur sensitive content.
- **Subtitles**: Drag-and-drop subtitle positioning with real-time editing.
- **Screen Recording**: 
  - Integrated screen capture.
  - Floating Picture-in-Picture (PiP) timer for recording feedback.
  - Auto-generation of spotlight markers during recording.
- **Export Engine**: Support for canvas-based frame capture and video export (WebM/MP4, subject to CORS).

## 🧪 Testing

We use **Playwright** for end-to-end (E2E) testing to ensure the editor's core features work as expected across different browsers.

### Running Tests

1. **Ensure the Dev Server is Running**:
   In one terminal, run:
   ```bash
   npm run dev
   ```
2. **Run All Tests**:
   In another terminal, run:
   ```bash
   npx playwright test
   ```
3. **Run Specific Tests**:
   For example, to run the screen recording test:
   ```bash
   npx playwright test tests/recording.spec.ts
   ```
4. **Debug Tests with UI Mode**:
   ```bash
   npx playwright test --ui
   ```

### Test Coverage

Currently, we have automated coverage for:
- **Screen Recording Flow**: Verifies starting a recording, waiting for 5 seconds, stopping, and ensuring the video is correctly loaded into the editor ([recording.spec.ts](file:///Users/weijingliunyu/IdeaProjects/framecut-web/tests/recording.spec.ts)).

### Configuration

Tests are configured in [playwright.config.ts](file:///Users/weijingliunyu/IdeaProjects/framecut-web/playwright.config.ts). This configuration includes:
- **Automatic Media Permissions**: Chromium is configured to use fake media streams and auto-approve screen sharing requests.
- **Base URL**: Defaults to `http://localhost:3000`.
- **Parallel Execution**: Tests run in parallel for maximum speed.

## 📦 Deployment

This project is optimized for deployment on **Cloudflare Pages**. We use a two-tier deployment strategy to balance speed and safety:

### 1. Staging (Automatic)
Every push to the `master` (or `main`) branch is automatically built and deployed. This allows for rapid testing of new features.
- **Workflow**: `git push origin master`
- **Host**: Cloudflare Pages (Managed Git Integration)

### 2. Production (Tag-Driven)
Production releases are triggered manually using git tags. This ensures that only stable, versioned code is deployed to your primary domain while saving CI/CD minutes.

```bash
# 1. Tag your release
git tag v1.0.0
git push origin --tags

# 2. Deploy to production
npm run deploy:prod
```

### Deployment Guide
For detailed instructions on setting up Cloudflare Pages, custom domains, and the local release script, please refer to the [Cloudflare Deployment Guide](docs/feature/cloudflare-deployment.md).

