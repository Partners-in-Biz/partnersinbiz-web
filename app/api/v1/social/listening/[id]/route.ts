/**
 * PATCH  /api/v1/social/listening/[id] — update a monitored term
 * DELETE /api/v1/social/listening/[id] — delete a monitored term
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const PATCH = withAuth('client', withTenant(async (req, _user, orgId) => {
  try {
    const termId = new URL(req.url).pathname.split('/').pop()
    if (!termId) {
      return apiError('Term ID is required', 400)
    }

    const ref = adminDb.collection('social_listening_terms').doc(termId)
    const snap = await ref.get()
    if (!snap.exists || snap.data()?.orgId !== orgId) {
      return apiError('Monitored term not found', 404)
    }

    const body = await req.json()
    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

    if (typeof body.term === 'string') {
      const term = body.term.trim()
      if (!term) {
        return apiError('term cannot be empty', 400)
      }
      // Dedupe against other terms for this org (case-insensitive)
      const existing = await adminDb
        .collection('social_listening_terms')
        .where('orgId', '==', orgId)
        .get()
      const lowered = term.toLowerCase()
      const dup = existing.docs.find(
        (doc) => doc.id !== termId && String(doc.data().term ?? '').trim().toLowerCase() === lowered
      )
      if (dup) {
        return apiError('A monitored term with this text already exists', 409)
      }
      updates.term = term
    }

    if (Array.isArray(body.platforms)) {
      updates.platforms = body.platforms.filter(
        (p: unknown): p is string => typeof p === 'string' && p.trim().length > 0
      )
    }

    if (body.active !== undefined) {
      updates.active = Boolean(body.active)
    }

    if (Object.keys(updates).length === 1) {
      return apiError('No valid updates provided', 400)
    }

    await ref.update(updates)
    const updated = await ref.get()
    return apiSuccess({ id: termId, ...updated.data() })
  } catch (error) {
    console.error('Error updating monitored term:', error)
    return apiError('Failed to update monitored term', 500)
  }
}))

export const DELETE = withAuth('client', withTenant(async (req, _user, orgId) => {
  try {
    const termId = new URL(req.url).pathname.split('/').pop()
    if (!termId) {
      return apiError('Term ID is required', 400)
    }

    const ref = adminDb.collection('social_listening_terms').doc(termId)
    const snap = await ref.get()
    if (!snap.exists || snap.data()?.orgId !== orgId) {
      return apiError('Monitored term not found', 404)
    }

    await ref.delete()
    return apiSuccess({ id: termId, deleted: true })
  } catch (error) {
    console.error('Error deleting monitored term:', error)
    return apiError('Failed to delete monitored term', 500)
  }
}))
