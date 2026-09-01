import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { ROLE_RANK } from '@/lib/orgMembers/types'
import type { OrgRole } from '@/lib/organizations/types'
import { resolveAgentApiKeyUser } from '@/lib/api/auth'
import { resolveDelegationBearerUser } from '@/lib/api/delegations'
import type { ApiAuthKind, ApiPermission, ApiUser } from '@/lib/api/types'
import {
  AGENT_PIP_REF,
  buildHumanRef,
  type MemberRef,
} from '@/lib/orgMembers/memberRef'
import { canUsePortalOrg, resolvePortalActiveOrgId } from '@/lib/portal/org-access'
import { isActiveOrgMembershipRow, isOrgRole, type OrgMemberRow } from '@/lib/orgMembers/active-membership'
import {
  FULL_ACCESS_POLICY,
  canAccessModule,
  resolveEffectiveMemberPolicy,
  type MemberAccessPolicy,
} from '@/lib/orgMembers/access-policy'

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
  uid?: string
  actor: MemberRef
  role: CrmRole
  isAgent: boolean
  permissions: OrgPermissions
  accessPolicy: MemberAccessPolicy
  user?: {
    uid: string
    role?: string
    authKind?: ApiAuthKind
    agentId?: string
    apiKeyId?: string
    delegationId?: string
    actingForUserId?: string
    delegationScopes?: string[]
    permissions?: ApiPermission[]
    orgId?: string
    activeOrgId?: string
    orgIds?: string[]
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
  modulePolicies?: unknown
  members: Array<{ userId: string; role: OrgRole; accessScope?: unknown; accessPolicy?: unknown }> | null
  exists: boolean
}> {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return { permissions: {}, modulePolicies: undefined, members: null, exists: false }
  const data = orgDoc.data() ?? {}
  // Deleted, archived, suspended and churned organisations are not operable —
  // no member can act through them regardless of their membership row.
  if (
    data.deleted === true ||
    data.archived === true ||
    (typeof data.status === 'string' && ['suspended', 'churned'].includes(data.status.trim().toLowerCase()))
  ) {
    return { permissions: {}, modulePolicies: undefined, members: null, exists: false }
  }
  const settings = (data.settings as Record<string, unknown> | undefined) ?? {}
  return {
    permissions: (settings.permissions as OrgPermissions) ?? {},
    modulePolicies: settings.modulePolicies,
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

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function delegationAllowsOrg(user: ApiUser, orgId: string): boolean {
  const allowed = new Set<string>()
  if (user.orgId) allowed.add(user.orgId)
  if (user.activeOrgId) allowed.add(user.activeOrgId)
  for (const id of user.orgIds ?? []) allowed.add(id)
  for (const id of user.allowedOrgIds ?? []) allowed.add(id)
  // Empty allow-set means the mint record lacked org claims — fail closed.
  if (allowed.size === 0) return false
  return allowed.has(orgId)
}

async function resolveHumanCrmMembership(input: {
  uid: string
  orgId: string
  minRole: Exclude<CrmRole, 'system'>
}): Promise<
  | { ok: true; role: OrgRole; actor: MemberRef; permissions: OrgPermissions; accessPolicy: MemberAccessPolicy }
  | { ok: false; response: Response }
> {
  const { uid, orgId, minRole } = input
  const memberSnap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  let role: OrgRole | null = null
  let actor: MemberRef | null = null
  let accessScope: unknown
  let storedAccessPolicy: unknown
  if (memberSnap.exists) {
    const m = memberSnap.data() ?? {}
    // Only ACTIVE membership rows grant CRM authority. Disabled, revoked,
    // deleted and inactive rows are rejected by the canonical predicate.
    if (isActiveOrgMembershipRow(m as OrgMemberRow)) {
      role = isOrgRole(m.role) ? m.role : null
      if (role) {
        actor = buildHumanRef(uid, m)
        accessScope = m.accessScope
        storedAccessPolicy = m.accessPolicy
      }
    }
  }

  const { permissions, modulePolicies, members, exists: orgExists } = await loadOrgPermissions(orgId)
  if (!orgExists) return { ok: false, response: apiError('Organization not found', 404) }

  if (!role) {
    const fallback = members?.find((m) => m.userId === uid && isActiveOrgMembershipRow(m as OrgMemberRow))
    if (fallback) {
      role = isOrgRole(fallback.role) ? fallback.role : null
      if (role) {
        actor = { uid, displayName: uid, kind: 'human' }
        accessScope = fallback.accessScope
        storedAccessPolicy = fallback.accessPolicy
      }
    }
  }

  if (!role || !actor) return { ok: false, response: apiError('Workspace membership not found', 403) }
  if (rankOf(role) < rankOf(minRole)) return { ok: false, response: apiError('Insufficient permissions', 403) }
  const accessPolicy = resolveEffectiveMemberPolicy({
    role,
    accessScope,
    accessPolicy: storedAccessPolicy,
    orgModulePolicies: modulePolicies,
  })
  if (!canAccessModule(accessPolicy, 'crm')) {
    return { ok: false, response: apiError('CRM module access is disabled for this team member', 403) }
  }

  return { ok: true, role, actor, permissions, accessPolicy }
}

async function resolveDelegationCrmContext(
  req: NextRequest,
  delegationUser: ApiUser,
  minRole: Exclude<CrmRole, 'system'>,
): Promise<CrmAuthContext | Response> {
  const actingUid = (delegationUser.actingForUserId || delegationUser.uid || '').trim()
  if (!actingUid) return apiError('Invalid delegation token', 401)

  const requestedOrgId =
    req.headers.get('x-org-id')?.trim() ||
    new URL(req.url).searchParams.get('orgId')?.trim() ||
    ''
  const orgId = requestedOrgId || delegationUser.activeOrgId || delegationUser.orgId || ''
  if (!orgId) return apiError('Missing X-Org-Id header', 400)
  if (!delegationAllowsOrg(delegationUser, orgId)) {
    return apiError('Delegation is not scoped to this organization', 403)
  }

  const userDoc = await adminDb.collection('users').doc(actingUid).get()
  if (!userDoc.exists) return apiError('User not found', 404)
  const userData = userDoc.data() ?? {}

  const allowed = await canUsePortalOrg(actingUid, userData, orgId)
  if (!allowed) return apiError('You do not have access to this workspace', 403)

  const membership = await resolveHumanCrmMembership({ uid: actingUid, orgId, minRole })
  if (!membership.ok) return membership.response

  return {
    orgId,
    uid: actingUid,
    actor: membership.actor,
    role: membership.role,
    // Keep human privilege model: delegation must not inherit system/agent CRM bypasses.
    isAgent: false,
    permissions: membership.permissions,
    accessPolicy: membership.accessPolicy,
    user: {
      uid: actingUid,
      role: typeof userData.role === 'string' ? userData.role : delegationUser.role,
      authKind: 'user_delegation',
      agentId: delegationUser.agentId,
      apiKeyId: delegationUser.apiKeyId,
      delegationId: delegationUser.delegationId,
      actingForUserId: actingUid,
      delegationScopes: delegationUser.delegationScopes,
      permissions: delegationUser.permissions,
      orgId: typeof userData.orgId === 'string' ? userData.orgId : orgId,
      activeOrgId: orgId,
      orgIds: Array.isArray(delegationUser.orgIds) ? delegationUser.orgIds : [orgId],
      allowedOrgIds: Array.isArray(userData.allowedOrgIds)
        ? cleanStringArray(userData.allowedOrgIds)
        : delegationUser.allowedOrgIds,
    },
  }
}

export function withCrmAuth(
  minRole: Exclude<CrmRole, 'system'>,
  handler: CrmRouteHandler,
): (req: NextRequest) => Promise<Response>
export function withCrmAuth<RouteCtx>(
  minRole: Exclude<CrmRole, 'system'>,
  handler: CrmRouteHandler<RouteCtx>,
): (req: NextRequest, routeCtx: RouteCtx) => Promise<Response>
export function withCrmAuth<RouteCtx = unknown>(
  minRole: Exclude<CrmRole, 'system'>,
  handler: CrmRouteHandler<RouteCtx>,
) {
  return async (req: NextRequest, routeCtx?: RouteCtx): Promise<Response> => {
    const authHeader = req.headers.get('authorization') ?? ''

    // Bearer path
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7)

      // 1. User-delegation tokens (Messages / interactive Hermes runs).
      // Expired Messages dlg tokens remint once; a pib_dlg_ bearer never
      // falls through to AI_API_KEY.
      if (token.startsWith('pib_dlg_')) {
        const delegationUser = await resolveDelegationBearerUser(token)
        if (!delegationUser) return apiError('Unauthorized', 401)
        const resolved = await resolveDelegationCrmContext(req, delegationUser, minRole)
        if (resolved instanceof Response) return resolved
        return handler(req, resolved, routeCtx)
      }

      // 2. Legacy shared AI key or per-agent API key (cron / system only).
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
        uid: actor.uid,
        actor,
        role: 'system',
        isAgent: true,
        permissions,
        accessPolicy: FULL_ACCESS_POLICY,
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
    const requestedOrgId =
      new URL(req.url).searchParams.get('orgId')?.trim() ||
      req.headers.get('x-org-id')?.trim() ||
      ''
    const activeOrgId = await resolvePortalActiveOrgId(uid, userData)
    let orgId = activeOrgId
    if (requestedOrgId) {
      const allowed = await canUsePortalOrg(uid, userData, requestedOrgId)
      if (!allowed) return apiError('You do not have access to this workspace', 403)
      orgId = requestedOrgId
    }
    if (!orgId) return apiError('No active workspace', 400)

    const membership = await resolveHumanCrmMembership({ uid, orgId, minRole })
    if (!membership.ok) return membership.response

    const ctx: CrmAuthContext = {
      orgId,
      uid,
      actor: membership.actor,
      role: membership.role,
      isAgent: false,
      permissions: membership.permissions,
      accessPolicy: membership.accessPolicy,
      user: {
        uid,
        role: typeof userData.role === 'string' ? userData.role : undefined,
        authKind: 'session',
        orgId: typeof userData.orgId === 'string' ? userData.orgId : orgId,
        allowedOrgIds: cleanStringArray(userData.allowedOrgIds),
      },
    }
    return handler(req, ctx, routeCtx)
  }
}
