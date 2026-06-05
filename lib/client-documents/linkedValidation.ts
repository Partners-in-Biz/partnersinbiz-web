import type { ClientDocumentLinkSet } from './types'

export const LINKED_STRING_FIELDS: Set<string> = new Set([
  'companyId',
  'contactId',
  'clientOrgId',
  'projectId',
  'campaignId',
  'reportId',
  'dealId',
  'seoSprintId',
  'geoWorkspaceId',
  'geoAuditId',
  'invoiceId',
] as const)

export const LINKED_ARRAY_FIELDS: Set<string> = new Set([
  'companyIds',
  'contactIds',
  'clientOrgIds',
  'projectIds',
  'dealIds',
  'socialPostIds',
  'geoTaskIds',
  'researchItemIds',
] as const)
export const LINKED_FIELDS: Set<string> = new Set([...Array.from(LINKED_STRING_FIELDS), ...Array.from(LINKED_ARRAY_FIELDS)])

const DEFAULT_MAX_IDS_PER_FIELD = 50

const DOCUMENT_PRIMARY_ARRAY_FIELDS = {
  companyId: 'companyIds',
  contactId: 'contactIds',
  clientOrgId: 'clientOrgIds',
  projectId: 'projectIds',
  dealId: 'dealIds',
} as const

const PROJECT_PRIMARY_ARRAY_FIELDS = {
  clientOrgId: 'clientOrgIds',
  companyId: 'companyIds',
  contactId: 'contactIds',
  sourceCompanyId: 'sourceCompanyIds',
  sourceContactId: 'sourceContactIds',
  recipientOrgId: 'recipientOrgIds',
} as const

export type LinkValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

type NormalizeOptions = {
  maxIdsPerField?: number
}

type LinkFieldPair = readonly [scalarField: string, arrayField: string]

function cleanOptionalString(value: unknown, field: string): LinkValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== 'string') return { ok: false, error: `linked.${field} must be a string` }
  const trimmed = value.trim()
  return { ok: true, value: trimmed || undefined }
}

function normalizeStringArray(
  linked: Record<string, unknown>,
  field: string,
  primaryValue: string | undefined,
  maxIdsPerField: number,
): LinkValidationResult<string[] | undefined> {
  const raw = linked[field]
  const ids: string[] = []

  if (primaryValue) ids.push(primaryValue)

  if (raw !== undefined) {
    if (!Array.isArray(raw)) return { ok: false, error: `linked.${field} must be an array of strings` }
    for (let index = 0; index < raw.length; index += 1) {
      const item = raw[index]
      if (typeof item !== 'string') return { ok: false, error: `linked.${field}[${index}] must be a string` }
      const trimmed = item.trim()
      if (!trimmed) return { ok: false, error: `linked.${field}[${index}] must be a non-empty string` }
      ids.push(trimmed)
    }
  }

  const unique = Array.from(new Set(ids)).slice(0, maxIdsPerField)
  return { ok: true, value: unique.length > 0 ? unique : undefined }
}

function normalizeLinkedRecord<T extends object>(
  value: unknown,
  allowedStringFields: Set<string>,
  allowedArrayFields: Set<string>,
  primaryArrayFields: Record<string, string>,
  options: NormalizeOptions = {},
): LinkValidationResult<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'linked must be an object' }
  }

  const linked = value as Record<string, unknown>
  const allowedFields = new Set([...Array.from(allowedStringFields), ...Array.from(allowedArrayFields)])
  const unknownFields = Object.keys(linked).filter((field) => !allowedFields.has(field))
  if (unknownFields.length > 0) {
    return { ok: false, error: `linked contains unsupported field(s): ${unknownFields.join(', ')}` }
  }

  const maxIdsPerField = options.maxIdsPerField ?? DEFAULT_MAX_IDS_PER_FIELD
  const normalized: Record<string, unknown> = {}
  const primaryPairs = Object.entries(primaryArrayFields) as LinkFieldPair[]
  const primaryScalarFields = new Set(primaryPairs.map(([field]) => field))
  const primaryArrayFieldNames = new Set(primaryPairs.map(([, field]) => field))

  for (const field of Array.from(allowedStringFields)) {
    const scalar = cleanOptionalString(linked[field], field)
    if (scalar.ok === false) return { ok: false, error: scalar.error }
    if (scalar.value !== undefined) normalized[field] = scalar.value
  }

  for (const [scalarField, arrayField] of primaryPairs) {
    const primaryValue = typeof normalized[scalarField] === 'string' ? normalized[scalarField] : undefined
    const arrayResult = normalizeStringArray(linked, arrayField, primaryValue, maxIdsPerField)
    if (arrayResult.ok === false) return { ok: false, error: arrayResult.error }
    if (arrayResult.value) normalized[arrayField] = arrayResult.value
  }

  for (const field of Array.from(allowedArrayFields)) {
    if (primaryArrayFieldNames.has(field)) continue
    const arrayResult = normalizeStringArray(linked, field, undefined, maxIdsPerField)
    if (arrayResult.ok === false) return { ok: false, error: arrayResult.error }
    if (arrayResult.value) normalized[field] = arrayResult.value
  }

  for (const field of Object.keys(normalized)) {
    if (!allowedFields.has(field) && !primaryScalarFields.has(field)) delete normalized[field]
  }

  return { ok: true, value: normalized as T }
}

export function normalizeClientDocumentLinks(
  value: unknown,
  options: NormalizeOptions = {},
): LinkValidationResult<ClientDocumentLinkSet> {
  return normalizeLinkedRecord<ClientDocumentLinkSet>(
    value,
    LINKED_STRING_FIELDS,
    LINKED_ARRAY_FIELDS,
    DOCUMENT_PRIMARY_ARRAY_FIELDS,
    options,
  )
}

export type ProjectLinkSet = {
  clientOrgId?: string
  companyId?: string
  contactId?: string
  sourceCompanyId?: string
  sourceContactId?: string
  recipientOrgId?: string
  clientOrgIds?: string[]
  companyIds?: string[]
  contactIds?: string[]
  sourceCompanyIds?: string[]
  sourceContactIds?: string[]
  recipientOrgIds?: string[]
}

export const PROJECT_LINKED_STRING_FIELDS: Set<string> = new Set([
  'clientOrgId',
  'companyId',
  'contactId',
  'sourceCompanyId',
  'sourceContactId',
  'recipientOrgId',
] as const)

export const PROJECT_LINKED_ARRAY_FIELDS: Set<string> = new Set([
  'clientOrgIds',
  'companyIds',
  'contactIds',
  'sourceCompanyIds',
  'sourceContactIds',
  'recipientOrgIds',
] as const)

export function normalizeProjectLinks(
  value: unknown,
  options: NormalizeOptions = {},
): LinkValidationResult<ProjectLinkSet> {
  return normalizeLinkedRecord<ProjectLinkSet>(
    value,
    PROJECT_LINKED_STRING_FIELDS,
    PROJECT_LINKED_ARRAY_FIELDS,
    PROJECT_PRIMARY_ARRAY_FIELDS,
    options,
  )
}

export function validateClientDocumentLinks(
  value: unknown,
): { ok: true; value: ClientDocumentLinkSet } | { ok: false; error: string } {
  return normalizeClientDocumentLinks(value)
}

export function pickProjectLinkFields(value: Record<string, unknown>): Record<string, unknown> {
  const fields = new Set([...Array.from(PROJECT_LINKED_STRING_FIELDS), ...Array.from(PROJECT_LINKED_ARRAY_FIELDS)])
  return Object.fromEntries(Object.entries(value).filter(([field]) => fields.has(field)))
}
