import {
  CrossOrgPolicyService,
  FirestoreCrossOrgPolicyStore,
  type CrossOrgReasonCode,
} from '@/lib/cross-org/policy-service'
import { adminDb } from '@/lib/firebase/admin'
import { isActiveOrgMembershipRow } from '@/lib/orgMembers/active-membership'
import type { ProjectMemberRole } from '@/lib/projects/collaboration'

const PROJECT_ROLE_RANK: Record<ProjectMemberRole, number> = {
  viewer: 0,
  reviewer: 1,
  contributor: 2,
  manager: 3,
  owner: 4,
}

function projectRoleRank(actorRole: string | undefined, requiredRole: string): boolean {
  const actor = actorRole as ProjectMemberRole
  const required = requiredRole as ProjectMemberRole
  return PROJECT_ROLE_RANK[actor] !== undefined
    && PROJECT_ROLE_RANK[required] !== undefined
    && PROJECT_ROLE_RANK[actor] >= PROJECT_ROLE_RANK[required]
}

function cleanTeamIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((teamId): teamId is string => typeof teamId === 'string')
    .map((teamId) => teamId.trim())
    .filter(Boolean)))
}

async function loadTrustedActorTeamIds(actor: { uid: string; orgId: string }): Promise<string[]> {
  const snap = await adminDb.collection('orgMembers').doc(`${actor.orgId}_${actor.uid}`).get()
  if (!snap.exists) return []
  const member = snap.data() ?? {}
  return isActiveOrgMembershipRow(member) ? cleanTeamIds(member.teamIds) : []
}

export interface ProjectCrossOrgGrantInput {
  projectId: string
  ownerOrgId: string
  partnerLinkId: string
  actor: { uid: string; orgId: string }
  projectRole: ProjectMemberRole
  action: 'project.read' | 'project.write'
  item?: string
}

export type ProjectCrossOrgGrantResult =
  | { allowed: true; grant: { grantId: string; actions: string[]; items: string[] } }
  | { allowed: false; reasonCode: CrossOrgReasonCode }

/**
 * The one project adapter seam into the canonical cross-org policy chain. A
 * projectOrganizations row is a local projection only; it cannot authorise a
 * partner without a live canonical PartnerResourceGrant.
 */
export async function resolveProjectCrossOrgGrant(
  input: ProjectCrossOrgGrantInput,
): Promise<ProjectCrossOrgGrantResult> {
  const service = new CrossOrgPolicyService(new FirestoreCrossOrgPolicyStore())
  const actorTeamIds = await loadTrustedActorTeamIds(input.actor)
  const decision = await service.decide({
    actor: { userId: input.actor.uid, orgId: input.actor.orgId },
    actorTeamIds,
    resourceType: 'project',
    resourceId: input.projectId,
    action: input.action,
    item: input.item,
    partnerLinkId: input.partnerLinkId,
    requiredCapability: 'projects',
    resourceOwnerOrgId: input.ownerOrgId,
    actorRole: input.projectRole,
    roleRank: projectRoleRank,
  })
  if (!decision.allowed || !decision.resourceGrantId) {
    return { allowed: false, reasonCode: decision.reasonCode }
  }
  return {
    allowed: true,
    grant: {
      grantId: decision.resourceGrantId,
      actions: [input.action],
      items: decision.projection?.items ?? [],
    },
  }
}
