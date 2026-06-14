import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

interface DashboardOrgLinkSource {
  id?: string
  slug?: string
  type?: string
}

export function resolvePlatformAgentBoardHref(orgs: DashboardOrgLinkSource[]): string {
  const platformOrg = orgs.find((org) => (
    org.id === PIB_PLATFORM_ORG_ID || org.type === 'platform_owner'
  ))

  return platformOrg?.slug ? `/admin/org/${platformOrg.slug}/agent/board` : '/admin/agents'
}

export function resolvePlatformOrgAdminHref(orgs: DashboardOrgLinkSource[], path = 'dashboard'): string {
  const platformOrg = orgs.find((org) => (
    org.id === PIB_PLATFORM_ORG_ID || org.type === 'platform_owner'
  ))
  const trimmedPath = path.replace(/^\/+|\/+$/g, '')

  return platformOrg?.slug ? `/admin/org/${platformOrg.slug}/${trimmedPath}` : '/admin/organizations'
}
