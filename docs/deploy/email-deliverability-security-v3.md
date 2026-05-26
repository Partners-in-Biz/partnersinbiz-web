# Email deliverability/security v3 runbook

Status: production readiness checklist for Resend deliverability, webhook security, suppressions, inbound replies, and sequence auto-pause. Do not send live email while using this runbook unless Peet has approved a live-send test.

## Required environment

Set these in the target Vercel environment before live production traffic:

- `RESEND_API_KEY` — Resend API key used by outbound mail and domain APIs.
- `RESEND_WEBHOOK_SECRET` — Resend/Svix signing secret (`whsec_...`) for both `/api/v1/email/webhook` and `/api/v1/email/inbound-webhook`.
- `CRON_SECRET` — bearer token for `/api/cron/emails`, `/api/cron/sequences`, and `/api/cron/broadcasts`.
- `UNSUBSCRIBE_TOKEN_SECRET` — HMAC secret for unsubscribe and preference tokens.
- `NEXT_PUBLIC_APP_URL` — canonical app URL used for one-click unsubscribe/preference links.

Optional hardening:

- `RESEND_WEBHOOK_REQUIRE_SIGNATURE=true` — forces Svix signature verification in preview/dev too. Production fails closed automatically when `RESEND_WEBHOOK_SECRET` is missing.
- `EMAIL_PROVIDER=resend` — default; set explicitly when confirming Resend-only behavior.

## Required external Resend setup

1. Verify every sending domain in Resend before assigning it to an org sender.
2. Register outbound event webhook:
   - URL: `https://partnersinbiz.online/api/v1/email/webhook`
   - Events: delivered, opened, clicked, bounced, delivery_delayed, complained.
   - Copy the signing secret to `RESEND_WEBHOOK_SECRET`.
3. Register inbound route for replies:
   - Forward reply mailbox/domain such as `reply.<sending-domain>` to `https://partnersinbiz.online/api/v1/email/inbound-webhook`.
   - Use the same Resend signing setup; do not disable signing in production.
4. Configure Vercel cron for email, sequence, and broadcast processors with `Authorization: Bearer $CRON_SECRET`.

## Verification checklist

Code-level checks that should pass before production rollout:

1. List-Unsubscribe headers:
   - Broadcast path calls `sendCampaignEmail(... listUnsubscribeUrl)`.
   - Sequence cron calls `sendCampaignEmail(... listUnsubscribeUrl)`.
   - Provider adapters merge `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
2. Webhook security:
   - Outbound `/api/v1/email/webhook` reads raw body and verifies Svix headers.
   - Inbound `/api/v1/email/inbound-webhook` reads raw body and verifies Svix headers.
   - Production without `RESEND_WEBHOOK_SECRET` returns a configuration error instead of accepting unsigned mutations.
3. Bounce/complaint categorization:
   - Hard/permanent bounce creates permanent `hard-bounce` suppression.
   - Soft/transient/undetermined bounce creates a 24h temporary `soft-bounce` suppression.
   - Complaint marks contact unsubscribed and creates permanent `complaint` suppression.
4. Suppression gates:
   - Broadcast per-contact send checks `isSuppressed` immediately before sending.
   - Sequence cron checks `isSuppressed` before advancing/sending.
   - Audience resolution should exclude suppressed contacts before per-contact send.
5. Inbound reply routing:
   - Inbound webhook writes `inbound_emails` before processing so messages are not lost.
   - Reply intent pauses active sequence enrollments with `exitReason='replied'` and updates contact reply stats.
   - Auto-replies are logged but do not pause enrollments.
   - Unsubscribe replies create a permanent suppression and pause active enrollments with `exitReason='unsubscribed'`.

## Safe production smoke test

Only after Peet approves a live-send test:

1. Send one approved test email to a controlled address through a verified domain.
2. Confirm the received message includes `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
3. Reply from the controlled inbox.
4. Confirm `inbound_emails` has the reply, the matching contact has `lastRepliedAt`, and active sequence enrollments for that contact are paused.
5. Trigger one signed Resend webhook test from the Resend dashboard and confirm `/api/v1/email/webhook` returns success.
6. Do not manually fabricate production webhook payloads unless the Svix signature is generated from the real signing secret.

## Blocker handoff wording

If any required env var or Resend dashboard setting is missing, create a Peet action task/comment with:

- Missing item name.
- Where to set it: Vercel Environment Variables or Resend Dashboard.
- Exact endpoint/URL involved.
- Proof required after completion, e.g. screenshot of configured webhook route, Vercel env presence, or a signed Resend test webhook success.
- Reminder: do not paste secrets into Kanban comments.
