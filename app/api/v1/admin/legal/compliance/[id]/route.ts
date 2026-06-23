/**
 * PATCH  /api/v1/admin/legal/compliance/[id]  — edit config (name/type/schedule/contents)
 * DELETE /api/v1/admin/legal/compliance/[id]  — delete config
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, cleanStr } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'compliance_reports'
const VALID_TYPES = ['gdpr', 'data_retention', 'security', 'access_audit']
const VALID_SCHEDULES = ['manual', 'weekly', 'monthly']
type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withAuth('admin', async (req: NextRequest, _user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Report config not found', 404)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
    const b = body as Record<string, unknown>

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (typeof b.name === 'string') update.name = cleanStr(b.name, 200)
    if (typeof b.type === 'string') {
      const type = cleanStr(b.type, 30)
      if (!VALID_TYPES.includes(type)) return apiError(`type must be one of ${VALID_TYPES.join(', ')}`, 400)
      update.type = type
    }
    if (typeof b.schedule === 'string') {
      const schedule = cleanStr(b.schedule, 20)
      if (!VALID_SCHEDULES.includes(schedule)) return apiError(`schedule must be one of ${VALID_SCHEDULES.join(', ')}`, 400)
      update.schedule = schedule
    }
    if (Array.isArray(b.contents)) {
      update.contents = (b.contents as unknown[]).map((c) => cleanStr(c, 60)).filter(Boolean)
    }

    await ref.update(update)
    const saved = await ref.get()
    return apiSuccess({ report: serializeGovernance({ id, ...saved.data() }) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, _user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Report config not found', 404)
    await ref.delete()
    return apiSuccess({ id, deleted: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
