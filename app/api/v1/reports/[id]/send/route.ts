// POST /api/v1/reports/:id/send  { to: string[] }
//
// Email a report public link via Resend. Marks status='sent'.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { enforceAgentCapability } from '@/lib/api/capabilityGate'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { sendCampaignEmail, FROM_ADDRESS } from '@/lib/email/resend'
import { getReport } from '@/lib/reports/generate'
import { REPORTS_COLLECTION } from '@/lib/reports/types'
import type { ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type RouteContext = { params: Promise<{ id: string }> }

interface SendBody {
  to: string[]
}

function appBaseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_BASE_URL ||
    new URL(req.url).origin
  )
}

const fmtZar = (n: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)

const fmtPct = (p: number | null) => {
  if (p === null) return '—'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function emailHtml(report: Awaited<ReturnType<typeof getReport>>, link: string): string {
  if (!report) return ''
  const k = report.kpis
  const accent = report.brand.accent
  return `<!doctype html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#0A0A0B;color:#EDEDED;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px">
    <p style="margin:0 0 24px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#9a9a9a">Monthly performance report</p>
    <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:34px;line-height:1.1;font-weight:400">${report.brand.orgName}</h1>
    <p style="margin:0 0 32px;font-size:14px;color:#9a9a9a">${report.period.start} → ${report.period.end}</p>

    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 32px">
      <tr>
        <td style="background:rgba(255,255,255,0.04);padding:14px 16px;border-radius:10px">
          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#9a9a9a;margin-bottom:4px">Total revenue</div>
          <div style="font-size:22px;font-family:Georgia,serif">${fmtZar(k.total_revenue)}</div>
          <div style="font-size:11px;color:${(k.deltas.total_revenue ?? 0) >= 0 ? '#86efac' : '#fda4af'};margin-top:4px;font-family:monospace">${fmtPct(k.deltas.total_revenue)} vs prior</div>
        </td>
      </tr>
    </table>

    <p style="font-size:14px;line-height:1.6;color:#cccccc;margin:0 0 32px">${
      report.exec_summary.split('\n\n')[0] || ''
    }</p>

    <p>
      <a href="${link}" style="display:inline-block;background:${accent};color:#000;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">View the full report →</a>
    </p>

    <p style="margin:48px 0 0;padding-top:24px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;color:#666;font-family:monospace">
      Partners in Biz · partnersinbiz.online · No tracking, no fluff.
    </p>
  </div>
</body></html>`
}

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const body = (await req.json().catch(() => ({}))) as SendBody & Record<string, unknown>
  const capabilityError = enforceAgentCapability(user, 'message_client', req, body)
  if (capabilityError) return capabilityError
  const recipients = (body.to ?? []).map(String).map((s) => s.trim()).filter(Boolean)
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'to[] required' }, { status: 400 })
  }
  const report = await getReport(id)
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  if (!canAccessOrg(user, report.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!report.publicToken) {
    return NextResponse.json({ error: 'Report has no public token' }, { status: 400 })
  }

  const link = `${appBaseUrl(req)}/reports/${report.publicToken}`

  const sendResult = await sendCampaignEmail({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `${report.brand.orgName} · Performance report · ${report.period.start} → ${report.period.end}`,
    html: emailHtml(report, link),
    text: `${report.brand.orgName} — performance report for ${report.period.start} to ${report.period.end}.\n\n${report.exec_summary}\n\nFull report: ${link}\n\n— Partners in Biz`,
  })
  if (!sendResult.ok) {
    return NextResponse.json(
      { error: sendResult.error ?? 'send failed' },
      { status: 500 },
    )
  }

  await adminDb.collection(REPORTS_COLLECTION).doc(id).update({
    status: 'sent',
    sentTo: FieldValue.arrayUnion(...recipients),
    sentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  return NextResponse.json({ ok: true, link, recipients })
})
