# Email deliverability/security v3 runbook

Status: production readiness checklist for the Email v3 platform. Outbound sending is provider-switched by `EMAIL_PROVIDER`; Production and the `development` Preview branch are currently configured for SES. Resend is still used for domain/admin APIs and Resend-specific inbound/outbound webhook paths until those are migrated or intentionally retired. Do not send live email while using this runbook unless Peet has approved a live-send test.

## Required environment

Set these in the target Vercel environment before live production traffic:

- `RESEND_API_KEY` — Resend API key used by outbound mail and domain APIs.
- `RESEND_WEBHOOK_SECRET` — Resend/Svix signing secret (`whsec_...`) for both `/api/v1/email/webhook` and `/api/v1/email/inbound-webhook`.
- `CRON_SECRET` — bearer token for `/api/cron/emails`, `/api/cron/sequences`, and `/api/cron/broadcasts`.
- `UNSUBSCRIBE_TOKEN_SECRET` — HMAC secret for unsubscribe and preference tokens.
- `NEXT_PUBLIC_APP_URL` — canonical app URL used for one-click unsubscribe/preference links.
- `EMAIL_PROVIDER=ses` — selects Amazon SES for the shared send adapter.
- `AWS_REGION=eu-north-1` — SES region for Partners in Biz.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — IAM credentials used by the SES adapter.
- `SES_CONFIGURATION_SET` — required for SES bounce/open/click event publishing.

Optional hardening:

- `RESEND_WEBHOOK_REQUIRE_SIGNATURE=true` — forces Svix signature verification in preview/dev too. Production fails closed automatically when `RESEND_WEBHOOK_SECRET` is missing.
- `EMAIL_PROVIDER=resend` — fallback/default; set only when intentionally forcing Resend outbound sends.

## Current provider state

- 2026-05-29: `EMAIL_PROVIDER=ses` was added in Vercel for Production and `Preview (development)`.
- Vercel already had SES credentials and configuration-set variables for Production and Preview.
- Existing live deployments may need a redeploy before they pick up changed environment variables.
- Last local historical note said AWS denied the original 50,000/day quota request on 2026-05-13. Recheck AWS Service Quotas before assuming more than the SES sandbox quota.

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

## Required external SES setup

1. Confirm `partnersinbiz.online` remains verified in SES in `eu-north-1`.
2. Confirm the account is out of sandbox or record the current 24-hour sending quota before bulk sends.
3. Confirm `SES_CONFIGURATION_SET` emits bounce/complaint/delivery/open/click events to SNS.
4. Confirm the SNS topic posts to `https://partnersinbiz.online/api/v1/email/webhook/ses` and the subscription is confirmed.

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
