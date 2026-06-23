/**
 * PATCH  /api/v1/social/hashtag-sets/[id] — update a saved hashtag set
 * DELETE /api/v1/social/hashtag-sets/[id] — delete a saved hashtag set
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import { normalizeHashtags } from '../route'

export const dynamic = 'force-dynamic'

export const PATCH = withAuth('client', withTenant(async (req, _user, orgId) => {
  const itemId = new URL(req.url).pathname.split('/').pop()
  if (!itemId) {
    return apiError('Hashtag set ID is required', 400)
  }

  const docRef = adminDb.collection('social_hashtag_sets').doc(itemId)
  const snap = await docRef.get()
  if (!snap.exists || snap.data()?.orgId !== orgId) {
    return apiError('Hashtag set not found', 404)
  }

  const body = await req.json()
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) {
      return apiError('name cannot be empty')
    }
    updates.name = name
  }

  if (body.hashtags !== undefined) {
    const hashtags = normalizeHashtags(body.hashtags)
    if (hashtags.length === 0) {
      return apiError('at least one hashtag is required')
    }
    updates.hashtags = hashtags
  }

  if (Object.keys(updates).length === 1) {
    return apiError('No valid updates provided', 400)
  }

  await docRef.update(updates)
  const updated = await docRef.get()
  return apiSuccess({ id: itemId, ...updated.data() })
}))

export const DELETE = withAuth('client', withTenant(async (req, _user, orgId) => {
  const itemId = new URL(req.url).pathname.split('/').pop()
  if (!itemId) {
    return apiError('Hashtag set ID is required', 400)
  }

  const docRef = adminDb.collection('social_hashtag_sets').doc(itemId)
  const snap = await docRef.get()
  if (!snap.exists || snap.data()?.orgId !== orgId) {
    return apiError('Hashtag set not found', 404)
  }

  await docRef.delete()
  return apiSuccess({ id: itemId, deleted: true })
}))
