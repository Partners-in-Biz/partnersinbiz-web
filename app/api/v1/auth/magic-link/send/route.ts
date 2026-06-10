// app/api/v1/auth/magic-link/send/route.ts
//
// PUBLIC endpoint — anyone can request a magic-link email. We rate-limit per
// email (3 / 15 min) to prevent abuse, and mint a single-use token that the
// verify endpoint will consume.
//
// Body: { email, redirectUrl?, context?, docTitle? }
//   - email: required, basic shape validation
//   - redirectUrl: where to land the user after they sign in
//   - context: optional context payload (e.g. { kind: 'client-doc', docId })
//   - docTitle: optional doc title used in the email subject/copy
//
// Always returns { sent: true } on success regardless of whether the email
// belongs to an existing user — we do not want to leak account existence.

import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { createMagicLink } from '@/lib/client-documents/magicLink'
import { buildMagicLinkEmail } from '@/lib/email/templates/magic-link'
import { sendEmail } from '@/lib/email/send'
import { checkAndIncrementRateLimit } from '@/lib/rateLimit'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'
import type { MagicLink } from '@/lib/client-documents/types'

export const dynamic = 'force-dynamic'

interface MagicLinkSendBody {
  email?: string
  redirectUrl?: string
  context?: MagicLink['context']
  docTitle?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as MagicLinkSendBody | null

  if (!body?.email || !EMAIL_RE.test(body.email)) {
    return apiError('Valid email required', 400)
  }

  const normalizedEmail = body.email.toLowerCase()
  const ipLimited = await enforcePublicRateLimit(req, {
    key: `magic_link_ip:${publicRequestIp(req)}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  })
  if (ipLimited) return ipLimited

  const limit = await checkAndIncrementRateLimit({
    key: `magic_link:${normalizedEmail}`,
    limit: 3,
    windowMs: 15 * 60 * 1000,
  })
  if (!limit.allowed) {
    return apiError('Too many sign-in requests. Try again in a few minutes.', 429)
  }

  const { token } = await createMagicLink({
    email: normalizedEmail,
    redirectUrl: body.redirectUrl,
    context: body.context,
  })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://partnersinbiz.online'
  const signInUrl = `${baseUrl}/api/v1/auth/magic-link/verify?token=${token}`

  const { subject, html } = buildMagicLinkEmail({ signInUrl, docTitle: body.docTitle })
  await sendEmail({
    to: normalizedEmail,
    subject,
    html,
  })

  return apiSuccess({ sent: true })
}
