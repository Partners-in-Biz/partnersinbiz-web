import { NextRequest } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from './response'
import type { ApiPermission, ApiRole, ApiUser } from './types'
import { canAccessOrg } from './platformAdmin'
import { resolveMemberAccessPolicy, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import type { OrgRole } from '@/lib/organizations/types'
import { getMaintenanceState, isMaintenanceActiveNow, requestBypassesMaintenance } from '@/lib/governance/maintenance'

type RouteHandler = (req: NextRequest, user: ApiUser, context?: any) => Promise<Response>

function constantTimeStringEqual(candidate: string, expected: string | undefined): boolean {
  const expectedValue = expected ?? ''
  if (!expectedValue) return false

  const candidateHash = createHash('sha256').update(candidate).digest()
  const expectedHash = createHash('sha256').update(expectedValue).digest()
  return timingSafeEqual(candidateHash, expectedHash)
}

/**
 * Wraps an API route handler with authentication and role enforcement.
 *
 * Auth methods accepted (in order):
 *  1. Authorization: Bearer ***  — long-lived key for agent/Claude access
 *  2. Authorization: Bearer *** — client SDK token
 *  3. Session cookie __session — set after browser login
 *
 * Role hierarchy: ai/admin satisfy any role; client only satisfies "client"
 */
export function withAuth(requiredRole: 'admin' | 'client', handler: RouteHandler): any {
  return async (req: NextRequest, context?: any): Promise<Response> => {
    let user: ApiUser | null
    try {
      user = await _resolveUser(req)
    } catch {
      return apiError('Unauthorized', 401)
    }
    if (!user) return apiError('Unauthorized', 401)

    // ai and admin satisfy any role; client only satisfies "client"
    const roleOk =
      user.role === 'ai' ||
      user.role === 'admin' ||
      (requiredRole === 'client' && user.role === 'client')

    if (!roleOk) return apiError('Forbidden', 403)

    if (requiredRole === 'client' && user.role === 'client') {
      const maintenance = await getMaintenanceState()
      if (isMaintenanceActiveNow(maintenance, Date.now()) && !requestBypassesMaintenance(req.headers, maintenance, user.role)) {
        return apiError(maintenance.message || 'Scheduled maintenance in progress', 503)
      }
    }

    if (user.role === 'admin') {
      const url = new URL(req.url)
      const scopedOrgId = url.searchParams.get('orgId') ?? req.headers.get('x-org-id')
      if (scopedOrgId && !canAccessOrg(user, scopedOrgId)) {
        return apiError('Forbidden', 403)
      }
    }

    try {
      return await handler(req, user, context)
    } catch (err) {
      return apiErrorFromException(err)
    }
  }
}

/**
 * Resolve the authenticated user from a request without enforcing a role.
 * Returns null if no valid credential is present.
 *
 * Useful for dual-auth routes (admin OR public token) where you need to
 * check auth manually instead of via `withAuth`.
 */
export async function resolveUser(req: NextRequest): Promise<ApiUser | null> {
  return _resolveUser(req)
}

async function _resolveUser(req: NextRequest): Promise<ApiUser | null> {
  const authHeader = req.headers.get('authorization') ?? ''

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // 1. Check for AI_API_KEY
    const aiKey = process.env.AI_API_KEY
    if (constantTimeStringEqual(token, aiKey)) {
      return { uid: 'ai-agent', role: 'ai', authKind: 'legacy_ai_key' }
    }

    // 2. Check hashed PiB per-agent API keys.
    const agentUser = await resolveAgentApiKeyUser(token)
    if (agentUser) return agentUser

    // 3. Verify as Firebase ID token
    try {
      const decoded = await adminAuth.verifyIdToken(token)
      const extras = await getUserExtrasFromFirestore(decoded.uid)
      return { uid: decoded.uid, authKind: 'firebase', ...extras }
    } catch {
      // fall through to cookie check
    }
  }

  // 4. Session cookie
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const cookie = req.cookies.get(cookieName)?.value
  if (cookie) {
    try {
      const decoded = await adminAuth.verifySessionCookie(cookie, true)
      const extras = await getUserExtrasFromFirestore(decoded.uid)
      return { uid: decoded.uid, authKind: 'session', ...extras }
    } catch {
      return null
    }
  }

  return null
}

function timestampToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'object') {
    const source = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toDate === 'function') {
      try { return source.toDate().getTime() } catch { return null }
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function cleanPermissions(value: unknown): ApiPermission[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const source = item as Record<string, unknown>
    const resource = typeof source.resource === 'string' ? source.resource.trim() : ''
    const actions = Array.isArray(source.actions)
      ? source.actions.filter((action): action is string => typeof action === 'string' && action.trim().length > 0).map((action) => action.trim())
      : []
    return resource && actions.length > 0 ? [{ resource, actions }] : []
  })
}

export async function resolveAgentApiKeyUser(rawKey: string): Promise<ApiUser | null> {
  if (!rawKey || !rawKey.startsWith('pib_')) return null

  const keyHash = createHash('sha256').update(rawKey).digest('hex')

  try {
    const snap = await adminDb
      .collection('api_keys')
      .where('keyHash', '==', keyHash)
      .limit(1)
      .get()

    if (snap.empty || snap.docs.length === 0) return null
    const doc = snap.docs[0]
    const data = doc.data() ?? {}
    if (data.role !== 'ai') return null
    if (data.revokedAt) return null
    const expiresAt = timestampToMillis(data.expiresAt)
    if (expiresAt !== null && expiresAt <= Date.now()) return null

    const agentId = typeof data.agentId === 'string' && data.agentId.trim()
      ? data.agentId.trim()
      : null
    if (!agentId) return null

    try {
      await doc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() })
    } catch {
      // Auth should not fail just because telemetry couldn't be written.
    }

    return {
      uid: `agent:${agentId}`,
      role: 'ai',
      authKind: 'agent_api_key',
      agentId,
      apiKeyId: doc.id,
      permissions: cleanPermissions(data.permissions),
      orgId: typeof data.orgId === 'string' && data.orgId ? data.orgId : undefined,
    }
  } catch {
    return null
  }
}

async function getUserExtrasFromFirestore(
  uid: string,
): Promise<{ role: ApiRole; orgId?: string; activeOrgId?: string; orgIds?: string[]; allowedOrgIds?: string[]; memberAccessPolicy?: MemberAccessPolicy }> {
  const doc = await adminDb.collection('users').doc(uid).get()
  if (!doc.exists) return { role: 'client' }
  const data = doc.data() ?? {}
  const role = data.role
  const validRole: ApiRole = role === 'admin' || role === 'client' || role === 'ai' ? role : 'client'
  const orgId = typeof data.orgId === 'string' ? data.orgId : undefined
  const orgIds: string[] = Array.isArray(data.orgIds)
    ? (data.orgIds.filter((v: unknown) => typeof v === 'string' && v.length > 0) as string[])
    : (orgId ? [orgId] : [])
  const allowedOrgIds = Array.isArray(data.allowedOrgIds)
    ? (data.allowedOrgIds.filter((v: unknown) => typeof v === 'string' && v.length > 0) as string[])
    : undefined
  const activeOrgId = typeof data.activeOrgId === 'string' && data.activeOrgId ? data.activeOrgId : orgId
  const memberAccessPolicy = activeOrgId ? await loadMemberAccessPolicy(uid, activeOrgId) : undefined
  return { role: validRole, orgId, activeOrgId, orgIds: orgIds.length > 0 ? orgIds : undefined, allowedOrgIds, memberAccessPolicy }
}

async function loadMemberAccessPolicy(uid: string, orgId: string): Promise<MemberAccessPolicy | undefined> {
  try {
    const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (!memberDoc.exists) return undefined
    const data = memberDoc.data() ?? {}
    return resolveMemberAccessPolicy({
      role: (data.role as OrgRole | undefined) ?? 'viewer',
      accessScope: data.accessScope,
      accessPolicy: data.accessPolicy,
    })
  } catch {
    return undefined
  }
}
