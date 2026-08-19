export const PERSONAL_SCOPE = 'personal'
export const ORG_SCOPE = 'org'

const COMPANY_ACCOUNT_TYPES = new Set(['page', 'business', 'organization', 'company'])
const BRAND_HANDLE_PLATFORMS = new Set(['bluesky'])
const COMPANY_PAGE_PLATFORMS = new Set(['facebook', 'linkedin'])

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

export function campaignVisibleForScope(
  campaign: object,
  options: { personal: boolean; uid: string },
): boolean {
  const { ownerUid } = campaignScopeFields(campaign)
  if (options.personal) {
    return isPersonalCampaignRecord(campaign) && ownerUid === options.uid
  }
  return !isPersonalCampaignRecord(campaign)
}

export function accountAllowedForPublish(
  account: {
    accountScope?: unknown
    accountType?: unknown
    subAccountType?: unknown
    platform?: unknown
    ownerUid?: unknown
    status?: unknown
  },
  options: { personal: boolean; ownerUid?: string },
): boolean {
  if (account.status && account.status !== 'active') return false
  if (options.personal) {
    return isPersonalAccountRecord(account) && account.ownerUid === options.ownerUid
  }
  return isCompanyLinkedAccount(account)
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
