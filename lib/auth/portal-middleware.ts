// lib/auth/portal-middleware.ts
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import type { OrgRole } from '@/lib/organizations/types'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import { isActiveOrgMembershipRow, isOrgRole, type OrgMemberRow } from '@/lib/orgMembers/active-membership'
import { canUsePortalOrg, resolvePortalActiveOrgId, adminAssignedOrgIds } from '@/lib/portal/org-access'

type PortalHandler = (
  req: NextRequest,
  uid: string,
  // Route context is forwarded without inspecting it so typed Next handlers can keep their own param shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<Response>

export function withPortalAuth(handler: PortalHandler) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (req: NextRequest, ...args: any[]): Promise<Response> => {
    const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
    const sessionCookie = req.cookies.get(cookieName)?.value
    if (!sessionCookie) return apiError('Unauthorized', 401)
    try {
      const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
      return handler(req, decoded.uid, ...args)
    } catch {
      return apiError('Unauthorized', 401)
    }
  }
}

type PortalRoleHandler = (
  req: NextRequest,
  uid: string,
  orgId: string,
  role: OrgRole,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Promise<Response>

export function withPortalAuthAndRole(minRole: OrgRole, handler: PortalRoleHandler) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withPortalAuth(async (req: NextRequest, uid: string, ...args: any[]) => {
    const userDoc = await adminDb.collection('users').doc(uid).get()
    if (!userDoc.exists) return apiError('User not found', 404)
    const userData = userDoc.data()!
    const requestedOrgId =
      req.nextUrl.searchParams.get('orgId')?.trim() ||
      req.headers.get('x-org-id')?.trim() ||
      ''
    let orgId = await resolvePortalActiveOrgId(uid, userData)
    if (requestedOrgId) {
      const allowed = await canUsePortalOrg(uid, userData, requestedOrgId)
      if (!allowed) return apiError('You do not have access to this workspace', 403)
      orgId = requestedOrgId
    }
    if (!orgId) return apiError('No active workspace', 400)

    let role = await resolveActiveMemberRole(uid, orgId)

    // Assigned platform admins (allowedOrgIds or their home org) can enter the
    // org through canUsePortalOrg even when they are not duplicated into the
    // orgMembers collection. Preserve that legitimate assigned-admin access,
    // but NEVER elevate implicitly to owner — the ceiling is admin.
    if (!role && userData.role === 'admin' && adminAssignedOrgIds(userData).includes(orgId)) {
      role = 'admin'
    }

    if (!role) return apiError('Workspace membership not found', 403)
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) return apiError('Insufficient permissions', 403)

    return handler(req, uid, orgId, role, ...args)
  })
}

/**
 * Resolve the member's role from ACTIVE membership sources only:
 *   1. canonical orgMembers row
 *   2. legacy organizations.members array entry
 * Disabled, revoked, deleted and inactive rows never yield a role.
 */
export async function resolveActiveMemberRole(uid: string, orgId: string): Promise<OrgRole | null> {
  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  if (memberDoc.exists) {
    const row = memberDoc.data() ?? {}
    if (isActiveOrgMembershipRow(row as OrgMemberRow)) {
      const role = row.role
      if (isOrgRole(role)) return role
    }
  }

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (orgDoc.exists) {
    const members: Array<Record<string, unknown>> = orgDoc.data()!.members ?? []
    const member = members.find((m) => {
      if (!m || typeof m !== 'object') return false
      const entry = m as OrgMemberRow
      const entryUid = typeof entry.userId === 'string' ? entry.userId : typeof entry.uid === 'string' ? entry.uid : ''
      return entryUid === uid && isActiveOrgMembershipRow(entry)
    })
    if (member) {
      const role = (member as OrgMemberRow).role
      if (isOrgRole(role)) return role
    }
  }

  return null
}
