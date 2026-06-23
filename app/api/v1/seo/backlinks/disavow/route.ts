import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { buildDisavowFile } from '@/lib/seo/backlink-profile'

export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/seo/backlinks/disavow
 * Body: { sprintId: string, domains: string[] }
 *
 * Returns a Google Search Console disavow file (text/plain) for the supplied
 * domains, scoped to the sprint's site.
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
  const domains: string[] = Array.isArray(body?.domains) ? body.domains.filter((d: unknown) => typeof d === 'string') : []
  if (!sprintId) return apiError('sprintId is required', 400)
  if (domains.length === 0) return apiError('Select at least one domain to disavow', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string; siteUrl?: string; siteName?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const file = buildDisavowFile(domains, sprint.siteName || sprint.siteUrl || sprintId)
  return new NextResponse(file, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="disavow-${sprintId}.txt"`,
      'Cache-Control': 'no-store',
    },
  })
})
