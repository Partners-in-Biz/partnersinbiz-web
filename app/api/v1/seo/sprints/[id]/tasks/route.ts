import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withIdempotency } from '@/lib/api/idempotency'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { inheritSprintCompanyFields } from '@/lib/seo/tenant'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  'admin',
  async (req: NextRequest, user: ApiUser, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const u = new URL(req.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = adminDb.collection('seo_tasks').where('sprintId', '==', id).where('deleted', '==', false)
    for (const f of ['week', 'phase', 'status', 'source', 'taskType'] as const) {
      const v = u.searchParams.get(f)
      if (v != null) q = q.where(f, '==', f === 'week' || f === 'phase' ? Number(v) : v)
    }
    const snap = await q.get()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
    // Tenancy filter
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
    if (typeof body.week !== 'number') return apiError('week (number) is required', 400)
    const ref = await adminDb.collection('seo_tasks').add({
      sprintId: id,
      orgId: sprint.orgId,
      week: body.week,
      phase: body.phase ?? 4,
      focus: body.focus ?? 'Custom',
      title: body.title,
      description: body.description ?? null,
      taskType: body.taskType ?? 'custom',
      autopilotEligible: body.autopilotEligible ?? false,
      status: 'not_started',
      source: 'manual',
      createdAt: FieldValue.serverTimestamp(),
      deleted: false,
      ...inheritSprintCompanyFields(sprint),
      ...actorFrom(user),
    })
    return apiSuccess({ id: ref.id }, 201)
  }),
)
