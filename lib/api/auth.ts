import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from './response'
import type { ApiRole, ApiUser } from './types'
import { canAccessOrg } from './platformAdmin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: NextRequest, user: ApiUser, context?: any) => Promise<Response>

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withAuth(requiredRole: 'admin' | 'client', handler: RouteHandler): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    if (aiKey && token === aiKey) {
      return { uid: 'ai-agent', role: 'ai' }
    }

    // 2. Verify as Firebase ID token
    try {
      const decoded = await adminAuth.verifyIdToken(token)
      const extras = await getUserExtrasFromFirestore(decoded.uid)
      return { uid: decoded.uid, ...extras }
    } catch {
      // fall through to cookie check
    }
  }

  // 3. Session cookie
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const cookie = req.cookies.get(cookieName)?.value
  if (cookie) {
    try {
      const decoded = await adminAuth.verifySessionCookie(cookie, true)
      const extras = await getUserExtrasFromFirestore(decoded.uid)
      return { uid: decoded.uid, ...extras }
    } catch {
      return null
    }
  }

  return null
}

async function getUserExtrasFromFirestore(
  uid: string,
): Promise<{ role: ApiRole; orgId?: string; orgIds?: string[]; allowedOrgIds?: string[] }> {
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
  return { role: validRole, orgId, orgIds: orgIds.length > 0 ? orgIds : undefined, allowedOrgIds }
}
