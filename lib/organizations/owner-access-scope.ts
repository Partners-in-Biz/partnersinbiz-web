import { ACCESS_SCOPE_OPTIONS, type AccessScope } from '@/lib/organizations/memberMetadata'

/**
 * Owner is implicit accessScope all. Missing or `none` on role owner is a
 * data hole, not a product state — never surface it as "no areas yet".
 */
export function effectiveAccessScopeForRole(
  role: string | undefined,
  accessScope?: string | null,
): AccessScope {
  const raw = typeof accessScope === 'string' ? accessScope.trim() : ''
  if (role === 'owner' && (!raw || raw === 'none')) return 'all'
  if (ACCESS_SCOPE_OPTIONS.includes(raw as AccessScope)) return raw as AccessScope
  return 'none'
}
