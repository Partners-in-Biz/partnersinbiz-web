/**
 * LinkedIn Community Management API gate.
 *
 * Company-page scopes and the org-page picker stay off until CMA is approved
 * on the existing LinkedIn app. Personal OpenID + w_member_social connect
 * must keep working while this flag is off.
 */
export function isLinkedInCmaEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.LINKEDIN_CMA_ENABLED?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export const LINKEDIN_ORG_SCOPES = ['rw_organization_admin', 'w_organization_social'] as const

export function grantedLinkedInScopes(raw: string | undefined, requested: string[]): string[] {
  if (raw?.trim()) {
    return raw.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean)
  }
  return requested
}

export function selectLinkedInCallbackAccounts<T extends { accountType: 'personal' | 'page' }>(
  accounts: T[],
  options?: { accountScope?: 'org' | 'personal' },
): { usePicker: boolean; accounts: T[] } {
  const personal = accounts.filter((account) => account.accountType === 'personal')
  const pages = accounts.filter((account) => account.accountType === 'page')
  if (options?.accountScope === 'org') {
    return { usePicker: pages.length > 1, accounts: pages }
  }
  if (isLinkedInCmaEnabled() && pages.length > 0) {
    return { usePicker: true, accounts: [...personal, ...pages] }
  }
  return { usePicker: false, accounts: personal.length > 0 ? personal : accounts }
}
