import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiErrorFromException } from '@/lib/api/response'
import type { OrgMember, OrgRole } from '@/lib/organizations/types'
import { ORG_WORKSPACES_COLLECTION, type OrgWorkspaceRecord } from '@/lib/client-provisioning/workspace-context'
import { discoverAuthorizedRuntimeTargets, type PublicAuthorizedRuntimeTarget } from '@/lib/linked-computers/runtime-targets'
import {
  accessSummaryForPolicy,
  normalizeMemberAccessPolicy,
  resolveEffectiveMemberPolicy,
} from '@/lib/orgMembers/access-policy'
import { resolveOrganizationModulePolicies } from '@/lib/organizations/module-policies'

export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ uid: string }> }
type StoredMember = OrgMember & { uid?: string }

function memberUid(member: StoredMember): string {
  return member.userId || member.uid || ''
}

/**
 * Lists the computers the edited member can already use. This must be resolved
 * for that member (rather than the administrator editing their policy): a
 * selected-user computer grant can legitimately differ between the two people.
 * It deliberately reads active mappings only, so editing agent permissions
 * never creates a folder mapping or asks the operator to enter a host path.
 */
async function loadMemberRuntimeTargets(orgId: string, userId: string): Promise<PublicAuthorizedRuntimeTarget[]> {
  const [workspaceSnapshot, sharedAgentSnapshot] = await Promise.all([
    adminDb.collection(ORG_WORKSPACES_COLLECTION)
      .where('orgId', '==', orgId)
      .where('status', '==', 'active')
      .get(),
    adminDb.collection('agent_team')
      .where('scopeOrgId', '==', orgId)
      .get(),
  ])
  const grantableSharedAgentIds = sharedAgentSnapshot.docs
    .map((doc) => doc.data())
    .filter((agent) => agent.enabled !== false
      && agent.accessScope === 'organization'
      && agent.provisioningStatus === 'ready')
    .map((agent) => String(agent.agentId))
  const workspaces = workspaceSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as OrgWorkspaceRecord)
    .filter((workspace) => typeof workspace.workspaceId === 'string' && workspace.workspaceId.length > 0)

  const byRuntimeId = new Map<string, PublicAuthorizedRuntimeTarget>()
  for (const workspace of workspaces) {
    const targets = await discoverAuthorizedRuntimeTargets({
      userId,
      orgId,
      workspaceId: workspace.workspaceId,
    })
    for (const target of targets) {
      // A single computer may have several Workspace folders. Agent access is
      // intentionally per computer, so show it once and preserve its existing
      // mapping entirely outside this settings panel.
      if (!byRuntimeId.has(target.id)) byRuntimeId.set(target.id, target)
    }
  }
  return Array.from(byRuntimeId.values())
    .map((target) => ({
      ...target,
      // Shared agents are intentionally grantable before they are installed on
      // the member's computer. The grant authorizes the later signed pull,
      // which then keeps the profile in sync on that destination.
      availableAgentIds: Array.from(new Set([
        ...(Array.isArray(target.availableAgentIds) ? target.availableAgentIds : []),
        ...grantableSharedAgentIds,
      ])),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

async function loadOrgModulePolicies(orgId: string): Promise<unknown> {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return undefined
    const settings = (orgDoc.data()?.settings ?? {}) as Record<string, unknown>
    return settings.modulePolicies
  } catch {
    return undefined
  }
}

async function loadMemberAccess(orgId: string, targetUid: string, orgModulePolicies?: unknown) {
  const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`).get()
  if (memberDoc.exists) {
    const data = memberDoc.data() ?? {}
    const role = data.role as OrgRole
    const accessPolicy = resolveEffectiveMemberPolicy({
      role,
      accessScope: data.accessScope,
      accessPolicy: data.accessPolicy,
      orgModulePolicies,
    })
    return {
      exists: true,
      role,
      accessScope: typeof data.accessScope === 'string' ? data.accessScope : '',
      accessPolicy,
      hasExplicitAccessPolicy: Boolean(data.accessPolicy && typeof data.accessPolicy === 'object'),
    }
  }

  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  const members = (orgDoc.exists ? orgDoc.data()?.members : []) as StoredMember[]
  const fallback = members.find((member) => memberUid(member) === targetUid)
  if (!fallback) return { exists: false as const }

  const role = fallback.role as OrgRole
  const accessPolicy = resolveEffectiveMemberPolicy({
    role,
    accessScope: fallback.accessScope,
    accessPolicy: fallback.accessPolicy,
    orgModulePolicies,
  })
  return {
    exists: true,
    role,
    accessScope: fallback.accessScope ?? '',
    accessPolicy,
    hasExplicitAccessPolicy: Boolean(fallback.accessPolicy && typeof fallback.accessPolicy === 'object'),
  }
}

export const GET = withPortalAuthAndRole(
  'admin',
  async (_req: NextRequest, _uid: string, orgId: string, _role: OrgRole, { params }: RouteCtx) => {
    try {
      const { uid: targetUid } = await params
      const orgModulePolicies = await loadOrgModulePolicies(orgId)
      const loaded = await loadMemberAccess(orgId, targetUid, orgModulePolicies)
      if (!loaded.exists) return apiError('Team member not found', 404)

      return NextResponse.json({
        uid: targetUid,
        role: loaded.role,
        accessScope: loaded.accessScope,
        accessPolicy: loaded.accessPolicy,
        hasExplicitAccessPolicy: loaded.hasExplicitAccessPolicy,
        // Org modulePolicies act as the default matrix when the member has no
        // explicit per-action flags — the editor shows these as effective defaults.
        orgModulePolicies: resolveOrganizationModulePolicies({ modulePolicies: orgModulePolicies }),
        accessSummary: accessSummaryForPolicy(loaded.accessPolicy),
        // A missing/stale catalogue must not prevent access-policy editing.
        // Dispatch independently reauthorizes the live computer grant.
        agentRuntimeTargets: await loadMemberRuntimeTargets(orgId, targetUid).catch(() => []),
      })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)

export const PATCH = withPortalAuthAndRole(
  'admin',
  async (req: NextRequest, _uid: string, orgId: string, _role: OrgRole, { params }: RouteCtx) => {
    try {
      const { uid: targetUid } = await params
      const body = await req.json().catch(() => ({}))
      const loaded = await loadMemberAccess(orgId, targetUid)
      if (!loaded.exists) return apiError('Team member not found', 404)
      if (loaded.role === 'owner') return apiError('Cannot change the access policy of the workspace owner', 403)

      const accessPolicy = normalizeMemberAccessPolicy((body as { accessPolicy?: unknown }).accessPolicy)
      const orgRef = adminDb.collection('organizations').doc(orgId)
      const orgDoc = await orgRef.get()
      const batch = adminDb.batch()

      batch.set(
        adminDb.collection('orgMembers').doc(`${orgId}_${targetUid}`),
        {
          accessPolicy,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      if (orgDoc.exists) {
        const members = ((orgDoc.data()?.members ?? []) as StoredMember[]).map((member) => (
          memberUid(member) === targetUid ? { ...member, accessPolicy } : member
        ))
        batch.update(orgRef, { members, updatedAt: FieldValue.serverTimestamp() })
      }

      await batch.commit()

      return NextResponse.json({
        uid: targetUid,
        role: loaded.role,
        accessPolicy,
        accessSummary: accessSummaryForPolicy(accessPolicy),
      })
    } catch (err) {
      return apiErrorFromException(err)
    }
  },
)
