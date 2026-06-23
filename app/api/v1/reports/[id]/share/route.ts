// /api/v1/reports/:id/share (US-189)
//   GET   — current share settings + open stats
//   PATCH — update share settings (public toggle, expiry, subject, message)
//   POST  — token control: { action: 'disable' | 'regenerate' }

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getReport } from '@/lib/reports/generate'
import { invalidateToken, updateShareSettings, listReportOpens } from '@/lib/reports/share'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const report = await getReport(id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, report.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const opens = await listReportOpens(id, 50)
  return NextResponse.json({
    ok: true,
    publicToken: report.publicToken,
    share: report.share ?? { enabled: Boolean(report.publicToken), expiresAt: null },
    openCount: report.openCount ?? 0,
    uniqueOpenCount: report.uniqueOpenCount ?? 0,
    opens,
  })
})

interface PatchBody {
  enabled?: boolean
  expiresAt?: string | null
  subject?: string
  message?: string
}

export const PATCH = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const report = await getReport(id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, report.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as PatchBody
  await updateShareSettings(id, body)
  const updated = await getReport(id)
  return NextResponse.json({ ok: true, share: updated?.share, publicToken: updated?.publicToken })
})

interface TokenBody {
  action?: 'disable' | 'regenerate'
}

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const report = await getReport(id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, report.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as TokenBody
  const regenerate = body.action === 'regenerate'
  const { publicToken } = await invalidateToken(id, regenerate)
  return NextResponse.json({ ok: true, publicToken })
})
