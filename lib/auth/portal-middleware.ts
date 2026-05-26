// lib/auth/portal-middleware.ts
import { NextRequest } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiError } from '@/lib/api/response'
import type { OrgRole } from '@/lib/organizations/types'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import { resolvePortalActiveOrgId } from '@/lib/portal/org-access'

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
    const sessionCookie = req.cookies.get('__session')?.value
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

function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && value in ROLE_RANK
}

export function withPortalAuthAndRole(minRole: OrgRole, handler: PortalRoleHandler) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withPortalAuth(async (req: NextRequest, uid: string, ...args: any[]) => {
    const userDoc = await adminDb.collection('users').doc(uid).get()
    if (!userDoc.exists) return apiError('User not found', 404)
    const userData = userDoc.data()!
    const orgId = await resolvePortalActiveOrgId(uid, userData)
    if (!orgId) return apiError('No active workspace', 400)

    let role: OrgRole | null = null
    const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (memberDoc.exists) {
      const memberRole = memberDoc.data()?.role
      role = isOrgRole(memberRole) ? memberRole : null
    }

    if (!role) {
      const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
      if (orgDoc.exists) {
        const members: Array<{ userId: string; role: OrgRole }> = orgDoc.data()!.members ?? []
        const m = members.find((m) => m.userId === uid)
        if (isOrgRole(m?.role)) role = m.role
      }
    }

    if (!role) return apiError('Workspace membership not found', 403)
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) return apiError('Insufficient permissions', 403)

    return handler(req, uid, orgId, role, ...args)
  })
}
