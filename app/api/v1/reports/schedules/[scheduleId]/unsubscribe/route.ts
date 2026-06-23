// /api/v1/reports/schedules/:scheduleId/unsubscribe (US-177)
//
// GET  ?email=&token=  — public one-click unsubscribe from an email link (no auth,
//                        validated by HMAC token). Returns a small HTML confirmation.
// POST { email }       — admin-side unsubscribe (authenticated via the admin UI).

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import {
  getSchedule,
  unsubscribeFromSchedule,
  verifyUnsubscribeToken,
} from '@/lib/reports/schedule'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ scheduleId: string }> }

function htmlPage(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="margin:0;background:#0A0A0B;color:#EDEDED;font-family:Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:80px 24px;text-align:center">
<h1 style="font-family:Georgia,serif;font-weight:400;font-size:28px">${title}</h1>
<p style="color:#9a9a9a;font-size:15px;line-height:1.6">${body}</p>
<p style="margin-top:48px;font-size:11px;color:#666;font-family:monospace">Partners in Biz</p>
</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { scheduleId } = await ctx.params
  const url = new URL(req.url)
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase()
  const token = url.searchParams.get('token') ?? ''
  if (!email || !token || !verifyUnsubscribeToken(scheduleId, email, token)) {
    return htmlPage('Invalid link', 'This unsubscribe link is invalid or has expired.', 400)
  }
  const ok = await unsubscribeFromSchedule(scheduleId, email)
  if (!ok) return htmlPage('Not found', 'That report schedule no longer exists.', 404)
  return htmlPage(
    'Unsubscribed',
    `You will no longer receive this scheduled report at <strong>${email}</strong>.`,
  )
}

export const POST = withAuth('admin', async (req: NextRequest, user, ctx) => {
  const { scheduleId } = await (ctx as RouteContext).params
  const schedule = await getSchedule(scheduleId)
  if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, schedule.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const ok = await unsubscribeFromSchedule(scheduleId, email)
  return NextResponse.json({ ok })
})
