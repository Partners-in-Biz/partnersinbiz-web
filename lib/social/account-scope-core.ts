/**
 * Social-account and campaign identity helpers.
 * Generic org/company/personal work-scope lives in lib/work-scope.
 */

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
  if (BRAND_HANDLE_PLATFORMS.has(platform) && account.accountScope !== PERSONAL_SCOPE) return true
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

function cleanScopeId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function recordCompanyId(record: { companyId?: unknown }): string {
  return cleanScopeId(record.companyId)
}

/**
 * Social accounts: org view WITHOUT companyId hides company-stamped accounts
 * (publish identities must not leak into the org bucket).
 */
export function accountVisibleForWorkspace(
  account: {
    accountScope?: unknown
    accountType?: unknown
    subAccountType?: unknown
    platform?: unknown
    ownerUid?: unknown
    companyId?: unknown
  },
  options: { personal: boolean; ownerUid?: string; companyId?: string },
): boolean {
  if (options.personal) {
    return isPersonalAccountRecord(account) && account.ownerUid === options.ownerUid
  }
  if (!isCompanyLinkedAccount(account)) return false
  const wanted = cleanScopeId(options.companyId)
  const accountCompanyId = recordCompanyId(account)
  if (!wanted) return !accountCompanyId
  return accountCompanyId === wanted
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
  return accountVisibleForWorkspace(account, options)
}

export function storedAccountTypeForScope(input: {
  profileType?: unknown
  accountScope: 'org' | 'personal'
  platform?: unknown
}): string {
  const profileType = String(input.profileType || '').toLowerCase()
  if (input.accountScope === PERSONAL_SCOPE) return profileType || 'personal'
  if (isCompanyAccountType(profileType)) return profileType
  if (isCompanyPagePlatform(input.platform)) {
    if (profileType === 'personal') return 'personal'
    return 'page'
  }
  return 'business'
}
