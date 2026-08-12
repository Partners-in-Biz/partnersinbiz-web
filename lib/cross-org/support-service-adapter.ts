import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import type { CrossOrgProjection } from './policy-service'
import { rankByList } from './decision'

export type SupportServiceResourceType = 'support' | 'service'
export type SupportServiceParticipantRole = 'observer' | 'requester' | 'provider_agent' | 'provider_manager' | 'provider_owner'
export type SupportServiceActionPolicy =
  | { allowed: true; requiredCapability: SharedBusinessCapability; requireNamedUser?: boolean; requiredRole?: SupportServiceParticipantRole }
  | { allowed: false; reason: 'INTERNAL_ONLY' | 'FILE_DELIVERY_REQUIRES_FILE_GRANT' | 'UNSUPPORTED_ACTION' }

const SAFE_TICKET_FIELDS = new Set(['id', 'subject', 'description', 'status', 'priority', 'requesterOrgId', 'providerOrgId', 'requesterName', 'messageCount', 'lastMessagePreview', 'lastMessageAt', 'createdAt', 'updatedAt'])
const SAFE_MESSAGE_FIELDS = new Set(['id', 'kind', 'body', 'authorName', 'createdAt'])
const SAFE_WORKSPACE_FIELDS = new Set(['id', 'name', 'serviceType', 'status', 'visibility', 'requesterOrgId', 'providerOrgId', 'startsAt', 'endsAt', 'createdAt', 'updatedAt'])
const SHARED_SLA_FIELDS = new Set(['visibility', 'dueAt', 'breachedAt'])

export const supportServiceRoleRank = rankByList(['observer', 'requester', 'provider_agent', 'provider_manager', 'provider_owner'])

function capabilityFor(resourceType: SupportServiceResourceType): SharedBusinessCapability {
  return resourceType === 'support' ? 'support' : 'services'
}

/**
 * This registry is deliberately narrower than a generic resource grant. A
 * caller must still obtain an allow decision from CrossOrgPolicyService before
 * it performs an allowed action. Files retain their own document/file grant.
 */
export function getSupportServiceActionPolicy(resourceType: SupportServiceResourceType, action: string): SupportServiceActionPolicy {
  if (action === 'internal_note') return { allowed: false, reason: 'INTERNAL_ONLY' }
  if (action === 'download_file') return { allowed: false, reason: 'FILE_DELIVERY_REQUIRES_FILE_GRANT' }
  if (action === 'view' || action === 'comment') return { allowed: true, requiredCapability: capabilityFor(resourceType) }
  if (action === 'claim') return { allowed: true, requiredCapability: capabilityFor(resourceType), requireNamedUser: true, requiredRole: 'provider_agent' }
  if (['assign', 'resolve', 'invite_participant', 'revoke_participant', 'update_sla'].includes(action)) {
    return { allowed: true, requiredCapability: capabilityFor(resourceType), requireNamedUser: true, requiredRole: 'provider_manager' }
  }
  return { allowed: false, reason: 'UNSUPPORTED_ACTION' }
}

function allows(projection: CrossOrgProjection, field: string): boolean {
  return projection.fields === null || projection.fields.includes(field)
}

function project(record: Record<string, unknown>, fields: ReadonlySet<string>, projection: CrossOrgProjection): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) if (allows(projection, field) && record[field] !== undefined) out[field] = record[field]
  return out
}

function projectSla(value: unknown, projection: CrossOrgProjection): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !allows(projection, 'sla')) return undefined
  const out: Record<string, unknown> = {}
  for (const field of SHARED_SLA_FIELDS) {
    const candidate = (value as Record<string, unknown>)[field]
    if (candidate !== undefined) out[field] = candidate
  }
  return Object.keys(out).length ? out : undefined
}

export function projectSupportForPartner(record: Record<string, unknown>, projection: CrossOrgProjection): Record<string, unknown> {
  const out = project(record, SAFE_TICKET_FIELDS, projection)
  const sla = projectSla(record.sla, projection)
  if (sla) out.sla = sla
  return out
}

/** No internal note, attachment locator, context reference, or agent diagnostic crosses this boundary. */
export function projectSupportMessageForPartner(record: Record<string, unknown>, projection: CrossOrgProjection): Record<string, unknown> {
  return record.kind === 'comment' ? project(record, SAFE_MESSAGE_FIELDS, projection) : {}
}

export function projectServiceWorkspaceForPartner(record: Record<string, unknown>, projection: CrossOrgProjection): Record<string, unknown> {
  const out = project(record, SAFE_WORKSPACE_FIELDS, projection)
  const sla = projectSla(record.sla, projection)
  if (sla) out.sla = sla
  return out
}
