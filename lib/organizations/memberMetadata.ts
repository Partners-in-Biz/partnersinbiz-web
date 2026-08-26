export const ACCESS_SCOPE_OPTIONS = ['none', 'all', 'crm', 'marketing', 'projects', 'billing', 'readonly'] as const

export type AccessScope = (typeof ACCESS_SCOPE_OPTIONS)[number]

export type MemberMetadata = {
  jobTitle?: string
  department?: string
  accessScope?: AccessScope
  accessNotes?: string
}

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

export function parseMemberMetadata(body: Record<string, unknown>): MemberMetadata {
  const accessScope = typeof body.accessScope === 'string' && ACCESS_SCOPE_OPTIONS.includes(body.accessScope as AccessScope)
    ? body.accessScope as AccessScope
    : 'none'

  return {
    jobTitle: cleanOptionalString(body.jobTitle),
    department: cleanOptionalString(body.department),
    accessScope,
    accessNotes: cleanOptionalString(body.accessNotes),
  }
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
