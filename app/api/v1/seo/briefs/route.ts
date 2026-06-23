import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import type { ContentBrief } from '@/lib/seo/content-brief'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/seo/briefs?sprintId=...  — list saved briefs for a sprint
 */
export const GET = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const sprintId = new URL(req.url).searchParams.get('sprintId')
  if (!sprintId) return apiError('sprintId is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const snap = await adminDb
    .collection('seo_briefs')
    .where('sprintId', '==', sprintId)
    .where('deleted', '==', false)
    .get()

  const briefs = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as Record<string, unknown> & { id: string })
    .sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')))

  return apiSuccess(briefs)
})

/**
 * POST /api/v1/seo/briefs  — save a generated brief
 * Body: { sprintId: string, brief: ContentBrief }
 */
export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser) => {
  const body = await req.json().catch(() => null)
  const sprintId = typeof body?.sprintId === 'string' ? body.sprintId : ''
  const brief = body?.brief as ContentBrief | undefined
  if (!sprintId) return apiError('sprintId is required', 400)
  if (!brief?.keyword || !brief?.title) return apiError('A valid brief is required', 400)

  const sprintSnap = await adminDb.collection('seo_sprints').doc(sprintId).get()
  if (!sprintSnap.exists) return apiError('Sprint not found', 404)
  const sprint = sprintSnap.data() as { orgId?: string }
  if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Forbidden', 403)

  const ref = await adminDb.collection('seo_briefs').add({
    sprintId,
    orgId: sprint.orgId,
    brief,
    keyword: brief.keyword,
    title: brief.title,
    savedAt: new Date().toISOString(),
    savedBy: user.uid ?? user.role,
    createdAt: FieldValue.serverTimestamp(),
    deleted: false,
  })

  return apiSuccess({ id: ref.id }, 201)
})
