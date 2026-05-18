/**
 * Multi-Tenant Middleware — Resolves and enforces orgId on all social API routes.
 *
 * Resolves orgId from:
 *  - AI agent: X-Org-Id header (required)
 *  - Admin: orgId query param (optional, defaults to 'default')
 *  - Client: derived from their user record (enforced, cannot access others)
 *
 * Usage: wrap a handler after withAuth:
 *   export const GET = withAuth('admin', withTenant(async (req, user, orgId) => { ... }))
 */
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError } from './response'
import type { ApiUser } from './types'
import { canAccessOrg, restrictedAdminOrgIds } from './platformAdmin'

/** The default orgId for single-tenant / admin operations */
export const DEFAULT_ORG_ID = 'default'

type TenantHandler = (
  req: NextRequest,
  user: ApiUser,
  orgId: string,
  context?: Record<string, unknown>,
) => Promise<NextResponse>

/**
 * Wraps a route handler to resolve and inject orgId.
 * Must be used inside a withAuth wrapper (receives the ApiUser).
 */
export function withTenant(handler: TenantHandler) {
  return async (req: NextRequest, user: ApiUser, context?: Record<string, unknown>): Promise<NextResponse> => {
    const orgId = await resolveOrgId(req, user)
    if (!orgId) {
      return apiError('X-Org-Id header is required for AI agent requests', 400)
    }
    return handler(req, user, orgId, context)
  }
}

/**
 * Resolve the orgId for the current request based on the user's role.
 */
async function resolveOrgId(req: NextRequest, user: ApiUser): Promise<string | null> {
  switch (user.role) {
    case 'ai': {
      // AI agent must provide X-Org-Id header
      const orgId = req.headers.get('x-org-id')
      return orgId || null
    }

    case 'admin': {
      // Super admins can optionally specify orgId. Restricted admins are
      // always scoped to their assigned client orgs.
      const { searchParams } = new URL(req.url)
      const requestedOrgId = searchParams.get('orgId')
      if (requestedOrgId) return canAccessOrg(user, requestedOrgId) ? requestedOrgId : null
      const allowed = restrictedAdminOrgIds(user)
      return allowed[0] ?? DEFAULT_ORG_ID
    }

    case 'client': {
      // Use activeOrgId if the client has switched workspaces, else fall back to orgId
      const userDoc = await adminDb.collection('users').doc(user.uid).get()
      if (!userDoc.exists) return DEFAULT_ORG_ID
      const data = userDoc.data()!
      return (data.activeOrgId as string | undefined) ?? (data.orgId as string | undefined) ?? DEFAULT_ORG_ID
    }

    default:
      return null
  }
}

/**
 * Quick helper to get the orgId from a request + user without the middleware wrapper.
 * Useful in cron jobs and internal functions.
 */
export async function getOrgId(req: NextRequest, user: ApiUser): Promise<string> {
  const orgId = await resolveOrgId(req, user)
  return orgId ?? DEFAULT_ORG_ID
}
