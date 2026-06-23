import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { buildBacklinkProfile } from '@/lib/seo/backlink-profile'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/seo/backlinks?sprintId=...
 *
 * Returns the aggregated backlink profile for a sprint: referring domains,
 * new/lost counts, anchor distribution, DoFollow/NoFollow split.
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const sprintId = new URL(req.url).searchParams.get('sprintId')
  if (!sprintId) return apiError('sprintId is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const profile = await buildBacklinkProfile(sprintId)
  return apiSuccess(profile)
})
