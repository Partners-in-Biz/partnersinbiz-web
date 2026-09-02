import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { clientVisibilityFieldsForWrite, parseClientVisibility } from '@/lib/work-scope'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/v1/portal/seo/sprints/[id]/visibility  { clientVisibility }
 * Owner-org portal members toggle Shared / Keep private on their own sprint.
 * Projected (linked-org) viewers are refused — visibility belongs to the serving org.
 */
export const PATCH = withPortalAuthAndRole('member', async (req: NextRequest, _uid: string, orgId: string, _role, ctx: RouteCtx) => {
  try {
    const { id } = await ctx.params
    const ref = adminDb.collection('seo_sprints').doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Sprint not found', 404)
    const sprint = snap.data() ?? {}
    if (sprint.orgId !== orgId) return apiError('Only the owning organisation can change visibility', 403)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const fields = clientVisibilityFieldsForWrite(body.clientVisibility)
    if (Object.keys(fields).length === 0) return apiError('clientVisibility is required', 400)

    await ref.set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return apiSuccess({ id, clientVisibility: parseClientVisibility(body.clientVisibility) })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
