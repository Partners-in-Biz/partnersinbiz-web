import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import type { CrossOrgProjection } from './policy-service'

export type ResearchPropertyResourceType = 'research' | 'property'

export type ResearchPropertyActionPolicy =
  | { allowed: true; requiredCapability: SharedBusinessCapability; requireNamedUser: true }
  | { allowed: false; reason: 'ATTACHMENT_DENIED' | 'OWNER_ONLY_ACTION' | 'UNSUPPORTED_ACTION' }

const RESEARCH_SHARED_ACTIONS = new Set(['view', 'comment', 'contribute', 'approve'])
const PROPERTY_SHARED_ACTIONS = new Set(['view', 'comment'])
const RESEARCH_OWNER_ONLY_ACTIONS = new Set([
  'export', 'create_document', 'archive', 'delete', 'restore', 'manage_sources',
  'ingest', 'configure', 'share', 'invite', 'revoke',
])
const PROPERTY_OWNER_ONLY_ACTIONS = new Set([
  'contribute', 'approve', 'rotate_ingest_key', 'configure', 'pull_metrics',
  'backfill', 'connect_provider', 'disconnect_provider', 'delete', 'archive',
  'share', 'invite', 'revoke',
])

const RESEARCH_SAFE_FIELDS = new Set([
  'id', 'title', 'kind', 'status', 'visibility', 'summary', 'tags', 'findings', 'recommendations',
])
const RESEARCH_EVIDENCE_SAFE_FIELDS = new Set([
  'id', 'title', 'type', 'url', 'excerpt', 'sourceDate', 'publisher', 'confidence', 'verified',
])
const RESEARCH_FINDING_SAFE_FIELDS = new Set(['id', 'title', 'body', 'confidence', 'status', 'tags'])
const RESEARCH_RECOMMENDATION_SAFE_FIELDS = new Set(['id', 'title', 'body', 'priority', 'status'])
const PROPERTY_SAFE_FIELDS = new Set(['id', 'name', 'domain', 'type', 'status', 'config'])
const PROPERTY_SAFE_CONFIG_FIELDS = new Set(['siteUrl', 'appStoreUrl', 'playStoreUrl', 'primaryCtaUrl'])

function allowsField(projection: CrossOrgProjection, field: string): boolean {
  return projection.fields === null || projection.fields.includes(field)
}

function projectAllowlisted(
  record: Record<string, unknown>,
  safeFields: ReadonlySet<string>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of safeFields) {
    if (allowsField(projection, field) && record[field] !== undefined) out[field] = record[field]
  }
  return out
}

function projectResearchEntries(
  value: unknown,
  safeFields: ReadonlySet<string>,
  projection: CrossOrgProjection,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const id = record.id
    if (typeof id !== 'string' || (projection.items !== null && !projection.items.includes(id))) return []
    return [projectAllowlisted(record, safeFields, { fields: null, items: null })]
  })
}

/**
 * Module policy layered above the canonical grant decision. The policy cannot
 * widen a PartnerResourceGrant. Every foreign actor is named-user-only; prejoin
 * view/comment claims are materialised by the canonical prejoin adapter.
 */
export function getResearchPropertyActionPolicy(
  resourceType: ResearchPropertyResourceType,
  action: string,
  field?: string,
): ResearchPropertyActionPolicy {
  if (field === 'attachment' || field === 'attachments' || action === 'attachment') {
    return { allowed: false, reason: 'ATTACHMENT_DENIED' }
  }

  if (resourceType === 'research') {
    if (RESEARCH_SHARED_ACTIONS.has(action)) {
      return { allowed: true, requiredCapability: 'research', requireNamedUser: true }
    }
    if (RESEARCH_OWNER_ONLY_ACTIONS.has(action)) return { allowed: false, reason: 'OWNER_ONLY_ACTION' }
    return { allowed: false, reason: 'UNSUPPORTED_ACTION' }
  }

  if (PROPERTY_SHARED_ACTIONS.has(action)) {
    return { allowed: true, requiredCapability: 'properties', requireNamedUser: true }
  }
  if (PROPERTY_OWNER_ONLY_ACTIONS.has(action)) return { allowed: false, reason: 'OWNER_ONLY_ACTION' }
  return { allowed: false, reason: 'UNSUPPORTED_ACTION' }
}

/**
 * Fixed safe projection for research items. Broad or legacy grants cannot leak
 * working notes, design context, CRM links, Obsidian state, actor/audit data,
 * raw sources, media, or new fields that were not explicitly reviewed here.
 */
export function projectResearchForPartner(
  record: Record<string, unknown>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  const out = projectAllowlisted(record, RESEARCH_SAFE_FIELDS, projection)
  if (allowsField(projection, 'findings') && record.findings !== undefined) {
    out.findings = projectResearchEntries(record.findings, RESEARCH_FINDING_SAFE_FIELDS, projection)
  }
  if (allowsField(projection, 'recommendations') && record.recommendations !== undefined) {
    out.recommendations = projectResearchEntries(record.recommendations, RESEARCH_RECOMMENDATION_SAFE_FIELDS, projection)
  }
  return out
}

/** A derived report uses the same safe research DTO; its client-document body remains separately owner-gated. */
export function projectResearchReportForPartner(
  record: Record<string, unknown>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  return projectResearchForPartner(record, projection)
}

/**
 * Evidence projection is intentionally narrower than the parent summary. Raw
 * text, source metadata, storage/media locators and attachments never cross an
 * organisation boundary through this adapter.
 */
export function projectResearchEvidenceForPartner(
  record: Record<string, unknown>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  return projectAllowlisted(record, RESEARCH_EVIDENCE_SAFE_FIELDS, projection)
}

/**
 * Property shares are named-user view/comment only. Nested config is rebuilt
 * from a static URL allowlist, so broad grants cannot expose ingest keys, kill
 * switches, feature flags, custom config, revenue IDs, or provider data.
 */
export function projectPropertyForPartner(
  record: Record<string, unknown>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  const out = projectAllowlisted(record, PROPERTY_SAFE_FIELDS, projection)
  if (out.config && typeof out.config === 'object' && !Array.isArray(out.config)) {
    out.config = projectAllowlisted(
      out.config as Record<string, unknown>,
      PROPERTY_SAFE_CONFIG_FIELDS,
      { fields: null, items: null },
    )
  }
  return out
}
