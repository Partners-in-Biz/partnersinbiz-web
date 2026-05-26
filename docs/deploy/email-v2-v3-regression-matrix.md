# Email v2/v3 regression matrix

Last updated: 2026-05-25

This matrix is the focused regression gate for the Partners in Biz Email Platform v2/v3 surfaces after the 2026-05 v2/v3 hardening chain. It is intentionally code-level and non-sending: do not send live email/SMS or promote production from this checklist unless Peet explicitly approves a live smoke or production release.

## Covered surfaces

- Direct email API: list, schedule, send, send gates, one-click unsubscribe tokens, sender resolution.
- Resend webhooks: outbound event webhook signature handling, bounce/complaint handling, local verifier helper.
- Broadcasts: send pipeline, A/B variant sender resolution, winner-only recipient drain, AMP HTML fallback audit metadata.
- Scheduled email cron: suppression, preference, and frequency-cap gates before provider dispatch.
- Sequences: CRUD/enrollment basics, cron dispatch, branch/reply handling coverage through process-sequences tests.
- Preferences/suppressions/frequency caps: contact preference API and send-gate regressions.
- Behavioral segmentation and tracked links: opened/clicked/replied/engagement filters and tenant-scoped link_clicks rows.
- Lead capture/forms: public capture submit, capture-source API, Turnstile-optional behavior, progressive/form submit coverage.
- SMS: CRM one-off send, status webhook, Twilio readiness/no-creds behavior.
- Build surface: real Next.js production build, not just tsc.

## Focused regression command

Run from the development worktree:

```bash
npm test -- --runInBand \
  __tests__/api/v1/email/send.test.ts \
  __tests__/api/v1/email/list.test.ts \
  __tests__/api/v1/email/schedule.test.ts \
  __tests__/api/v1/email/webhook.test.ts \
  __tests__/lib/email/resendWebhook.test.ts \
  __tests__/lib/email/resolveFrom.test.ts \
  __tests__/lib/email/unsubscribeToken.test.ts \
  __tests__/lib/email/preflight-amp.test.ts \
  __tests__/lib/broadcasts/send.test.ts \
  __tests__/api/cron-broadcasts.test.ts \
  __tests__/api/cron-emails-send-gates.test.ts \
  __tests__/api/cron-sequences.test.ts \
  __tests__/api/sequences.test.ts \
  __tests__/api/sequences-id.test.ts \
  __tests__/api/sequence-enrollments.test.ts \
  __tests__/api/v1/crm/cron/process-sequences.test.ts \
  __tests__/api/v1/crm/contacts-id-preferences.test.ts \
  __tests__/lib/crm/segments.test.ts \
  __tests__/lib/links/shorten.test.ts \
  __tests__/api/public/capture.test.ts \
  __tests__/api/v1/crm/capture-sources.test.ts \
  __tests__/api/v1/forms/submit.test.ts \
  __tests__/api/crm/contacts/send-email.test.ts \
  __tests__/api/crm/contacts/send-sms.test.ts \
  __tests__/api/v1/sms/status-webhook.test.ts \
  __tests__/lib/sms/twilio-readiness.test.ts
```

Expected result on 2026-05-25: 26 suites / 172 tests passed. Expected warnings in the local VPS/dev test runtime:

- `UNSUBSCRIBE_TOKEN_SECRET is not set; falling back to permissive mode (dev only)`
- `RESEND_WEBHOOK_SECRET is not set — accepting unsigned webhooks outside production only`
- `TWILIO_AUTH_TOKEN is not set — accepting unsigned webhooks` / skipping actual Twilio send

These warnings are acceptable for local non-sending regression. They are blockers for a production/live-send smoke unless the target runtime has the required secrets configured.

## Environment readiness check

Run:

```bash
npm run check:email-deliverability-env
```

The local VPS coding runtime on 2026-05-25 reported missing required env vars: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET`, `NEXT_PUBLIC_APP_URL`. Treat that as a local environment/config limitation, not a regression failure. Production or preview live-smoke readiness must be checked in the target deployment environment before any live sends.

## Build gate

Run the real Next.js production build after focused tests:

```bash
NODE_OPTIONS=--max-old-space-size=4096 NEXT_PRIVATE_BUILD_WORKER=1 npm run build
```

Expected result on 2026-05-25: build passed. Known non-blocking warning: `/og/default.png` uses `runtime = 'edge'` with `dynamic = 'force-static'`, which is unrelated to Email v2/v3.

## When to create Peet follow-up tasks

Create a Peet action task before live rollout only if the target deployment environment is missing one of the required values or external dashboard settings documented in `docs/deploy/email-deliverability-security-v3.md`:

- Vercel env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET`, `UNSUBSCRIBE_TOKEN_SECRET`, `NEXT_PUBLIC_APP_URL`.
- Resend dashboard: outbound event webhook and inbound reply route with signing enabled.
- Twilio dashboard/env when SMS live smoke is in scope.
- Cloudflare Turnstile server/source keys only for capture sources where Turnstile is intentionally enabled.

Do not paste secret values into Kanban comments, docs, or wiki notes.
