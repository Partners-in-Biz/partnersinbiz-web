// app/api/v1/org/api-keys/[id]/route.ts
// Org-scoped revoke + update for a single API key. Only the owning org's admins can act.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

// DELETE — revoke a key (soft delete via revokedAt) scoped to the caller's org
export const DELETE = withPortalAuthAndRole(
  'admin',
  async (_req, _uid, orgId, _role, context: RouteContext) => {
    try {
      const { id } = await context.params
      const ref = adminDb.collection('api_keys').doc(id)
      const doc = await ref.get()
      if (!doc.exists) return apiError('Key not found', 404)

      const data = doc.data()!
      if (data.orgId !== orgId) return apiError('Key not found', 404)
      if (data.revokedAt) return apiSuccess({ id, revoked: true })

      await ref.update({
        revokedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })

      return apiSuccess({ id, revoked: true })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)

// PATCH — update mutable fields (name, rate limit, usage limit) for the caller's org key
export const PATCH = withPortalAuthAndRole(
  'admin',
  async (req, _uid, orgId, _role, context: RouteContext) => {
    try {
      const { id } = await context.params
      const ref = adminDb.collection('api_keys').doc(id)
      const doc = await ref.get()
      if (!doc.exists) return apiError('Key not found', 404)

      const data = doc.data()!
      if (data.orgId !== orgId) return apiError('Key not found', 404)

      const body = await req.json().catch(() => ({}))
      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }

      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) return apiError('name cannot be empty', 400)
        update.name = name
      }

      if (body.rateLimit !== undefined || body.rateLimitPerMin !== undefined) {
        const raw = body.rateLimit ?? body.rateLimitPerMin
        if (raw === null || raw === '') {
          update.rateLimitPerMin = null
        } else {
          const n = Number(raw)
          if (!Number.isInteger(n) || n <= 0) return apiError('rateLimit must be a positive integer', 400)
          update.rateLimitPerMin = n
        }
      }

      if (body.usageLimit !== undefined) {
        if (body.usageLimit === null || body.usageLimit === '') {
          update.usageLimit = null
        } else {
          const n = Number(body.usageLimit)
          if (!Number.isInteger(n) || n <= 0) return apiError('usageLimit must be a positive integer', 400)
          update.usageLimit = n
        }
      }

      if (Object.keys(update).length === 1) {
        return apiError('No updatable fields provided', 400)
      }

      await ref.update(update)
      return apiSuccess({ id, updated: true })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
