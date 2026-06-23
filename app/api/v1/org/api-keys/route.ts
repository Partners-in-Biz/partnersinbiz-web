// app/api/v1/org/api-keys/route.ts
// Org-scoped API key management for the portal. Clients manage their own org's keys.
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { createHash, randomBytes } from 'crypto'
import type { ApiKeyPermission } from '@/lib/api/api-keys'

export const dynamic = 'force-dynamic'

const VALID_RESOURCES = ['social', 'projects', 'tasks', 'invoices', 'pipeline', 'platform'] as const
const VALID_ACTIONS = ['read', 'write', 'delete'] as const

type Resource = (typeof VALID_RESOURCES)[number]
type Action = (typeof VALID_ACTIONS)[number]

function sanitizePermissions(input: unknown): ApiKeyPermission[] {
  if (!Array.isArray(input)) return []
  const byResource = new Map<Resource, Set<Action>>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const resource = (raw as { resource?: unknown }).resource
    const actions = (raw as { actions?: unknown }).actions
    if (typeof resource !== 'string' || !VALID_RESOURCES.includes(resource as Resource)) continue
    if (!Array.isArray(actions)) continue
    const validActions = actions.filter(
      (a): a is Action => typeof a === 'string' && VALID_ACTIONS.includes(a as Action),
    )
    if (validActions.length === 0) continue
    const set = byResource.get(resource as Resource) ?? new Set<Action>()
    validActions.forEach((a) => set.add(a))
    byResource.set(resource as Resource, set)
  }
  return Array.from(byResource.entries()).map(([resource, actions]) => ({
    resource,
    actions: VALID_ACTIONS.filter((a) => actions.has(a)),
  }))
}

// GET — list keys for the caller's org (never returns keyHash)
export const GET = withPortalAuthAndRole('admin', async (req, _uid, orgId) => {
  try {
    const includeRevoked = req.nextUrl.searchParams.get('includeRevoked') === 'true'

    const snapshot = await adminDb
      .collection('api_keys')
      .where('orgId', '==', orgId)
      .get()

    const keys = snapshot.docs
      .map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          name: data.name ?? '',
          keyPrefix: data.keyPrefix ?? '',
          orgId: data.orgId,
          role: data.role ?? 'ai',
          permissions: data.permissions ?? [],
          rateLimitPerMin: data.rateLimitPerMin ?? null,
          usageLimit: data.usageLimit ?? null,
          lastUsedAt: data.lastUsedAt ?? null,
          expiresAt: data.expiresAt ?? null,
          revokedAt: data.revokedAt ?? null,
          createdBy: data.createdBy ?? null,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        }
      })
      .filter((k) => includeRevoked || !k.revokedAt)

    keys.sort((a, b) => {
      const ta = a.createdAt?._seconds ?? a.createdAt?.seconds ?? 0
      const tb = b.createdAt?._seconds ?? b.createdAt?.seconds ?? 0
      return tb - ta
    })

    return apiSuccess(keys)
  } catch (err) {
    return apiErrorFromException(err)
  }
})

// POST — create a new org-scoped key, returns rawKey ONCE
export const POST = withPortalAuthAndRole('admin', async (req, uid, orgId) => {
  try {
    const body = await req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return apiError('name is required', 400)

    const permissions = sanitizePermissions(body.permissions ?? body.scopes)
    if (permissions.length === 0) {
      return apiError('At least one permission (resource + action) is required', 400)
    }

    // Optional expiry — accept ISO string or epoch ms
    let expiresAt: Date | null = null
    if (body.expiresAt) {
      const parsed = new Date(body.expiresAt)
      if (Number.isNaN(parsed.getTime())) return apiError('expiresAt is invalid', 400)
      if (parsed.getTime() <= Date.now()) return apiError('expiresAt must be in the future', 400)
      expiresAt = parsed
    }

    // Optional rate limit (requests per minute)
    let rateLimitPerMin: number | null = null
    const rawRate = body.rateLimit ?? body.rateLimitPerMin
    if (rawRate !== undefined && rawRate !== null && rawRate !== '') {
      const n = Number(rawRate)
      if (!Number.isInteger(n) || n <= 0) return apiError('rateLimit must be a positive integer', 400)
      rateLimitPerMin = n
    }

    // Optional total usage cap
    let usageLimit: number | null = null
    if (body.usageLimit !== undefined && body.usageLimit !== null && body.usageLimit !== '') {
      const n = Number(body.usageLimit)
      if (!Number.isInteger(n) || n <= 0) return apiError('usageLimit must be a positive integer', 400)
      usageLimit = n
    }

    // Generate secure key — org/agent keys use the pib_ak_ prefix
    const rawKey = `pib_ak_${randomBytes(24).toString('base64url')}`
    const keyPrefix = rawKey.slice(0, 12)
    const keyHash = createHash('sha256').update(rawKey).digest('hex')

    const doc = {
      name,
      orgId,
      agentId: null,
      role: 'ai' as const,
      keyHash,
      keyPrefix,
      permissions,
      rateLimitPerMin,
      usageLimit,
      lastUsedAt: null,
      expiresAt: expiresAt ?? null,
      revokedAt: null,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }

    const ref = await adminDb.collection('api_keys').add(doc)

    return apiSuccess(
      {
        id: ref.id,
        keyPrefix,
        rawKey, // ONLY returned once at creation
      },
      201,
    )
  } catch (err) {
    return apiErrorFromException(err)
  }
})
