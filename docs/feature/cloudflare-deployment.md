# Feature Specification Document: Cloudflare Deployment Guide

## 1. Executive Summary

-   **Feature**: Cloudflare Deployment Guide
-   **Status**: Planned
-   **Summary**: This document provides a step-by-step guide for deploying the FrameCut Web Editor to a custom domain using **Cloudflare Pages**. Cloudflare Pages provides a seamless, Git-integrated workflow that automatically builds and deploys the application on every push to the repository.

## 2. Design Philosophy & Guiding Principles

**Clarity vs. Power:**
-   **Guiding Question**: Is the primary goal for this feature to be immediately understandable and simple, or to be feature-rich and powerful for expert users?
-   **Our Principle**: **Prioritize Clarity.** We use Cloudflare Pages' managed build system to minimize manual configuration while providing high availability via Cloudflare's global edge network.

**Convention vs. Novelty:**
-   **Guiding Question**: Should this feature leverage familiar, industry-standard patterns?
-   **Our Principle**: **Adhere to Convention.** We follow standard Vite/React deployment patterns for static site hosting (SSG/SPA).

**Guidance vs. Freedom:**
-   **Guiding Question**: How much should we guide the user?
-   **Our Principle**: **Provide strong guardrails.** This guide provides the exact build commands and directory structures needed for the project to function correctly on Cloudflare.

**Aesthetic & Tone:**
-   **Guiding Question**: What is the emotional goal of this feature?
-   **Our Principle**: The tone is professional, technical, and encouraging. The goal is to make the transition from local development to production feel "instant" and reliable.

## 3. Problem Statement & Goals

-   **Problem**: The FrameCut Web Editor is currently running locally. To share it with users and technical stakeholders, it needs a production-grade URL with HTTPS and custom domain support.
-   **Goals**:
    *   Goal 1: Automate the deployment process via GitHub integration.
    *   Goal 2: Ensure the application is served from Cloudflare's global edge for sub-100ms latency.
    *   Goal 3: Connect the application to a custom domain name.
-   **Success Metrics**:
    *   Metric 1: Every push to the `master` branch results in an updated production deployment.
    *   Metric 2: The custom domain resolves correctly with a valid SSL certificate.

## 4. Scope

-   **In Scope:**
    *   Connecting the `innosage-llc/framecut-web-editor` repository to Cloudflare Pages.
    *   Configuring the Vite build pipeline (Environment: Node.js, Build: `npm run build`, Output: `dist`).
    *   Setting up custom domain records in Cloudflare DNS.
-   **Out of Scope:**
    *   Setting up Cloudflare Workers for backend logic (unless required later).
    *   Configuring custom CI/CD pipelines outside of Cloudflare's native builder.

## 5. User Stories

-   As a **Developer**, I want **my code to deploy automatically when I push to GitHub** so that **I don't have to manually upload files**.
-   As a **Product Owner**, I want **the site to be accessible via a custom domain** so that **it looks professional to our users**.

## 6. Acceptance Criteria

-   **Scenario: First Deployment**
    *   **Given**: The GitHub repository is public or accessible to Cloudflare.
    *   **When**: I connect the repository in the Cloudflare Dashboard.
    *   **Then**: Cloudflare successfully builds the project using `npm run build`.
    *   **And**: A preview URL is generated (e.g., `framecut-web-editor.pages.dev`).

-   **Scenario: Custom Domain Link**
    *   **Given**: I own a domain managed by Cloudflare.
    *   **When**: I add the custom domain to the Pages project.
    *   **Then**: The domain correctly displays the editor with valid HTTPS.

## 7. UI/UX Flow & Requirements

*Not applicable as this is an infrastructure/deployment task.*

## 8. Technical Design & Implementation

-   **High-Level Approach**: We utilize **Cloudflare Pages**, which is a Jamstack platform for frontend developers. It automatically handles cloning the repo, installing dependencies, running the build script, and serving the `dist` folder.
-   **Component Breakdown**:
    *   `vite.config.ts`: Remains unchanged; `dist` is the target directory.
    *   `package.json`: Contains the `build` script (`vite build`).
-   **Key Logic**: Cloudflare detects the Vite framework and applies sensible defaults.

## 9. Data Management & Schema

N/A - Deployment handles static assets.

## 10. Storage Compatibility Strategy (Critical)

| Feature Aspect | Firebase (Cloud) | Google Drive (BYOS) | Static Mirror (R2) |
| :--- | :--- | :--- | :--- |
| **Hosting** | N/A | N/A | **Cloudflare Pages (Primary)** |

*Note: Since this is the "Static Mirror" of the application, Cloudflare Pages is the natural fit for hosting the editor itself.*

## 11. Limitations & Known Issues

-   **Limitation 1**: **Client-side Routing**. If using React Router, Cloudflare Pages needs a `_redirects` file to handle deep links. Currently, FrameCut is a Single Page Application without complex routing, so this is not required yet.
-   **Limitation 2**: **Build Limits**. Free accounts have limits on build minutes and concurrent builds.

---

## 13. Setup & Configuration Guide

Follow these steps to deploy your project to your domain via Cloudflare.

### Step 1: Connect GitHub to Cloudflare

1.  Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  In the sidebar, select **Workers & Pages**.
3.  Click the **Create** button.
4.  **Crucial**: Select the **Pages** tab (not the Workers tab).
5.  Click **Connect to Git**.
6.  Select your GitHub account and the `innosage-llc/framecut-web-editor` repository.
7.  Click **Begin setup**.

> **Note**: If you see a "Deploy command" field asking for `npx wrangler deploy`, you are likely on the **Workers** tab. Switch to the **Pages** tab to see the correct settings for a Vite project.

### Step 2: Configure Build Settings

In the **Configure builds and deployments** screen, enter the following:

-   **Project name**: `framecut-web-editor`
-   **Production branch**: `master`
-   **Framework preset**: `Vite`
-   **Build command**: `npm run build`
-   **Build output directory**: `dist`
-   **Environment variables (Optional)**: If you have API keys (like `GEMINI_API_KEY`), add them here.

Click **Save and Deploy**.

### Step 3: Add Custom Domain

1.  Once the first deployment is complete, go to the project's **Custom domains** tab.
2.  Click **Set up a custom domain**.
3.  Enter your domain name (e.g., `editor.yourdomain.com`).
4.  Cloudflare will automatically prompt you to update your DNS records if your domain is managed by Cloudflare.
5.  Click **Activate domain**.

### Step 4: Verify Deployment

1.  Wait for the DNS to propagate (usually 1-5 minutes).
2.  Navigate to your custom domain in a browser.
3.  Verify that the editor loads correctly and all features (Upload, Record, Timeline) are functional.
