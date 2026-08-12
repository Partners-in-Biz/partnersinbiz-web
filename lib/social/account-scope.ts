const PERSONAL_SCOPE = 'personal'
const ORG_SCOPE = 'org'
const COMPANY_ACCOUNT_TYPES = new Set(['page', 'business', 'organization', 'company'])
const BRAND_HANDLE_PLATFORMS = new Set(['bluesky'])

export function isPersonalAccountRecord(account: { accountScope?: unknown }): boolean {
  return account.accountScope === PERSONAL_SCOPE
}

function accountKind(account: { accountType?: unknown; subAccountType?: unknown }): string {
  return String(account.accountType || account.subAccountType || '').toLowerCase()
}

export function isCompanyLinkedAccount(account: {
  accountScope?: unknown
  accountType?: unknown
  subAccountType?: unknown
  platform?: unknown
}): boolean {
  if (isPersonalAccountRecord(account)) return false
  if (COMPANY_ACCOUNT_TYPES.has(accountKind(account))) return true
  if (account.accountScope === ORG_SCOPE) return true
  const platform = String(account.platform || '').toLowerCase()
  return BRAND_HANDLE_PLATFORMS.has(platform)
}
