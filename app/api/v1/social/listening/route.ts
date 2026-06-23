/**
 * GET  /api/v1/social/listening — list monitored listening terms for the org
 * POST /api/v1/social/listening — create a monitored term
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export const GET = withAuth('client', withTenant(async (_req, _user, orgId) => {
  try {
    const snapshot = await adminDb
      .collection('social_listening_terms')
      .where('orgId', '==', orgId)
      .get()

    const terms = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const aTs = (a as { createdAt?: { _seconds?: number; seconds?: number } }).createdAt
        const bTs = (b as { createdAt?: { _seconds?: number; seconds?: number } }).createdAt
        const aSec = aTs?._seconds ?? aTs?.seconds ?? 0
        const bSec = bTs?._seconds ?? bTs?.seconds ?? 0
        return bSec - aSec
      })

    return apiSuccess(terms, 200, { total: terms.length })
  } catch (error) {
    console.error('Error listing monitored terms:', error)
    return apiError('Failed to list monitored terms', 500)
  }
}))

export const POST = withAuth('client', withTenant(async (req, _user, orgId) => {
  try {
    const body = await req.json()
    const term = typeof body.term === 'string' ? body.term.trim() : ''

    if (!term) {
      return apiError('term is required', 400)
    }

    const platforms: string[] = Array.isArray(body.platforms)
      ? body.platforms.filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
      : []

    const active = body.active === undefined ? true : Boolean(body.active)

    // Dedupe against existing same term for org (case-insensitive)
    const existing = await adminDb
      .collection('social_listening_terms')
      .where('orgId', '==', orgId)
      .get()

    const lowered = term.toLowerCase()
    const dup = existing.docs.find(
      (doc) => String(doc.data().term ?? '').trim().toLowerCase() === lowered
    )
    if (dup) {
      return apiError('A monitored term with this text already exists', 409)
    }

    const doc = {
      orgId,
      term,
      platforms,
      active,
      matchCount: 0,
      lastCheckedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    const docRef = await adminDb.collection('social_listening_terms').add(doc)

    return apiSuccess({ id: docRef.id, term, platforms, active, matchCount: 0 }, 201)
  } catch (error) {
    console.error('Error creating monitored term:', error)
    return apiError('Failed to create monitored term', 500)
  }
}))
