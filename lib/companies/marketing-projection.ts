export function isProjectedCompanyMarketing(
  company: { orgId?: unknown; linkedOrgId?: unknown; deleted?: unknown },
  orgId: string,
): boolean {
  if (!orgId || company.deleted === true) return false
  const homeOrgId = typeof company.orgId === 'string' ? company.orgId.trim() : ''
  const linkedOrgId = typeof company.linkedOrgId === 'string' ? company.linkedOrgId.trim() : ''
  if (homeOrgId === orgId && linkedOrgId) return true
  if (linkedOrgId === orgId) return true
  return false
}

export type MarketingCompanyCard = {
  id: string
  name: string
  orgId: string
  linkedOrgId?: string
  logoUrl?: string
}

export function toMarketingCompanyCard(
  company: { id: string; name?: unknown; orgId?: unknown; linkedOrgId?: unknown; logoUrl?: unknown },
): MarketingCompanyCard {
  const linkedOrgId = typeof company.linkedOrgId === 'string' ? company.linkedOrgId.trim() : ''
  const logoUrl = typeof company.logoUrl === 'string' ? company.logoUrl.trim() : ''
  return {
    id: company.id,
    name: typeof company.name === 'string' && company.name.trim() ? company.name.trim() : 'Unnamed company',
    orgId: typeof company.orgId === 'string' ? company.orgId.trim() : '',
    ...(linkedOrgId ? { linkedOrgId } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  }
}
