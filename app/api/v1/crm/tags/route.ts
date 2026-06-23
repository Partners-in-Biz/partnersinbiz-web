/**
 * GET  /api/v1/crm/tags  — list every distinct tag used across the org's
 *                          contacts WITH usage counts, merged with any
 *                          zero-usage tags persisted in the `crm_tags` registry.
 *                          (viewer+)
 * POST /api/v1/crm/tags   — create a registry tag (survives with zero usage).
 *                          (member+)
 *
 * Tag registry: Firestore `crm_tags` collection, doc id `${orgId}_${lower(tag)}`.
 *   { orgId, tag (display/original casing), tagLower, createdAt, createdByRef }
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withCrmAuth } from '@/lib/auth/crm-middleware'
import { apiSuccess, apiError } from '@/lib/api/response'

const TAGS_COLLECTION = 'crm_tags'
const CONTACTS_SCAN_CAP = 50_000

export interface TagUsage {
  tag: string
  count: number
  /** true when the tag exists in the registry (created explicitly) */
  registered: boolean
}

export function tagRegistryDocId(orgId: string, tag: string): string {
  return `${orgId}_${tag.trim().toLowerCase()}`
}

export const GET = withCrmAuth('viewer', async (_req, ctx) => {
  // Aggregate tag → count across the org's contacts.
  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', ctx.orgId)
    .limit(CONTACTS_SCAN_CAP)
    .get()

  // Map keyed by lowercased tag → { display, count }
  const counts = new Map<string, { display: string; count: number }>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of snap.docs as any[]) {
    const data = doc.data() ?? {}
    if (data.deleted === true) continue
    const tags = Array.isArray(data.tags) ? data.tags : []
    for (const raw of tags) {
      if (typeof raw !== 'string') continue
      const display = raw.trim()
      if (!display) continue
      const key = display.toLowerCase()
      const slot = counts.get(key)
      if (slot) slot.count += 1
      else counts.set(key, { display, count: 1 })
    }
  }

  // Merge in registry tags (zero-usage survivors + canonical casing).
  const registered = new Set<string>()
  const regSnap = await adminDb
    .collection(TAGS_COLLECTION)
    .where('orgId', '==', ctx.orgId)
    .get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const doc of regSnap.docs as any[]) {
    const data = doc.data() ?? {}
    const display = typeof data.tag === 'string' ? data.tag.trim() : ''
    if (!display) continue
    const key = display.toLowerCase()
    registered.add(key)
    if (!counts.has(key)) counts.set(key, { display, count: 0 })
    else counts.get(key)!.display = display // prefer registry casing
  }

  const tags: TagUsage[] = [...counts.entries()]
    .map(([key, v]) => ({ tag: v.display, count: v.count, registered: registered.has(key) }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))

  return apiSuccess({ tags, total: tags.length })
})

export const POST = withCrmAuth('member', async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const tag = typeof body.tag === 'string' ? body.tag.trim() : ''
  if (!tag) return apiError('tag is required', 400)
  if (tag.length > 64) return apiError('tag must be 64 characters or fewer', 400)

  const id = tagRegistryDocId(ctx.orgId, tag)
  const ref = adminDb.collection(TAGS_COLLECTION).doc(id)
  const existing = await ref.get()
  if (existing.exists) {
    return apiError('Tag already exists', 409)
  }

  await ref.set({
    orgId: ctx.orgId,
    tag,
    tagLower: tag.toLowerCase(),
    createdAt: FieldValue.serverTimestamp(),
    createdByRef: ctx.actor,
    createdBy: ctx.isAgent ? null : ctx.actor.uid,
  })

  return apiSuccess({ tag, count: 0, registered: true }, 201)
})
