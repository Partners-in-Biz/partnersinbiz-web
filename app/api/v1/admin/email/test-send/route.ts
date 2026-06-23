/**
 * POST /api/v1/admin/email/test-send — send a one-off test/preview email.
 *   Body: { to, subject, html, vars? }
 *
 * Used by the broadcast composer and template editor "send test" actions.
 * Sends through the REAL provider wrapper (`sendCampaignEmail` →
 * lib/email/provider → Resend/SES). Merge tags in subject/html are
 * interpolated with `vars` (or sensible defaults) via the shared
 * lib/email/template interpolate() so the test mirrors a real send.
 *
 * Sends from the shared PIB sender (SHARED_SENDER_*). Respects the global
 * pause-outbound kill-switch — a paused platform refuses test sends too.
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import {
  sendCampaignEmail,
  htmlToPlainText,
  plainTextToHtml,
} from '@/lib/email/resend'
import { interpolate, type TemplateVars } from '@/lib/email/template'
import {
  SHARED_SENDER_DOMAIN,
  SHARED_SENDER_LOCAL,
  SHARED_SENDER_NAME,
} from '@/lib/platform/constants'
import { readEmailControls } from '../controls/store'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const POST = withAuth('admin', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  const to = (typeof body.to === 'string' ? body.to : '').trim()
  const subjectRaw = (typeof body.subject === 'string' ? body.subject : '').trim()
  const htmlRaw = typeof body.html === 'string' ? body.html : ''

  if (!EMAIL_RE.test(to)) return apiError('A valid "to" address is required')
  if (!subjectRaw) return apiError('subject is required')
  if (!htmlRaw.trim()) return apiError('html content is required')

  const controls = await readEmailControls()
  if (controls.pauseOutbound) {
    return apiError(
      'Outbound email is paused platform-wide. Resume sending before issuing test emails.',
      409,
    )
  }

  // Default preview vars; caller-supplied vars override.
  const vars: TemplateVars = {
    firstName: 'there',
    lastName: '',
    email: to,
    name: 'there',
    ...(body.vars && typeof body.vars === 'object' ? (body.vars as TemplateVars) : {}),
  }

  const subject = interpolate(subjectRaw, vars)
  const html = interpolate(htmlRaw, vars)
  const text = htmlToPlainText(html) || htmlToPlainText(plainTextToHtml(html))

  const from = `${SHARED_SENDER_NAME} <${SHARED_SENDER_LOCAL}@${SHARED_SENDER_DOMAIN}>`

  const result = await sendCampaignEmail({
    from,
    to,
    subject: `[TEST] ${subject}`,
    html,
    text,
  })

  if (!result.ok) {
    return apiError(result.error || 'Provider rejected the test send', 502)
  }

  return apiSuccess({
    sent: true,
    to,
    provider: result.provider,
    messageId: result.resendId,
  })
})
