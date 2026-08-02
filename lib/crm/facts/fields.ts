// lib/crm/facts/fields.ts
// Fact fields → optional Contact columns. Null column = fact-only.

import type { FactField } from './types'

/** column is the Contact field an APPLIED fact writes through to. */
export const FACT_FIELD_META = {
  name: { column: 'name' as const },
  title: { column: 'jobTitle' as const },
  department: { column: 'department' as const },
  phone: { column: 'phone' as const },
  linkedinUrl: { column: 'linkedinUrl' as const },
  website: { column: 'website' as const },
  twitterUrl: { column: 'twitterUrl' as const },
  githubUrl: { column: 'githubUrl' as const },
  // employer is fact-only so job changes are superseded rows, not silent companyId rewrites
  employer: { column: null },
  seniority: { column: null },
  function: { column: null },
  location: { column: null },
  tenure: { column: null },
} as const satisfies Record<FactField, { column: string | null }>

export const FACT_FIELDS = Object.keys(FACT_FIELD_META) as FactField[]

export function isFactField(value: unknown): value is FactField {
  return typeof value === 'string' && value in FACT_FIELD_META
}

export function columnForField(field: FactField): string | null {
  return FACT_FIELD_META[field].column
}

/** Contact columns that may be marked human-owned on human edit. */
export const HUMAN_OWNABLE_CONTACT_COLUMNS = [
  'name',
  'jobTitle',
  'department',
  'phone',
  'website',
  'linkedinUrl',
  'twitterUrl',
  'githubUrl',
] as const

export type HumanOwnableContactColumn = (typeof HUMAN_OWNABLE_CONTACT_COLUMNS)[number]

/** Map contact column → fact field for ownership checks. */
export const COLUMN_TO_FACT_FIELD: Record<string, FactField> = {
  name: 'name',
  jobTitle: 'title',
  department: 'department',
  phone: 'phone',
  website: 'website',
  linkedinUrl: 'linkedinUrl',
  twitterUrl: 'twitterUrl',
  githubUrl: 'githubUrl',
}

export function sameFactValue(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
