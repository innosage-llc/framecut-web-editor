# Pro paywall presentation

The account paywall allocates approximately 58% of desktop column space to the screenshot carousel and 42% to compact plan cards. Small screens use one scrollable column. Common Pro features remain in the carousel; pricing and option-specific coverage remain on the right. Sign-in, redemption, billing, and session recovery use the existing verified-account flow.

The carousel reuses the five original PNG assets uploaded to App Store Connect, in order, at their original 2880 × 1800 resolution. Files `public/pro-features/app-store-01.png` through `app-store-05.png` exactly match the SHA-256 entries in the Mac repository's `marketing/app-store/manifest.json`. These are original FrameCut screenshots with original Northstar demo content. The artwork contains its own titles, eliminating duplicate headings. The carousel is labeled FrameCut for Mac to distinguish the native app screenshots from the browser UI. The previous two illustrative assets are removed.

Previous/next arrows wrap through all five images, dots select a slide, and left/right keys navigate when the carousel is focused. Images have feature-specific alternative text, and the page indicator announces the feature title. There is no automatic rotation.

One-time, annual, and monthly prices and license/update terms are unchanged. All plans share watermark-free video/GIF/PNG output, 1080p/4K video, and longer GIFs within browser resource limits. Checkout, identity, entitlement checks, and secure payment URL verification are unchanged.

Validation: required `./scripts/gatekeeper.sh`, `npx tsc --noEmit`, and existing shared-licensing tests. Browser checks cover all five original images, wraparound/dot/keyboard navigation, wider image bounds than pricing bounds, image width above 500 pixels on desktop, 390px mobile overflow, sign-in, and Escape. Current previews: `docs/screenshots/paywall-app-store-desktop.png`, `paywall-app-store-mobile.png`, and `paywall-app-store-mobile-plans.png`.
