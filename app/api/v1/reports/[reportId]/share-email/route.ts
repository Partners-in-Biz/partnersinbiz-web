// POST /api/v1/reports/:reportId/share-email (US-189)
//
// Share a report by email with an optional custom subject + personal message,
// using the share settings stored on the report. Distinct from /send (which is
// the legacy fixed-template path): this honours report.share.subject/message
// and the share enabled/expiry state, and supports a chosen template.
//
// Body: { to: string[], subject?, message?, template? }

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { sendCampaignEmail, FROM_ADDRESS } from '@/lib/email/resend'
import { getReport } from '@/lib/reports/generate'
import { isShareLive } from '@/lib/reports/share'
import { buildReportEmailHtml, buildReportEmailText } from '@/lib/reports/email'
import { renderTemplateSubject } from '@/lib/reports/templates'
import { REPORTS_COLLECTION } from '@/lib/reports/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type RouteContext = { params: Promise<{ reportId: string }> }

interface ShareEmailBody {
  to?: string[]
  subject?: string
  message?: string
  template?: string
}

function appBaseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || new URL(req.url).origin
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { reportId } = await (ctx as RouteContext).params
  const body = (await req.json().catch(() => ({}))) as ShareEmailBody & Record<string, unknown>
  const capabilityError = enforceAgentCapability(user, 'message_client', req, body)
  if (capabilityError) return capabilityError

  const recipients = (body.to ?? []).map(String).map((s) => s.trim()).filter(Boolean)
  if (recipients.length === 0) return NextResponse.json({ error: 'to[] required' }, { status: 400 })

  const report = await getReport(reportId)
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  if (!canAccessOrg(user, report.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!isShareLive(report)) {
    return NextResponse.json({ error: 'Public link is disabled or expired. Enable sharing first.' }, { status: 400 })
  }

  const link = `${appBaseUrl(req)}/reports/${report.publicToken}`
  const periodLabel = `${report.period.start} → ${report.period.end}`
  const subject =
    (typeof body.subject === 'string' && body.subject.trim()) ||
    report.share?.subject ||
    renderTemplateSubject(body.template, { org: report.brand.orgName, period: periodLabel })
  const personalMessage =
    (typeof body.message === 'string' && body.message.trim()) || report.share?.message || undefined

  const sendResult = await sendCampaignEmail({
    from: FROM_ADDRESS,
    to: recipients,
    subject,
    html: buildReportEmailHtml({ report, link, templateId: body.template, personalMessage }),
    text: buildReportEmailText({ report, link, templateId: body.template, personalMessage }),
  })
  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error ?? 'send failed' }, { status: 500 })
  }

  await adminDb.collection(REPORTS_COLLECTION).doc(reportId).update({
    status: 'sent',
    sentTo: FieldValue.arrayUnion(...recipients),
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return NextResponse.json({ ok: true, link, recipients })
})
