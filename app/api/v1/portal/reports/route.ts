// GET /api/v1/portal/reports
//
// Tenant-scoped generated reports for the client portal.

import { NextRequest, NextResponse } from 'next/server'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { listReports } from '@/lib/reports/generate'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('viewer', async (req: NextRequest, _uid: string, orgId: string) => {
  const limit = Math.max(1, Math.min(100, parseInt(new URL(req.url).searchParams.get('limit') ?? '24', 10)))
  const reports = await listReports(orgId, limit).catch(() => [])

  return NextResponse.json({
    ok: true,
    reports: reports.map((r) => ({
      id: r.id,
      type: r.type,
      period: r.period,
      status: r.status,
      publicToken: r.publicToken,
      kpis: { total_revenue: r.kpis.total_revenue, mrr: r.kpis.mrr },
      sentAt: r.sentAt,
      createdAt: r.createdAt,
    })),
  })
})
