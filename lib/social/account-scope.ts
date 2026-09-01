export const PERSONAL_SCOPE = 'personal'
export const ORG_SCOPE = 'org'

const COMPANY_ACCOUNT_TYPES = new Set(['page', 'business', 'organization', 'company'])
const BRAND_HANDLE_PLATFORMS = new Set(['bluesky'])
const COMPANY_PAGE_PLATFORMS = new Set(['facebook', 'linkedin'])
const ORG_BUSINESS_PLATFORMS = new Set(['instagram'])

export function isPersonalAccountRecord(account: { accountScope?: unknown }): boolean {
  return account.accountScope === PERSONAL_SCOPE
}

function accountKind(account: { accountType?: unknown; subAccountType?: unknown }): string {
  return String(account.accountType || account.subAccountType || '').toLowerCase()
}

export function isCompanyAccountType(value: unknown): boolean {
  return COMPANY_ACCOUNT_TYPES.has(String(value || '').toLowerCase())
}

export function isCompanyPagePlatform(platform: unknown): boolean {
  return COMPANY_PAGE_PLATFORMS.has(String(platform || '').toLowerCase())
}

export function isCompanyLinkedAccount(account: {
  accountScope?: unknown
  accountType?: unknown
  subAccountType?: unknown
  platform?: unknown
}): boolean {
  if (isPersonalAccountRecord(account)) return false
  if (isCompanyAccountType(accountKind(account))) return true
  const platform = String(account.platform || '').toLowerCase()
  // Bluesky has no page type. Brand handles connected in the company workspace stay here.
  if (BRAND_HANDLE_PLATFORMS.has(platform) && account.accountScope !== PERSONAL_SCOPE) return true
  // LinkedIn personal profiles are valid org posting identities until CMA
  // attaches a company page on the same app.
  if (platform === 'linkedin') return true
  // Instagram org rows are business identities even when a legacy fixture
  // omits accountType. Personal-scoped Instagram stays out of company social.
  if (ORG_BUSINESS_PLATFORMS.has(platform) && account.accountScope !== PERSONAL_SCOPE) return true
  return false
}

function campaignScopeFields(campaign: object): { accountScope?: unknown; ownerUid?: unknown } {
  const record = campaign as Record<string, unknown>
  return {
    accountScope: record.accountScope,
    ownerUid: record.ownerUid,
  }
}

export function isPersonalCampaignRecord(campaign: object): boolean {
  return campaignScopeFields(campaign).accountScope === PERSONAL_SCOPE
}

export function canAccessCampaign(campaign: object, uid: string): boolean {
  const { ownerUid } = campaignScopeFields(campaign)
  if (!isPersonalCampaignRecord(campaign)) return true
  return ownerUid === uid
}

export type MarketingOwnerKind = 'org' | 'company' | 'personal'

export type MarketingOwnerContext = {
  owner: MarketingOwnerKind
  uid?: string
  companyId?: string
}

function cleanScopeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function recordCompanyId(record: { companyId?: unknown }): string {
  return cleanScopeId(record.companyId)
}

export function brandKitDocId(orgId: string, owner: MarketingOwnerContext): string {
  const home = orgId.trim()
  if (!home) return ''
  if (owner.owner === 'personal') {
    const uid = cleanScopeId(owner.uid)
    return uid ? `${home}__personal_${uid}` : home
  }
  if (owner.owner === 'company') {
    const companyId = cleanScopeId(owner.companyId)
    return companyId ? `${home}__company_${companyId}` : home
  }
  return home
}

export function ownerFieldsForWrite(owner: MarketingOwnerContext): Record<string, unknown> {
  if (owner.owner === 'personal') {
    const uid = cleanScopeId(owner.uid)
    return {
      accountScope: PERSONAL_SCOPE,
      marketingOwner: 'personal',
      ...(uid ? { ownerUid: uid } : {}),
    }
  }
  if (owner.owner === 'company' && owner.companyId) {
    return {
      marketingOwner: 'company',
      companyId: owner.companyId,
    }
  }
  return { marketingOwner: 'org' }
}

export function resolveMarketingOwnerFromValues(input: {
  personal?: boolean
  scope?: unknown
  companyId?: unknown
  sourceCompanyId?: unknown
  uid?: string
}): MarketingOwnerContext {
  if (input.personal || cleanScopeId(input.scope) === PERSONAL_SCOPE) {
    const uid = cleanScopeId(input.uid)
    return { owner: 'personal', ...(uid ? { uid } : {}) }
  }
  const companyId = cleanScopeId(input.companyId) || cleanScopeId(input.sourceCompanyId)
  if (companyId) return { owner: 'company', companyId }
  return { owner: 'org' }
}

export function resolveMarketingOwnerFromSearchParams(
  searchParams: URLSearchParams,
  uid?: string,
): MarketingOwnerContext {
  return resolveMarketingOwnerFromValues({
    personal: searchParams.get('scope') === PERSONAL_SCOPE,
    scope: searchParams.get('scope'),
    companyId: searchParams.get('companyId'),
    sourceCompanyId: searchParams.get('sourceCompanyId'),
    uid,
  })
}

export function recordVisibleForOwner(
  record: {
    accountScope?: unknown
    ownerUid?: unknown
    companyId?: unknown
    marketingOwner?: unknown
  },
  owner: MarketingOwnerContext,
): boolean {
  if (owner.owner === 'personal') {
    return isPersonalCampaignRecord(record) && campaignScopeFields(record).ownerUid === owner.uid
  }
  if (isPersonalCampaignRecord(record)) return false
  if (owner.owner === 'company') {
    const companyId = cleanScopeId(owner.companyId)
    return Boolean(companyId) && recordCompanyId(record) === companyId
  }
  return true
}

export function campaignVisibleForScope(
  campaign: object,
  options: { personal: boolean; uid: string; companyId?: string },
): boolean {
  const { ownerUid } = campaignScopeFields(campaign)
  if (options.personal) {
    return isPersonalCampaignRecord(campaign) && ownerUid === options.uid
  }
  if (isPersonalCampaignRecord(campaign)) return false
  const wanted = cleanScopeId(options.companyId)
  if (!wanted) return true
  return recordCompanyId(campaign as { companyId?: unknown }) === wanted
}

export function accountAllowedForPublish(
  account: {
    accountScope?: unknown
    accountType?: unknown
    subAccountType?: unknown
    platform?: unknown
    ownerUid?: unknown
    status?: unknown
    companyId?: unknown
  },
  options: { personal: boolean; ownerUid?: string; companyId?: string },
): boolean {
  if (account.status && account.status !== 'active') return false
  if (options.personal) {
    return isPersonalAccountRecord(account) && account.ownerUid === options.ownerUid
  }
  if (!isCompanyLinkedAccount(account)) return false
  const wanted = cleanScopeId(options.companyId)
  if (!wanted) return true
  const accountCompanyId = cleanScopeId(account.companyId)
  if (!accountCompanyId) return true
  return accountCompanyId === wanted
}

export function storedAccountTypeForScope(input: {
  profileType?: unknown
  accountScope: 'org' | 'personal'
  platform?: unknown
}): string {
  const profileType = String(input.profileType || '').toLowerCase()
  if (input.accountScope === PERSONAL_SCOPE) return profileType || 'personal'
  if (isCompanyAccountType(profileType)) return profileType
  if (isCompanyPagePlatform(input.platform)) return profileType || 'personal'
  return 'business'
}
