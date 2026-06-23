/**
 * POST /api/v1/email/campaigns/[id]/test-send
 *
 * Renders an email campaign's stored block document to HTML and sends a TEST
 * copy to one or more addresses. Sample merge-variable values are injected so
 * `{{first_name}}` etc. resolve to readable placeholders. The subject is
 * prefixed with "[TEST] ".
 *
 * Body: { to: string | string[] }
 *
 * Auth: client (scoped to the campaign's org). Reuses lib/email/resolveFrom +
 * lib/email/resend (sendCampaignEmail) — no Resend logic is reimplemented here.
 */
import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { renderEmail } from '@/lib/email-builder/render'
import { validateDocument } from '@/lib/email-builder/validate'
import { resolveFrom } from '@/lib/email/resolveFrom'
import { sendCampaignEmail } from '@/lib/email/resend'
import { getBrandKitForOrg } from '@/lib/brand-kit/store'
import type { TemplateVars } from '@/lib/email/template'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Sample merge values so the test render shows readable content instead of
// raw `{{token}}` placeholders. Both snake_case and camelCase variants are
// provided to match whatever convention the document author used.
function sampleVars(orgName: string): TemplateVars {
  return {
    first_name: 'Alex',
    firstName: 'Alex',
    last_name: 'Morgan',
    lastName: 'Morgan',
    full_name: 'Alex Morgan',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    company: 'Acme Co',
    company_name: 'Acme Co',
    orgName,
    org_name: orgName,
    unsubscribeUrl: '#unsubscribe-preview',
    preferencesUrl: '#preferences-preview',
  }
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, context?: unknown) => {
  const { id } = await (context as Params).params
  const body = await req.json().catch(() => null)
  if (!body) return apiError('Invalid JSON', 400)

  const rawTo = Array.isArray(body.to) ? body.to : body.to != null ? [body.to] : []
  const recipients = [...new Set(
    rawTo
      .filter((v: unknown): v is string => typeof v === 'string')
      .map((v: string) => v.trim())
      .filter(Boolean),
  )] as string[]

  if (recipients.length === 0) return apiError('At least one recipient (to) is required', 400)
  if (recipients.length > 10) return apiError('A test send is limited to 10 recipients', 400)
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r))
  if (invalid.length) return apiError(`Invalid email address: ${invalid.join(', ')}`, 400)

  const snap = await adminDb.collection('campaigns').doc(id).get()
  if (!snap.exists || snap.data()?.deleted) return apiError('Campaign not found', 404)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaign = snap.data() as any
  const scope = resolveOrgScope(user, (campaign.orgId as string | undefined) ?? null)
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId

  if (!campaign.emailDocument) {
    return apiError('Campaign has no email content yet — design the email first', 422)
  }

  const validation = validateDocument(campaign.emailDocument)
  if (!validation.ok) {
    return apiError('Email content is invalid: ' + validation.errors.join('; '), 422)
  }

  const brandKit = await getBrandKitForOrg(orgId)
  const orgName = (campaign.fromName as string) || brandKit.brandName || 'Partners in Biz'
  const vars = sampleVars(orgName)

  // Subject precedence: explicit campaign.subject → document subject.
  const baseSubject =
    (typeof campaign.subject === 'string' && campaign.subject.trim()) ||
    validation.doc.subject ||
    '(no subject)'

  const { html, text } = renderEmail(validation.doc, vars)

  const sender = await resolveFrom({
    fromDomainId: typeof campaign.fromDomainId === 'string' ? campaign.fromDomainId : '',
    fromName: typeof campaign.fromName === 'string' ? campaign.fromName : undefined,
    fromLocal: typeof campaign.fromLocal === 'string' ? campaign.fromLocal : undefined,
    orgName,
  })

  const subject = `[TEST] ${baseSubject}`
  const results: Array<{ to: string; ok: boolean; error?: string }> = []

  for (const to of recipients) {
    const res = await sendCampaignEmail({
      from: sender.from,
      to,
      replyTo: typeof campaign.replyTo === 'string' && campaign.replyTo ? campaign.replyTo : undefined,
      subject,
      html,
      text,
    })
    results.push({ to, ok: res.ok, error: res.ok ? undefined : res.error })
  }

  const sent = results.filter((r) => r.ok).length
  const failed = results.length - sent

  return apiSuccess({
    sent,
    failed,
    results,
    usedFallbackDomain: sender.isFallback,
    fromDomain: sender.fromDomain,
    deliverabilityNote: sender.isFallback
      ? `Sent from the shared ${sender.fromDomain} domain. Verify a custom domain for production sends.`
      : `Sent from your verified domain ${sender.fromDomain}.`,
  })
})
