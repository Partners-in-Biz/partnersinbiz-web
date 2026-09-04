import type { ApiUser } from '@/lib/api/types'
import { canManageOrgAs } from '@/lib/orgMembers/permissions'
import { archiveOrgTeam, type OrgTeamStoreOptions } from './store'
import type { OrgTeam } from './types'

export async function assertCanManageTeams(user: ApiUser, orgId: string): Promise<void> {
  const allowed = await canManageOrgAs(user, orgId, 'admin')
  if (!allowed) throw new Error('org teams: administrator required')
}

export async function assertCanEditTeamMembers(user: ApiUser, team: OrgTeam): Promise<void> {
  if (await canManageOrgAs(user, team.orgId, 'admin')) return
  if (team.leadUserIds.includes(user.uid)) return
  throw new Error('org teams: team lead or administrator required')
}

export async function archiveOrgTeamWithCascade(input: {
  orgId: string
  teamId: string
  actor: ApiUser
}, options: OrgTeamStoreOptions = {}): Promise<{
  team: OrgTeam
  revokedGrantIds: string[]
  revokedBindingIds: string[]
}> {
  const team = await archiveOrgTeam({
    orgId: input.orgId,
    teamId: input.teamId,
    actorUserId: input.actor.uid,
  }, options)
  try {
    const { revokeShareBindingsForTeam } = await import('@/lib/llm-providers/share-cascade')
    const revoked = await revokeShareBindingsForTeam({
      orgId: input.orgId,
      teamId: input.teamId,
      formerMemberUserIds: team.memberUserIds,
      actorUserId: input.actor.uid,
    })
    return { team, revokedGrantIds: revoked.grantIds, revokedBindingIds: revoked.bindingIds }
  } catch (error) {
    console.error('[org-teams-share-cascade]', error)
    return { team, revokedGrantIds: [], revokedBindingIds: [] }
  }
}
