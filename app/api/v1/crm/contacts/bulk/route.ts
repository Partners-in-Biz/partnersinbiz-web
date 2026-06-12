/**
 * POST /api/v1/crm/contacts/bulk — apply the same patch to a list of contact IDs
 *
 * Body:
 *   {
 *     ids: string[]        // 1-200 contact IDs in caller's org
 *     patch: {
 *       assignedTo?: string       // uid to assign all selected contacts to
 *       stage?: ContactStage
 *       type?: ContactType
 *       tags?: { add?: string[], remove?: string[] }   // arrayUnion / arrayRemove
 *       delete?: true             // soft-delete — cannot be mixed with other patch fields
 *     }
 *   }
 *
 * Response: { success: true, data: { updated: number, skipped: number, failed: string[] } }
 *
 * Auth: member+  (agent / Bearer bypasses the role gate — runs as 'system')
 *
 * Notes:
 * - Contacts that don't exist, belong to a different org, or are soft-deleted are skipped (not failed).
 * - tags.add and tags.remove cannot both be set in the same request (400).
 * - patch.delete cannot be combined with any other patch field (400).
 * - No webhooks / activity writes for bulk ops (volume concerns; deferred).
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { resolveMemberRef } from '@/lib/orgMembers/memberRef'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { ContactStage, ContactType } from '@/lib/crm/types'
import {
  crmActorCanReadRecord,
  crmRecordCompanyIds,
  isCrmPrivilegedActor,
  loadCompanyAssignmentMap,
  normalizeAllowedUserPatch,
} from '@/lib/crm/assignment-access'

const VALID_CONTACT_STAGES: readonly ContactStage[] = [
  'new',
  'contacted',
  'replied',
  'demo',
  'proposal',
  'won',
  'lost',
]

const VALID_CONTACT_TYPES: readonly ContactType[] = [
  'lead',
  'prospect',
  'client',
  'churned',
]

/** Max contacts per request. Firestore batch limit is 500 — we stay well under. */
const MAX_IDS = 200

/** Max IDs per Firestore `in` query slice (Firestore limit). */
const IN_CHUNK = 30

export const POST = withCrmAuth('member', async (req, ctx) => {
  // ── Parse body ────────────────────────────────────────────────────────────
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return apiError('Invalid JSON', 400)

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
  if (!patch || typeof patch !== 'object') return apiError('patch object required', 400)

  // ── Delete action — mutually exclusive with all other patch fields ─────────
  if (patch.delete === true) {
    if (patch.assignedTo !== undefined || patch.allowedUserIds !== undefined || patch.stage !== undefined || patch.type !== undefined || patch.tags !== undefined) {
      return apiError('patch.delete cannot be combined with other patch fields', 400)
    }

    // Soft-delete path — bypass normal patch processing entirely
    const updated: string[] = []
    const skipped: string[] = []
    const failed: string[] = []

    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK)
      const docs = await Promise.all(
        chunk.map((id) => adminDb.collection('contacts').doc(id).get()),
      )
      const companyIds = new Set<string>()
      if (!isCrmPrivilegedActor(ctx)) {
        for (const snap of docs) {
          if (!snap.exists) continue
          const data = snap.data()!
          if (data.orgId !== ctx.orgId || data.deleted === true) continue
          for (const companyId of crmRecordCompanyIds(data)) companyIds.add(companyId)
        }
      }
      const companies = !isCrmPrivilegedActor(ctx)
        ? await loadCompanyAssignmentMap(ctx.orgId, companyIds)
        : new Map()

      const batch = adminDb.batch()
      let inBatch = 0
      const batchIds: string[] = []

      for (let j = 0; j < docs.length; j++) {
        const snap = docs[j]
        const id = chunk[j]

        if (!snap.exists) { skipped.push(id); continue }
        const data = snap.data()!
        if (data.orgId !== ctx.orgId) { skipped.push(id); continue }
        if (data.deleted === true) { skipped.push(id); continue }
        if (!isCrmPrivilegedActor(ctx) && !crmActorCanReadRecord(ctx, { id, ...data }, { companies })) {
          skipped.push(id)
          continue
        }

        batch.update(snap.ref, {
          deleted: true,
          updatedAt: FieldValue.serverTimestamp(),
          updatedByRef: ctx.actor,
        })
        inBatch++
        batchIds.push(id)
      }

      if (inBatch > 0) {
        try {
          await batch.commit()
          updated.push(...batchIds)
        } catch (e) {
          console.error('[bulk-delete] batch commit failed for chunk', i, e)
          failed.push(...batchIds)
        }
      }
    }

    return apiSuccess({ updated: updated.length, skipped: skipped.length, failed })
  }

  // Build the per-document update payload
  const updateData: Record<string, unknown> = {}

  if (typeof patch.assignedTo === 'string') {
    if (!isCrmPrivilegedActor(ctx) && patch.assignedTo && patch.assignedTo !== ctx.actor.uid) {
      return apiError('You can only assign contacts to yourself with your current CRM access', 403)
    }
    updateData.assignedTo = patch.assignedTo
    const allowedUserIds = normalizeAllowedUserPatch(patch.allowedUserIds) ?? []
    if (patch.assignedTo !== '') {
      // resolveMemberRef is tolerant — returns FORMER_MEMBER_REF on missing uid
      updateData.assignedToRef = await resolveMemberRef(ctx.orgId, patch.assignedTo)
      if (!allowedUserIds.includes(patch.assignedTo)) allowedUserIds.push(patch.assignedTo)
    } else {
      updateData.assignedToRef = FieldValue.delete()
    }
    if (allowedUserIds.length > 0 || patch.allowedUserIds !== undefined) updateData.allowedUserIds = allowedUserIds
  } else if (patch.allowedUserIds !== undefined) {
    const allowedUserIds = normalizeAllowedUserPatch(patch.allowedUserIds)
    if (allowedUserIds === null) return apiError('allowedUserIds must be an array of user IDs', 400)
    updateData.allowedUserIds = allowedUserIds
  }

  if (typeof patch.stage === 'string') {
    if (!(VALID_CONTACT_STAGES as readonly string[]).includes(patch.stage)) {
      return apiError('Invalid stage', 400)
    }
    updateData.stage = patch.stage
  }

  if (typeof patch.type === 'string') {
    if (!(VALID_CONTACT_TYPES as readonly string[]).includes(patch.type)) {
      return apiError('Invalid type', 400)
    }
    updateData.type = patch.type
  }

  // ── Resolve tag operations ────────────────────────────────────────────────
  const tagsObj = patch.tags && typeof patch.tags === 'object' ? patch.tags : null
  let tagsFieldValue: ReturnType<typeof FieldValue.arrayUnion> | ReturnType<typeof FieldValue.arrayRemove> | null = null

  if (tagsObj) {
    const addArr = Array.isArray(tagsObj.add)
      ? (tagsObj.add as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : []
    const removeArr = Array.isArray(tagsObj.remove)
      ? (tagsObj.remove as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : []

    if (addArr.length > 0 && removeArr.length > 0) {
      return apiError('tags.add and tags.remove cannot both be set in the same request — send two separate requests', 400)
    }
    if (addArr.length > 0) {
      tagsFieldValue = FieldValue.arrayUnion(...addArr)
    } else if (removeArr.length > 0) {
      tagsFieldValue = FieldValue.arrayRemove(...removeArr)
    }
  }

  // ── Empty-patch guard ─────────────────────────────────────────────────────
  if (Object.keys(updateData).length === 0 && tagsFieldValue === null) {
    return apiError('No editable fields supplied', 400)
  }

  // ── Common attribution fields ─────────────────────────────────────────────
  updateData.updatedBy = ctx.isAgent ? undefined : ctx.actor.uid
  updateData.updatedByRef = ctx.actor
  updateData.updatedAt = FieldValue.serverTimestamp()

  // Strip undefined (Firestore rejects them)
  const sanitized = Object.fromEntries(
    Object.entries(updateData).filter(([, v]) => v !== undefined),
  )

  // ── Per-chunk fetch → verify org ownership → batch update ─────────────────
  const updated: string[] = []
  const skipped: string[] = []
  const failed: string[] = []

  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)

    // Fetch each doc individually — avoids the `in` query and is simpler for
    // ownership checks when doc IDs are already known.
    const docs = await Promise.all(
      chunk.map((id) => adminDb.collection('contacts').doc(id).get()),
    )
    const companyIds = new Set<string>()
    if (!isCrmPrivilegedActor(ctx)) {
      for (const snap of docs) {
        if (!snap.exists) continue
        const data = snap.data()!
        if (data.orgId !== ctx.orgId || data.deleted === true) continue
        for (const companyId of crmRecordCompanyIds(data)) companyIds.add(companyId)
      }
    }
    const companies = !isCrmPrivilegedActor(ctx)
      ? await loadCompanyAssignmentMap(ctx.orgId, companyIds)
      : new Map()

    const batch = adminDb.batch()
    let inBatch = 0
    const batchIds: string[] = []

    for (let j = 0; j < docs.length; j++) {
      const snap = docs[j]
      const id = chunk[j]

      if (!snap.exists) { skipped.push(id); continue }
      const data = snap.data()!
      if (data.orgId !== ctx.orgId) { skipped.push(id); continue }
      if (data.deleted === true) { skipped.push(id); continue }
      if (!isCrmPrivilegedActor(ctx) && !crmActorCanReadRecord(ctx, { id, ...data }, { companies })) {
        skipped.push(id)
        continue
      }

      const docUpdate = { ...sanitized }
      if (tagsFieldValue !== null) {
        docUpdate.tags = tagsFieldValue
      }

      batch.update(snap.ref, docUpdate)
      inBatch++
      batchIds.push(id)
    }

    if (inBatch > 0) {
      try {
        await batch.commit()
        updated.push(...batchIds)
      } catch (e) {
        console.error('[bulk] batch commit failed for chunk', i, e)
        failed.push(...batchIds)
      }
    }
  }

  return apiSuccess({ updated: updated.length, skipped: skipped.length, failed })
})
