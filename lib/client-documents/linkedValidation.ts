import type { ClientDocumentLinkSet } from './types'

export const LINKED_STRING_FIELDS: Set<string> = new Set([
  'companyId',
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

export const LINKED_ARRAY_FIELDS: Set<string> = new Set(['socialPostIds', 'geoTaskIds', 'researchItemIds'] as const)
export const LINKED_FIELDS: Set<string> = new Set([...LINKED_STRING_FIELDS, ...LINKED_ARRAY_FIELDS])

export function validateClientDocumentLinks(
  value: unknown,
): { ok: true; value: ClientDocumentLinkSet } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'linked must be an object' }
  }

  const linked = value as Record<string, unknown>
  const unknownFields = Object.keys(linked).filter((field) => !LINKED_FIELDS.has(field))
  if (unknownFields.length > 0) {
    return { ok: false, error: `linked contains unsupported field(s): ${unknownFields.join(', ')}` }
  }

  for (const field of LINKED_STRING_FIELDS) {
    if (field in linked && typeof linked[field] !== 'string') {
      return { ok: false, error: `linked.${field} must be a string` }
    }
  }

  for (const field of LINKED_ARRAY_FIELDS) {
    if (field in linked && (!Array.isArray(linked[field]) || (linked[field] as unknown[]).some((id) => typeof id !== 'string'))) {
      return { ok: false, error: `linked.${field} must be an array of strings` }
    }
  }

  return { ok: true, value: linked as ClientDocumentLinkSet }
}
