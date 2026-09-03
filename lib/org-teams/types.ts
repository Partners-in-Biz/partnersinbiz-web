export const ORG_TEAMS_COLLECTION = 'org_teams'
export const ORG_TEAM_SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/
export const ORG_TEAM_MAX_MEMBERS = 500

export type OrgTeamStatus = 'active' | 'archived'

export interface OrgTeam {
  teamId: string
  orgId: string
  slug: string
  name: string
  description: string
  memberUserIds: string[]
  leadUserIds: string[]
  createdByUserId: string
  status: OrgTeamStatus
  createdAt: unknown
  updatedAt: unknown
  archivedAt?: unknown
}

export function orgTeamId(orgId: string, slug: string): string {
  return `${orgId}_${slug}`
}

export function normalizeOrgTeamSlug(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
