/**
 * POST /api/v1/admin/legal/[id]/publish  (super-admin)
 *
 * Publish a legal document version:
 *  - set status='published', publishedAt=now, effectiveDate (from body or now)
 *  - demote any previously-published version of the SAME docType to 'archived'
 */
import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { ApiUser } from '@/lib/api/types'
import { serializeGovernance, cleanStr, actorOf } from '@/lib/governance/firestore'

export const dynamic = 'force-dynamic'

const COLLECTION = 'legal_documents'
type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('admin', async (req: NextRequest, user: ApiUser, ctx: RouteContext) => {
  try {
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)
    const { id } = await ctx.params
    const ref = adminDb.collection(COLLECTION).doc(id)
    const snap = await ref.get()
    if (!snap.exists) return apiError('Legal document not found', 404)
    const data = snap.data() as Record<string, unknown>
    if (data.status === 'published') return apiError('Version is already published', 409)

    const body = await req.json().catch(() => ({}))
    const nowIso = new Date().toISOString()
    const effectiveDate = cleanStr((body as Record<string, unknown>)?.effectiveDate, 60) || (data.effectiveDate as string) || nowIso
    const docType = data.docType as string

    // Demote previously-published versions of the same docType.
    // Single-field query (docType) + in-memory status filter — no composite index.
    const sameType = await adminDb.collection(COLLECTION).where('docType', '==', docType).get()
    const toDemote = sameType.docs.filter((d) => d.id !== id && d.data().status === 'published')

    const batch = adminDb.batch()
    toDemote.forEach((d) => {
      batch.update(d.ref, { status: 'archived', updatedAt: FieldValue.serverTimestamp() })
    })

    batch.update(ref, {
      status: 'published',
      effectiveDate,
      publishedAt: FieldValue.serverTimestamp(),
      publishedBy: actorOf(user),
      updatedAt: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    const saved = await ref.get()
    return apiSuccess({
      version: serializeGovernance({ id, ...saved.data() }),
      archivedCount: toDemote.length,
    })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
