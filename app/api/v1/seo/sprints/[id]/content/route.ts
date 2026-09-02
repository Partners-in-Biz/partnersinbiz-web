import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { inheritSprintCompanyFields } from '@/lib/seo/tenant'
import { clientVisibilityFieldsForWrite } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (_req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const snap = await adminDb
      .collection('seo_content')
      .where('sprintId', '==', id)
      .where('deleted', '==', false)
      .get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = user.role === 'ai' || !user.orgId ? data : data.filter((d: any) => d.orgId === user.orgId)
    return apiSuccess(filtered, 200, { total: filtered.length, page: 1, limit: filtered.length })
  },
)

export const POST = withAuth(
  'admin',
  withIdempotency(async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const sprintSnap = await adminDb.collection('seo_sprints').doc(id).get()
    if (!sprintSnap.exists) return apiError('Sprint not found', 404)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sprint = sprintSnap.data() as any
    if (user.role !== 'ai' && sprint.orgId !== user.orgId) return apiError('Access denied', 403)
    const body = await req.json().catch(() => null)
    if (!body?.title) return apiError('title is required', 400)
    const ref = await adminDb.collection('seo_content').add({
      sprintId: id,
      orgId: sprint.orgId,
      title: body.title,
      type: body.type ?? 'how-to',
      targetKeywordId: body.targetKeywordId ?? null,
      targetUrl: body.targetUrl ?? null,
      publishDate: body.publishDate ?? null,
      status: body.status ?? 'idea',
      internalLinksAdded: false,
      campaignId: typeof body.campaignId === 'string' ? body.campaignId : null,
      pillarId: typeof body.pillarId === 'string' ? body.pillarId : null,
      createdAt: FieldValue.serverTimestamp(),
      deleted: false,
      ...inheritSprintCompanyFields(sprint),
      ...clientVisibilityFieldsForWrite(body.clientVisibility),
      ...actorFrom(user),
    })
    return apiSuccess({ id: ref.id }, 201)
  }),
)
