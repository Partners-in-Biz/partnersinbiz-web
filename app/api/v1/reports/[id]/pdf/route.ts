// GET /api/v1/reports/:id/pdf (US-175 per-report PDF download)
//
// Renders the report to a branded PDF and streams it as an attachment.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { getReport } from '@/lib/reports/generate'
import { renderReportPdf } from '@/lib/reports/pdf'
import type { ApiUser } from '@/lib/api/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
// react-pdf needs the Node runtime (uses Node streams / fontkit).
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, user: ApiUser, ctx) => {
  const { id } = await (ctx as RouteContext).params
  const report = await getReport(id)
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canAccessOrg(user, report.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const pdf = await renderReportPdf(report)
  const safeName = `${report.brand.orgName}-${report.period.start}-${report.period.end}`
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .slice(0, 80)

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${safeName}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
})
