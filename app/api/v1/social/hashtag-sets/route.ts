/**
 * GET  /api/v1/social/hashtag-sets — list org's saved hashtag sets (US-084)
 * POST /api/v1/social/hashtag-sets — create a saved hashtag set
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

/**
 * Normalize hashtags input into a clean string[]:
 * accepts an array or a comma/space-delimited string, trims, prefixes '#',
 * drops empties, and dedupes case-insensitively (preserving first-seen casing).
 */
export function normalizeHashtags(input: unknown): string[] {
  let raw: string[]
  if (Array.isArray(input)) {
    raw = input.map((v) => (typeof v === 'string' ? v : String(v ?? '')))
  } else if (typeof input === 'string') {
    raw = input.split(/[,\s]+/)
  } else {
    return []
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    let tag = item.trim()
    if (!tag) continue
    tag = tag.replace(/^#+/, '') // strip any leading hashes before re-prefixing
    if (!tag) continue
    tag = `#${tag}`
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export const GET = withAuth('client', withTenant(async (_req, _user, orgId) => {
  const snapshot = await adminDb
    .collection('social_hashtag_sets')
    .where('orgId', '==', orgId)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sets = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))

  // Sort newest first in-code to avoid composite index requirements.
  sets.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aMs = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
    const bMs = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0
    return bMs - aMs
  })

  return apiSuccess(sets, 200, { total: sets.length })
}))

export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  const body = await req.json()

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return apiError('name is required')
  }

  const hashtags = normalizeHashtags(body.hashtags)
  if (hashtags.length === 0) {
    return apiError('at least one hashtag is required')
  }

  // Dedupe by name (case-insensitive) per org.
  const existing = await adminDb
    .collection('social_hashtag_sets')
    .where('orgId', '==', orgId)
    .get()
  const nameLower = name.toLowerCase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dup = existing.docs.some((doc: any) =>
    String(doc.data().name ?? '').trim().toLowerCase() === nameLower
  )
  if (dup) {
    return apiError('A hashtag set with this name already exists', 409)
  }

  const doc = {
    orgId,
    name,
    hashtags,
    createdBy: user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('social_hashtag_sets').add(doc)

  return apiSuccess({ id: docRef.id }, 201)
}))
