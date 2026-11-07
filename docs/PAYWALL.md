# Pro paywall presentation

Account now shows a screenshot gallery, three concrete Pro export benefits, and visible plan choices before sign-in. Checkout requires the existing verified-account flow. Active Pro accounts retain their license, billing, and browser-session controls without being shown another purchase prompt.

Pro unlocks watermark-free video/GIF/PNG output, 1080p/4K video, and longer/larger GIFs within browser resource limits. Recording, importing, editing, zoom, backgrounds, and captions remain labeled Free. The plan cards distinguish USD one-time, annual, and monthly prices and explain renewal, Mac update coverage, refund support, and the separate Mac App Store purchase scope.

Images in `public/pro-features` use genuine web editor/export screenshots and original Northstar demo media. The export artwork enlarges the actual export panel alongside the original video frame on a lavender background; this is a feature composition, not a full-window screenshot. The capture uses a synthetic local Pro account solely to show the existing 4K settings. It is illustrative product imagery, not evidence of a completed purchase. Production account state, entitlement checks, and checkout URL verification are unchanged.

The dialog uses two columns on desktop and a single scrollable column on small screens. Gallery buttons and plan buttons expose pressed state; existing focus containment, Escape, sign-in, redemption, and recovery controls are preserved.

Validation: `npx tsc --noEmit`, all 12 existing shared-licensing browser tests, and `./scripts/gatekeeper.sh` passed. Visual checks covered 1440px desktop and 390px mobile widths, loaded gallery images, plan selection, the sign-in field, sticky close control, and Escape. Final visual evidence is in `docs/screenshots/paywall-desktop.png` and `paywall-mobile.png`.
