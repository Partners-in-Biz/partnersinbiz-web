# Lead capture v3 spam controls

This note documents the reviewed v3 lead-capture controls for public newsletter/capture-source embeds.

## Enabled by default

For every new capture source:

- Honeypot is enabled unless `honeypotEnabled: false` is explicitly saved.
- Disposable-domain blocking is enabled unless `blockDisposableEmails: false` is explicitly saved.
- Rate limiting is enabled unless `rateLimit.enabled: false` is explicitly saved.
  - Default IP limit: 10 submissions per source per hour.
  - Default email limit: 3 submissions per source per day.

Blocked attempts increment `lead_capture_sources/{sourceId}.stats.blocked` by reason:

- `honeypot`
- `rateLimit`
- `disposable`
- `captcha`

## Turnstile is optional and disabled unless fully configured

Turnstile is not required for the default lead-capture flow. Do not enable it for a source until both server and source config exist.

Peet must add `TURNSTILE_SECRET_KEY` to the deployment environment only when a client/source should use Cloudflare Turnstile. This is the server-side secret from Cloudflare Turnstile and must stay private.

Peet must add a per-source `turnstileSiteKey` only for capture sources that should render a Turnstile widget. The site key is public and is embedded into the iframe/script widget for that source.

A source is treated as Turnstile-protected only when all three are present:

1. `source.turnstileEnabled === true`
2. `source.turnstileSiteKey` is non-empty
3. `process.env.TURNSTILE_SECRET_KEY` is non-empty

If any item is missing, Turnstile stays disabled for public submit/progressive endpoints and the embed does not require a challenge. This prevents a half-configured source from blocking legitimate submissions.

## Public submit and CORS

The public submit endpoints intentionally require no auth and return open CORS headers because they are called from client websites:

- `POST /api/v1/capture-sources/:id/submit`
- `OPTIONS /api/v1/capture-sources/:id/submit`
- `POST /api/v1/capture-sources/:id/progressive`
- `OPTIONS /api/v1/capture-sources/:id/progressive`
- `POST /api/embed/newsletter/:sourceId/submit` delegates to the v1 submit route and shares the same CORS/OPTIONS behavior.

Allowed methods are `POST, OPTIONS`; allowed headers are `Content-Type`; origin is `*`.

## Progressive submit behavior

Multi-step widgets use `/progressive`.

- Step 0 validates email and runs honeypot, rate-limit, disposable-domain checks, then creates or updates the contact and writes a partial `lead_capture_submissions` document.
- Intermediate steps merge sanitized field data into the existing submission.
- The final step runs optional Turnstile verification only when fully configured, marks the submission complete, and then runs double-opt-in or immediate auto-enroll behavior.

## Embed behavior

- The iframe embed renders overlay modes as inline previews because popup/slide-in/exit-intent depend on the host page viewport.
- The script-tag embed supports inline, popup, slide-in, exit-intent, and multi-step modes directly on the host page.
- Honeypot is always rendered in the widget but is enforced server-side.
- Turnstile script loading is lazy and only occurs when the source is fully configured for Turnstile.
