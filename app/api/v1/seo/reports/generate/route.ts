import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { buildReportData, type ReportConfig } from '@/lib/seo/report-builder'
import { SeoReportPDF } from '@/lib/seo/pdf/SeoReport'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/v1/seo/reports/generate
 * Body: { sprintId: string, config: ReportConfig }
 *
 * Builds and streams a branded SEO report PDF for the supplied config without
 * persisting it (live preview / one-off download).
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  try {
    const body = await req.json().catch(() => null)
    const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
    const config = body?.config as ReportConfig | undefined
    if (!sprintId) return apiError('sprintId is required', 400)
    if (!config?.from || !config?.to || !config?.sections) return apiError('A valid report config is required', 400)

    const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
    if (!sprintSnap.exists) return apiError('Sprint not found', 404)
    const sprint = sprintSnap.data() as { orgId?: string }
    if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

    const data = await buildReportData(sprintId, config)
    const buffer = await renderToBuffer(
      createElement(SeoReportPDF, { data }) as unknown as ReactElement<DocumentProps>,
    )

    const safe = (data.clientName || 'seo-report').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="seo-report-${safe}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
