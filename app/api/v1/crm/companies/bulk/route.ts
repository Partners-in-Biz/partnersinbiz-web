/**
 * POST /api/v1/crm/companies/bulk — apply the same patch to a list of company IDs
 *
 * Body:
 *   {
 *     ids: string[]         // 1-200 company IDs in caller's org
 *     patch: {
 *       accountManagerUid?: string
 *       ownerUid?: string
 *       tags?: string[]       // replaces entire tags array (arrayUnion not needed — companies don't use add/remove)
 *       tier?: CompanyTier
 *       lifecycleStage?: CompanyLifecycleStage
 *       industry?: string
 *       size?: CompanySize
 *     }
 *   }
 *
 * Response: { success: true, data: { updated: number, skipped: number } }
 *
 * Auth: member+
 *
 * Notes:
 * - Companies that don't exist, belong to a different org, or are soft-deleted are skipped (not failed).
 * - patch keys must be a subset of COMPANY_BULK_FIELDS else 400.
 * - Chunks of 30 IDs at a time (Firestore batch pattern).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'
import { COMPANY_BULK_FIELDS } from '@/lib/companies/types'

const MAX_IDS = 200
const IN_CHUNK = 30

const VALID_BULK_FIELDS = new Set<string>(COMPANY_BULK_FIELDS)

export const POST = withCrmAuth('member', async (req, ctx) => {
  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { ids?: unknown; patch?: unknown }
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid JSON', 400)
  }

  // ── Validate ids ──────────────────────────────────────────────────────────
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return apiError('ids must be a non-empty array', 400)
  }
  if (body.ids.length > MAX_IDS) {
    return apiError(`Max ${MAX_IDS} ids per request`, 400)
  }
  if (!body.ids.every((id: unknown) => typeof id === 'string' && id.trim().length > 0)) {
    return apiError('All ids must be non-empty strings', 400)
  }
  const ids: string[] = body.ids

  // ── Validate patch ────────────────────────────────────────────────────────
  const patch = body.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return apiError('patch object required', 400)
  }

  const patchObj = patch as Record<string, unknown>
  const patchKeys = Object.keys(patchObj)

  if (patchKeys.length === 0) {
    return apiError('patch must contain at least one field', 400)
  }

  // Reject any key not in COMPANY_BULK_FIELDS
  for (const key of patchKeys) {
    if (!VALID_BULK_FIELDS.has(key)) {
      return apiError(`Invalid bulk field: "${key}". Allowed: ${COMPANY_BULK_FIELDS.join(', ')}`, 400)
    }
  }

  // Build the update payload
  const updateData: Record<string, unknown> = {}

  for (const key of patchKeys) {
    updateData[key] = patchObj[key]
  }

  // Attribution
  updateData.updatedBy = ctx.isAgent ? undefined : ctx.actor.uid
  updateData.updatedByRef = ctx.actor
  updateData.updatedAt = FieldValue.serverTimestamp()

  // Strip undefined (Firestore rejects them)
  const sanitized = Object.fromEntries(
    Object.entries(updateData).filter(([, v]) => v !== undefined),
  )

  // ── Per-chunk fetch → verify org ownership → batch update ─────────────────
  let updated = 0
  let skipped = 0

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)

    // Fetch each doc to verify org ownership
    const docs = await Promise.all(
      chunk.map((id) => adminDb.collection('companies').doc(id).get()),
    )

    const batch = adminDb.batch()
    let inBatch = 0
    let batchSkipped = 0

    for (let j = 0; j < docs.length; j++) {
      const snap = docs[j]
      const id = chunk[j]

      if (!snap.exists) { batchSkipped++; continue }
      const data = snap.data()!
      if (data.orgId !== ctx.orgId) {
        console.warn(`[companies-bulk] skipped cross-tenant id ${id}`)
        batchSkipped++
        continue
      }
      if (data.deleted === true) { batchSkipped++; continue }

      batch.update(snap.ref, sanitized)
      inBatch++
    }

    if (inBatch > 0) {
      try {
        await batch.commit()
        updated += inBatch
      } catch (e) {
        console.error('[companies-bulk] batch commit failed for chunk', i, e)
        // Count as skipped rather than partially applied
        skipped += inBatch
        continue
      }
    }
    skipped += batchSkipped
  }

  return apiSuccess({ updated, skipped })
})
