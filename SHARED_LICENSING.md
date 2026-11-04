# Shared FrameCut licensing

The web editor uses the shared `mac-licensing` Worker. Staging uses the InnoSage Stripe sandbox; production services and live payments are outside this change.

Preview: https://licensing-staging.framecut-web-editor.pages.dev

## Customer flow

1. Open **Account**, enter the purchase email, and request an eight-digit sign-in code.
2. Verify the emailed code. No password is stored or requested.
3. Redeem the existing FrameCut key once. The verified account email must match the license purchase email. Returning sign-ins restore linked licenses without re-entering keys.
4. Active Pro removes export watermarks and enables 1080p/4K MP4 and longer GIFs, subject to browser resource limits. PNG screenshots use the same Free watermark/720p policy; Pro retains preview dimensions, and project cover thumbnails remain unchanged. Free editing/import remain available without sign-in; Free exports are watermarked 720p MP4 or GIFs up to 15 seconds and 720px on the longest side.
5. **Manage Stripe billing** opens a short-lived customer portal for the selected owned license. Customers can update payment methods, view invoices, and cancel subscriptions at the paid period end. Refund requests and email changes remain support operations.

The one-time purchase grants ongoing web Pro independently of the Mac update-coverage year. Subscription access follows the paid-through cutoff. Refunds/revocation are read from the same license record as the Mac client. Returning from Checkout or billing never grants Pro by itself.

## Browser sessions

Each account has at most two active browser sessions. Tabs in the same browser cookie store share one session; private windows and separate browser profiles use different sessions. Web sessions never allocate Mac activation seats.

The sign-in cookie expires after 30 days. Active sessions hold a two-minute lease, renewed about every 30 seconds and on focus. D1 allocates leases with a single conditional update, so concurrent requests cannot exceed two. A third browser remains Free and can release an older session from Account. A forcibly released session cannot reclaim Pro through heartbeat; the user must choose **Resume this browser**. Abandoned sessions expire naturally.

Exports recheck server access before starting. Network failure fails closed to Free. Existing successful exports finish using the access snapshot taken at the start; editor/project data is never deleted when access changes. Local browser rendering is client-side enforcement, not tamper-proof DRM.

## Security and ownership

- Session credentials are random 256-bit opaque tokens stored only in `Secure; HttpOnly; SameSite=Lax; Path=/` host-only cookies. D1 stores token hashes. Neither localStorage nor sessionStorage contains license keys or persistent authentication tokens.
- Email codes expire after ten minutes, are consumed atomically once, allow five attempts, and are bound to their originating web origin. Their stored values are HMACs with the staging authentication secret. Requests have persistent per-email and per-client rate limits.
- License ownership is unique per license ID. Redemption checks both the key and the verified purchase email and does not change the key or Mac seat allowance.
- Browser requests go through `/api/licensing/*`. The Pages Function validates POST origins, accepts bounded JSON, forwards only the licensing cookie, and authenticates to the backend with a private proxy token. A direct Worker service binding avoids cross-Worker public routing. Redirects are handled manually and rejected.
- Authenticated mutations also require a session-bound CSRF header. Account responses are `no-store`. Account/session/billing actions always check the authenticated owner server-side.
- Stripe customer IDs are resolved from the selected owned license's server-side payment/subscription reference. Browser-supplied customer IDs and redirect URLs are never accepted. The backend verifies the configured Stripe account and sandbox/live mode before creating a portal session.
- Sandbox and production must use distinct origins, databases, proxy/authentication secrets, Stripe configurations, and runtime credentials.

## Configuration

The staging Pages preview has these bindings:

| Binding | Purpose |
| --- | --- |
| `LICENSING` | Service binding to `license-worker-staging` |
| `LICENSING_ORIGIN` | `https://framecut-license-staging.innosage.co` |
| `WEB_PROXY_TOKEN` | Pages secret matching the backend's staging proxy secret |

The backend also needs `WEB_AUTH_SECRET`, `WEB_ALLOWED_ORIGINS`, and `STRIPE_PORTAL_CONFIGURATION`. The sandbox runtime key requires Customer Portal Write in addition to the existing checkout/reconciliation permissions. Existing Stripe webhooks remain authoritative for subscription and refund changes.

For local development, keep `WEB_PROXY_TOKEN` and `LICENSING_ORIGIN` in ignored `.env.local`; these are consumed only by Vite's server proxy and must never use the `VITE_` prefix. The local origin is `http://localhost:3000`. Never commit server secrets or paste them into chat. Production account configuration remains unset until an isolated live licensing backend is configured.

## Validation and review

Required build gate:

```sh
./scripts/gatekeeper.sh
```

Focused browser regression tests (installed Chrome can be used with an isolated test profile):

```sh
FRAMECUT_TEST_BROWSER_CHANNEL=chrome npx playwright test tests/shared-licensing.spec.ts --project=chromium --no-deps --workers=1
npx tsc --noEmit
```

Backend tests include code binding/normalization and SQLite tests that execute the actual session-allocation and code-consumption SQL, including concurrent third-session attempts, expiry, replay, release/resume, and ownership isolation.

Hosted email verification, real sandbox purchase/redemption, customer-portal cancellation, and cross-platform entitlement checks must be recorded before this integration is declared end-to-end validated. Synthetic seeded authentication fixtures are security tests and do not establish inbox delivery.

Changes under `src/auth` require human review under `AGENTS.md`. Keep the authentication PR open for that review rather than running the automatic squash-merge path.


## Production cutover

The production Pages project is `framecut-production`, serving `https://framecut.innosage.co`. Its licensing bindings are currently unset. Provision the isolated live backend and catalog first; do not point the public app at the sandbox.

Configure these **production** bindings before deploying the reviewed authentication change:

| Binding | Production value |
| --- | --- |
| `LICENSING` | Service binding to `license-worker-production` |
| `LICENSING_ORIGIN` | Proposed `https://framecut-license.innosage.co` |
| `WEB_PROXY_TOKEN` | Production secret matching that Worker; distinct from staging |

The backend's exact web allowlist must include only the canonical production web origin. The backend needs live Stripe products/prices, portal configuration, permanent signed webhooks, migrations 0001–0006, signing/auth/delivery secrets, and operational mail/error monitoring. The full sequence and verified staging evidence are recorded in `license-worker/FRAMECUT.md` under Production launch gate in the companion backend PR.

Review fixes remove the unsupported WebM offer, mark refunded licenses inactive instead of promising future paid access, and make proxy configuration/stream/timeout failures return safe account-service errors. Supported visual export formats are MP4 and GIF, with PNG screenshots separately available. No live billing is enabled by merging this source change alone.
