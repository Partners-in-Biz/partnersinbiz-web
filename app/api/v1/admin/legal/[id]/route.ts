/**
 * GET    /api/v1/admin/legal/[id]  — fetch one legal document version
 * PATCH  /api/v1/admin/legal/[id]  — edit title/body/effectiveDate (DRAFT only)
 * DELETE /api/v1/admin/legal/[id]  — delete a DRAFT version
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, cleanStr } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'legal_documents'
type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth('admin', async (_req: NextRequest, _user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const snap = await adminDb.collection(COLLECTION).doc(id).get()
    if (!snap.exists) return apiError('Legal document not found', 404)
    return apiSuccess({ version: serializeGovernance({ id: snap.id, ...snap.data() }) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withAuth('admin', async (req: NextRequest, _user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Legal document not found', 404)
    if (snap.data()?.status !== 'draft') return apiError('Only draft versions can be edited', 409)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)
    const b = body as Record<string, unknown>

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (typeof b.title === 'string') update.title = cleanStr(b.title, 300)
    if (typeof b.body === 'string') update.body = cleanStr(b.body, 200000)
    if (typeof b.effectiveDate === 'string') update.effectiveDate = cleanStr(b.effectiveDate, 60) || null

    await ref.update(update)
    const saved = await ref.get()
    return apiSuccess({ version: serializeGovernance({ id, ...saved.data() }) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withAuth('admin', async (_req: NextRequest, _user: ApiUser, ctx: RouteContext) => {
  try {
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Legal document not found', 404)
    if (snap.data()?.status !== 'draft') return apiError('Only draft versions can be deleted', 409)
    await ref.delete()
    return apiSuccess({ id, deleted: true })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
