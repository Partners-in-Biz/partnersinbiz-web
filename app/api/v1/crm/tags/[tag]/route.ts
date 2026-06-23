/**
 * PATCH  /api/v1/crm/tags/[tag]  — rename a tag: update the registry AND rewrite
 *                                  the tag on every contact carrying it. (member+)
 *        body: { newTag: string }
 * DELETE /api/v1/crm/tags/[tag]   — delete a tag: remove from registry and strip
 *                                  from all contacts. (member+)
 *
 * Both operations are batched (Firestore commit cap = 500 writes/batch).
 * The [tag] segment is the tag's display/original string (URL-encoded by the
 * client); matching against contacts is case-insensitive.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'

const TAGS_COLLECTION = 'crm_tags'
const CONTACTS_SCAN_CAP = 50_000
const BATCH_LIMIT = 450 // safely under the 500 writes/commit cap

type RouteCtx = { params: Promise<{ tag: string }> }

function registryDocId(orgId: string, tag: string): string {
  return `${orgId}_${tag.trim().toLowerCase()}`
}

/**
 * Commit a list of per-doc mutations in chunks of BATCH_LIMIT.
 */
async function commitInBatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutations: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }>,
): Promise<number> {
  let written = 0
  for (let i = 0; i < mutations.length; i += BATCH_LIMIT) {
    const slice = mutations.slice(i, i + BATCH_LIMIT)
    const batch = adminDb.batch()
    for (const m of slice) batch.update(m.ref, m.data)
    await batch.commit()
    written += slice.length
  }
  return written
}

// ── PATCH (rename) ────────────────────────────────────────────────────────────

export const PATCH = withCrmAuth<RouteCtx>('member', async (req, ctx, routeCtx) => {
  const { tag: rawParam } = await routeCtx!.params
  const oldTag = decodeURIComponent(rawParam ?? '').trim()
  if (!oldTag) return apiError('tag is required', 400)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const newTag = typeof body.newTag === 'string' ? body.newTag.trim() : ''
  if (!newTag) return apiError('newTag is required', 400)
  if (newTag.length > 64) return apiError('newTag must be 64 characters or fewer', 400)

  const oldLower = oldTag.toLowerCase()
  const newLower = newTag.toLowerCase()
  if (oldLower === newLower) {
    // Only the casing changed (or no change). Update registry casing and contacts.
  }

  // Scan org contacts and rewrite the tag where present (case-insensitive match).
  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', ctx.orgId)
    .limit(CONTACTS_SCAN_CAP)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutations: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of snap.docs as any[]) {
    const data = doc.data() ?? {}
    const tags: string[] = Array.isArray(data.tags) ? data.tags : []
    if (!tags.some((t) => typeof t === 'string' && t.toLowerCase() === oldLower)) continue
    // Replace old → new, dedupe case-insensitively, preserve order.
    const seen = new Set<string>()
    const next: string[] = []
    for (const t of tags) {
      if (typeof t !== 'string') continue
      const replaced = t.toLowerCase() === oldLower ? newTag : t
      const key = replaced.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      next.push(replaced)
    }
    mutations.push({
      ref: doc.ref,
      data: { tags: next, updatedAt: FieldValue.serverTimestamp() },
    })
  }

  const updatedContacts = await commitInBatches(mutations)

  // Update the registry: delete old doc, upsert the new one.
  const oldRef = adminDb.collection(TAGS_COLLECTION).doc(registryDocId(ctx.orgId, oldTag))
  const newRef = adminDb.collection(TAGS_COLLECTION).doc(registryDocId(ctx.orgId, newTag))
  const oldSnap = await oldRef.get()
  const regBatch = adminDb.batch()
  regBatch.set(
    newRef,
    {
      orgId: ctx.orgId,
      tag: newTag,
      tagLower: newLower,
      createdAt: oldSnap.exists ? (oldSnap.data()?.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByRef: ctx.actor,
    },
    { merge: true },
  )
  if (oldSnap.exists && oldLower !== newLower) {
    regBatch.delete(oldRef)
  }
  await regBatch.commit()

  return apiSuccess({ tag: newTag, previousTag: oldTag, updatedContacts })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

export const DELETE = withCrmAuth<RouteCtx>('member', async (_req, ctx, routeCtx) => {
  const { tag: rawParam } = await routeCtx!.params
  const tag = decodeURIComponent(rawParam ?? '').trim()
  if (!tag) return apiError('tag is required', 400)
  const tagLower = tag.toLowerCase()

  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', ctx.orgId)
    .limit(CONTACTS_SCAN_CAP)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutations: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of snap.docs as any[]) {
    const data = doc.data() ?? {}
    const tags: string[] = Array.isArray(data.tags) ? data.tags : []
    if (!tags.some((t) => typeof t === 'string' && t.toLowerCase() === tagLower)) continue
    const next = tags.filter((t) => typeof t === 'string' && t.toLowerCase() !== tagLower)
    mutations.push({
      ref: doc.ref,
      data: { tags: next, updatedAt: FieldValue.serverTimestamp() },
    })
  }

  const updatedContacts = await commitInBatches(mutations)

  // Remove from registry (no-op if absent).
  await adminDb.collection(TAGS_COLLECTION).doc(registryDocId(ctx.orgId, tag)).delete().catch(() => {})

  return apiSuccess({ tag, updatedContacts })
})
