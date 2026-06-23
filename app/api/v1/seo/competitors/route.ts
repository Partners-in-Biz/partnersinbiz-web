import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { addCompetitor, listCompetitors } from '@/lib/seo/competitors'

export const dynamic = 'force-dynamic'

type SprintResolution =
  | { ok: true; orgId: string; siteUrl: string }
  | { ok: false; response: NextResponse }

async function resolveSprint(sprintId: string, user: ApiUser): Promise<SprintResolution> {
  const snap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!snap.exists) return { ok: false, response: apiError('Sprint not found', 404) }
  const sprint = snap.data() as { orgId?: string; siteUrl?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return { ok: false, response: apiError('Forbidden', 403) }
  return { ok: true, orgId: sprint.orgId ?? '', siteUrl: sprint.siteUrl ?? '' }
}

/** GET /api/v1/seo/competitors?sprintId=...  — list tracked competitors. */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const sprintId = new URL(req.url).searchParams.get('sprintId')
  if (!sprintId) return apiError('sprintId is required', 400)
  const r = await resolveSprint(sprintId, user)
  if (!r.ok) return r.response
  const competitors = await listCompetitors(sprintId)
  return apiSuccess({ competitors })
})

/** POST /api/v1/seo/competitors  — add a competitor. Body: { sprintId, domain } */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
  const domain = typeof body?.domain === 'string' ? body.domain : ''
  if (!sprintId) return apiError('sprintId is required', 400)
  if (!domain) return apiError('domain is required', 400)
  const r = await resolveSprint(sprintId, user)
  if (!r.ok) return r.response

  const result = await addCompetitor(sprintId, r.orgId, domain)
  if ('error' in result) return apiError(result.error, 400)
  return apiSuccess(result, 201)
})
