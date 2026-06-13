export const ACCESS_SCOPE_OPTIONS = ['none', 'all', 'crm', 'marketing', 'projects', 'billing', 'readonly'] as const

export type AccessScope = (typeof ACCESS_SCOPE_OPTIONS)[number]

export type MemberMetadata = {
  jobTitle?: string
  department?: string
  accessScope?: AccessScope
  accessNotes?: string
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
