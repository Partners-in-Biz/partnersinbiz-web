import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import { MODULE_COLLECTIONS } from '@/lib/company-work/projection'
import { clientVisibilityFieldsForWrite, parseClientVisibility } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ module: string; id: string }> }

type OwnedRecord =
  | { error: Response }
  | { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }

async function loadOwnedRecord(moduleParam: string, id: string, orgId: string): Promise<OwnedRecord> {
  const collection = MODULE_COLLECTIONS[moduleParam.trim() as SharedBusinessCapability]
  if (!collection) return { error: apiError('Unknown module', 400) }
  const ref = adminDb.collection(collection).doc(id)
  const snap = await ref.get()
  if (!snap.exists) return { error: apiError('Record not found', 404) }
  const data = snap.data() ?? {}
  if (data.deleted === true) return { error: apiError('Record not found', 404) }
  if (data.orgId !== orgId) return { error: apiError('Only the owning organisation can change visibility', 403) }
  return { ref, data }
}

/**
 * GET  /api/v1/portal/company-work/[module]/[id]/visibility
 *   → { companyId, clientVisibility } for the owning org's record.
 * PATCH … { clientVisibility: 'shared' | 'private' }
 *   Owner-org members toggle Shared / Keep private. Projected viewers are refused.
 */
export const GET = withPortalAuthAndRole('viewer', async (_req: NextRequest, _uid: string, orgId: string, _role, ctx: RouteCtx): Promise<Response> => {
  try {
    const { module: moduleParam, id } = await ctx.params
    const loaded = await loadOwnedRecord(moduleParam, id, orgId)
    if ('error' in loaded) return loaded.error
    return apiSuccess({
      id,
      companyId: typeof loaded.data.companyId === 'string' ? loaded.data.companyId : null,
      clientVisibility: parseClientVisibility(loaded.data.clientVisibility),
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const PATCH = withPortalAuthAndRole('member', async (req: NextRequest, _uid: string, orgId: string, _role, ctx: RouteCtx): Promise<Response> => {
  try {
    const { module: moduleParam, id } = await ctx.params
    const loaded = await loadOwnedRecord(moduleParam, id, orgId)
    if ('error' in loaded) return loaded.error

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const fields = clientVisibilityFieldsForWrite(body.clientVisibility)
    if (Object.keys(fields).length === 0) return apiError('clientVisibility is required', 400)

    await loaded.ref.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return apiSuccess({ id, clientVisibility: parseClientVisibility(body.clientVisibility) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
