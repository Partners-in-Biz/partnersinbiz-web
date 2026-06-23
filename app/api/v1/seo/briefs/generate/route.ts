import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { generateContentBrief } from '@/lib/seo/content-brief'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/v1/seo/briefs/generate
 * Body: { keyword: string, targetUrl?: string, competitor?: string, sprintId?: string }
 *
 * Generates a structured AI content brief. If sprintId is supplied it is used
 * only for org-scope validation; the brief is returned, not persisted (use
 * POST /api/v1/seo/briefs to save).
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : ''
  if (!keyword) return apiError('keyword is required', 400)

  if (typeof body?.sprintId === 'string' && body.sprintId) {
    const sprintSnap = await adminDb.collection('seo_sprints').doc(body.sprintId).get()
    if (sprintSnap.exists) {
      const sprint = sprintSnap.data() as { orgId?: string }
      if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)
    }
  }

  const brief = await generateContentBrief({
    keyword,
    targetUrl: typeof body?.targetUrl === 'string' ? body.targetUrl : undefined,
    competitor: typeof body?.competitor === 'string' ? body.competitor : undefined,
  })
  return apiSuccess(brief)
})
