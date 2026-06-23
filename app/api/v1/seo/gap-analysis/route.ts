import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { runGapAnalysis } from '@/lib/seo/gap-analysis'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/v1/seo/gap-analysis
 * Body: { sprintId: string, competitorDomain: string, maxPages?: number }
 *
 * Crawls a competitor domain, extracts the keywords/topics they target, and
 * compares them against the sprint's tracked keywords to surface scored gaps.
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
  const competitorDomain = typeof body?.competitorDomain === 'string' ? body.competitorDomain : ''
  if (!sprintId) return apiError('sprintId is required', 400)
  if (!competitorDomain) return apiError('competitorDomain is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const result = await runGapAnalysis({
    competitorDomain,
    sprintId,
    maxPages: typeof body?.maxPages === 'number' ? body.maxPages : undefined,
  })
  return apiSuccess(result)
})
