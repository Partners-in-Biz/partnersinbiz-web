// lib/email/resendWebhook.ts
//
// Shared Resend webhook signature guard for both outbound event webhooks and
// inbound Routes webhooks. Resend signs both with Svix headers. Development and
// preview can intentionally run unsigned, but production must never accept an
// unsigned webhook because those routes mutate contacts, suppressions, and
// sequence enrollments.

import { Webhook } from 'svix'

export interface ResendWebhookVerificationResult {
  ok: boolean
  status?: number
  error?: string
  warning?: string
}

export function isResendWebhookSignatureRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit = (env.RESEND_WEBHOOK_REQUIRE_SIGNATURE ?? '').trim().toLowerCase()
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') return true
  if (explicit === 'false' || explicit === '0' || explicit === 'no') return false

  // Vercel sets VERCEL_ENV=production only for the live production deployment.
  // When VERCEL_ENV is unavailable, fall back to NODE_ENV=production so other
  // hosts fail closed unless they explicitly opt out for preview/dev.
  if ((env.VERCEL_ENV ?? '').trim().toLowerCase() === 'production') return true
  if (!env.VERCEL_ENV && env.NODE_ENV === 'production') return true
  return false
}

export function verifyResendWebhookSignature(args: {
  rawBody: string
  headers: {
    'svix-id': string
    'svix-timestamp': string
    'svix-signature': string
  }
  routeLabel: string
  env?: NodeJS.ProcessEnv
}): ResendWebhookVerificationResult {
  const env = args.env ?? process.env
  const secret = env.RESEND_WEBHOOK_SECRET?.trim()

  if (!secret) {
    if (isResendWebhookSignatureRequired(env)) {
      return {
        ok: false,
        status: 500,
        error: 'Webhook signature secret is not configured',
      }
    }
    return {
      ok: true,
      warning: `[${args.routeLabel}] RESEND_WEBHOOK_SECRET is not set — accepting unsigned webhooks outside production only. Set this before production traffic.`,
    }
  }

  try {
    new Webhook(secret).verify(args.rawBody, args.headers)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid signature',
      warning: `[${args.routeLabel}] signature verification failed: ${(err as Error)?.message ?? String(err)}`,
    }
  }
}
