import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import { buildReportData, type ReportConfig } from '@/lib/seo/report-builder'
import { SeoReportPDF } from '@/lib/seo/pdf/SeoReport'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/v1/seo/reports/share/[token]  (PUBLIC, no auth)
 *
 * Streams the branded SEO report PDF for a shared report. The token is the only
 * credential; access is denied if sharing was disabled or the link has expired.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params
    if (!token) return apiError('Missing token', 400)

    const snap = await adminDb.collection('seo_reports').where('shareToken', '==', token).limit(1).get()
    if (snap.empty) return apiError('Report not found', 404)
    const doc = snap.docs[0]
    const data = doc.data() as Record<string, unknown>

    if (data.deleted) return apiError('Report not found', 404)
    const expiresAt = typeof data.shareExpiresAt === 'string' ? new Date(data.shareExpiresAt).getTime() : null
    if (!expiresAt || expiresAt < Date.now()) return apiError('This share link has expired', 410)

    const config: ReportConfig = {
      clientName: String(data.clientName ?? ''),
      brandColor: (data.brandColor as string) ?? undefined,
      logoDataUrl: (data.logoDataUrl as string) ?? undefined,
      from: String(data.from ?? ''),
      to: String(data.to ?? ''),
      sections: (data.sections as ReportConfig['sections']) ?? { traffic: true, rankings: true, backlinks: true },
    }

    const reportData = await buildReportData(String(data.sprintId), config)
    const buffer = await renderToBuffer(
      createElement(SeoReportPDF, { data: reportData }) as unknown as ReactElement<DocumentProps>,
    )

    const safe = (reportData.clientName || 'seo-report').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="seo-report-${safe}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
}
