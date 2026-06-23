import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { BriefReportPDF } from '@/lib/seo/pdf/BriefReport'
import type { ContentBrief } from '@/lib/seo/content-brief'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/v1/seo/briefs/pdf
 * Body: { brief: ContentBrief, clientName?: string }
 *
 * Renders a content brief to a branded PDF and streams it back.
 */
export const POST = withAuth('admin', async (req: NextRequest, _user: ApiUser) => {
  try {
    const body = await req.json().catch(() => null)
    const brief = body?.brief as ContentBrief | undefined
    if (!brief?.keyword || !brief?.title || !Array.isArray(brief?.h2Outline)) {
      return apiError('A valid brief is required', 400)
    }
    const clientName = typeof body?.clientName === 'string' ? body.clientName : undefined

    const buffer = await renderToBuffer(
      createElement(BriefReportPDF, { brief, clientName }) as unknown as ReactElement<DocumentProps>,
    )

    const safe = brief.keyword.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="content-brief-${safe}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
