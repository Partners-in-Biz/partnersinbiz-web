import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { refreshAndCompare } from '@/lib/seo/competitors'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/v1/seo/competitors/refresh  — refresh metrics for all tracked
 * competitors and return the full comparison (DA, keywords, backlinks, overlap).
 * Body: { sprintId }
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
  if (!sprintId) return apiError('sprintId is required', 400)

  const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!snap.exists) return apiError('Sprint not found', 404)
  const sprint = snap.data() as { orgId?: string; siteUrl?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const comparison = await refreshAndCompare(sprintId, sprint.siteUrl ?? '')
  return apiSuccess(comparison)
})
