import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import type { OrgRole } from '@/lib/organizations/types'
import { resolveAgentApiKeyUser } from '@/lib/api/auth'
import type { ApiAuthKind, ApiPermission } from '@/lib/api/types'
import {
  AGENT_PIP_REF,
  buildHumanRef,
  type MemberRef,
} from '@/lib/orgMembers/memberRef'
import { resolvePortalActiveOrgId } from '@/lib/portal/org-access'

export type CrmRole = OrgRole | 'system'

const SYSTEM_RANK = 5
function rankOf(role: CrmRole): number {
  return role === 'system' ? SYSTEM_RANK : ROLE_RANK[role]
}

export interface OrgPermissions {
  membersCanDeleteContacts?: boolean
  membersCanExportContacts?: boolean
}

export interface CrmAuthContext {
  orgId: string
  actor: MemberRef
  role: CrmRole
  isAgent: boolean
  permissions: OrgPermissions
  user?: {
    uid: string
    role?: string
    authKind?: ApiAuthKind
    agentId?: string
    apiKeyId?: string
    permissions?: ApiPermission[]
    orgId?: string
    allowedOrgIds?: string[]
  }
}

export type CrmRouteHandler<RouteCtx = unknown> = (
  req: NextRequest,
  ctx: CrmAuthContext,
  routeCtx?: RouteCtx,
) => Promise<Response>

function apiError(message: string, status: number): Response {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function loadOrgPermissions(orgId: string): Promise<{
  permissions: OrgPermissions
  members: Array<{ userId: string; role: OrgRole }> | null
  exists: boolean
}> {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return { permissions: {}, members: null, exists: false }
  const data = orgDoc.data() ?? {}
  return {
    permissions:
      ((data.settings as Record<string, unknown> | undefined)?.permissions as OrgPermissions) ?? {},
    members: (data.members as Array<{ userId: string; role: OrgRole }> | undefined) ?? null,
    exists: true,
  }
}

function agentRefFor(agentId: string | undefined): MemberRef {
  const cleanAgentId = agentId?.trim()
  if (!cleanAgentId || cleanAgentId === 'pip') return AGENT_PIP_REF

  return {
    uid: `agent:${cleanAgentId}`,
    displayName: cleanAgentId,
    jobTitle: 'AI Agent',
    kind: 'agent',
  }
}

export function withCrmAuth<RouteCtx = unknown>(
  minRole: Exclude<CrmRole, 'system'>,
  handler: CrmRouteHandler<RouteCtx>,
) {
  return async (req: NextRequest, routeCtx?: RouteCtx): Promise<Response> => {
    const authHeader = req.headers.get('authorization') ?? ''

    // Bearer path
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const aiKey = process.env.AI_API_KEY
      const isLegacyAiKey = Boolean(aiKey && token === aiKey)
      const agentUser = isLegacyAiKey ? null : await resolveAgentApiKeyUser(token)
      if (!isLegacyAiKey && !agentUser) return apiError('Invalid API key', 401)

      const requestedOrgId = req.headers.get('x-org-id') ?? ''
      if (agentUser?.orgId && requestedOrgId && requestedOrgId !== agentUser.orgId) {
        return apiError('API key is not scoped to this organization', 403)
      }

      const orgId = requestedOrgId || agentUser?.orgId || ''
      if (!orgId) {
        return apiError('Missing X-Org-Id header', 400)
      }
      const { permissions, exists: orgExists } = await loadOrgPermissions(orgId)
      if (!orgExists) return apiError('Organization not found', 404)
      const actor = agentUser ? agentRefFor(agentUser.agentId) : AGENT_PIP_REF
      const ctx: CrmAuthContext = {
        orgId,
        actor,
        role: 'system',
        isAgent: true,
        permissions,
        user: {
          uid: actor.uid,
          role: 'ai',
          authKind: agentUser?.authKind ?? 'legacy_ai_key',
          agentId: agentUser?.agentId,
          apiKeyId: agentUser?.apiKeyId,
          permissions: agentUser?.permissions,
          orgId,
        },
      }
      return handler(req, ctx, routeCtx)
    }

    // Cookie path
    const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
    const cookie = req.cookies.get(cookieName)?.value
    if (!cookie) return apiError('Unauthorized', 401)

    let uid: string
    try {
      const decoded = await adminAuth.verifySessionCookie(cookie, true)
      uid = decoded.uid
    } catch {
      return apiError('Invalid session', 401)
    }

    const userDoc = await adminDb.collection('users').doc(uid).get()
    if (!userDoc.exists) return apiError('User not found', 404)
    const userData = userDoc.data() ?? {}
    const orgId = await resolvePortalActiveOrgId(uid, userData)
    if (!orgId) return apiError('No active workspace', 400)

    const memberSnap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    let role: OrgRole | null = null
    let actor: MemberRef | null = null
    if (memberSnap.exists) {
      const m = memberSnap.data() ?? {}
      role = (m.role as OrgRole) ?? null
      actor = buildHumanRef(uid, m)
    }

    const { permissions, members } = await loadOrgPermissions(orgId)

    if (!role) {
      const fallback = members?.find((m) => m.userId === uid)
      if (fallback) {
        role = fallback.role
        actor = { uid, displayName: uid, kind: 'human' }
      }
    }

    if (!role || !actor) return apiError('Workspace membership not found', 403)
    if (rankOf(role) < rankOf(minRole)) return apiError('Insufficient permissions', 403)

    const ctx: CrmAuthContext = {
      orgId,
      actor,
      role,
      isAgent: false,
      permissions,
      user: {
        uid,
        role: typeof userData.role === 'string' ? userData.role : undefined,
        orgId: typeof userData.orgId === 'string' ? userData.orgId : orgId,
        allowedOrgIds: Array.isArray(userData.allowedOrgIds)
          ? userData.allowedOrgIds.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
          : undefined,
      },
    }
    return handler(req, ctx, routeCtx)
  }
}
