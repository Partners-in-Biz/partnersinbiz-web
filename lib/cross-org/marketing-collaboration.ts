import type { SharedBusinessCapability } from '@/lib/business-relationships/types'
import type { PartnerResourceType } from './types'
import type { CrossOrgProjection } from './policy-service'

/**
 * The deliberately small collaboration surface for cross-organisation
 * marketing/analytics work. These contracts are an allowlist: a mode not
 * declared here is owner-only, not an implied capability.
 *
 * Approval is a review decision only. It never performs publish, schedule,
 * send, spend, provider configuration, finance, or any other side effect.
 */
export type MarketingCollaborationModule =
  | 'campaigns'
  | 'social'
  | 'email'
  | 'seo'
  | 'ads'
  | 'analytics'

export type MarketingCollaborationMode =
  | 'request_brief'
  | 'draft_review'
  | 'asset_comment'
  | 'approval'
  | 'reporting_view'
  | 'delegated_operation'

export type DelegatedMarketingOperation = 'draft' | 'analyze'

export interface MarketingCollaborationContract {
  resourceType: PartnerResourceType
  requiredCapability: SharedBusinessCapability
  namedUserRequired: true
  modes: Partial<Record<MarketingCollaborationMode, {
    action: string
    humanApprovalRequired: boolean
    delegatedOperation?: DelegatedMarketingOperation
  }>>
}

const REVIEW = { action: 'review_draft', humanApprovalRequired: false } as const
const COMMENT = { action: 'comment_asset', humanApprovalRequired: false } as const
const REQUEST = { action: 'request_brief', humanApprovalRequired: false } as const
const APPROVAL = { action: 'approve', humanApprovalRequired: true } as const
const REPORT = { action: 'view_report', humanApprovalRequired: false } as const
const DRAFT = { action: 'delegate_draft', humanApprovalRequired: false, delegatedOperation: 'draft' } as const
const ANALYZE = { action: 'delegate_analyze', humanApprovalRequired: false, delegatedOperation: 'analyze' } as const

export const MARKETING_COLLABORATION_CONTRACTS: Record<MarketingCollaborationModule, MarketingCollaborationContract> = {
  campaigns: {
    resourceType: 'campaign', requiredCapability: 'campaigns', namedUserRequired: true,
    modes: { request_brief: REQUEST, draft_review: REVIEW, asset_comment: COMMENT, approval: APPROVAL, reporting_view: REPORT, delegated_operation: DRAFT },
  },
  social: {
    resourceType: 'social_post', requiredCapability: 'social', namedUserRequired: true,
    modes: { request_brief: REQUEST, draft_review: REVIEW, asset_comment: COMMENT, approval: APPROVAL, reporting_view: REPORT, delegated_operation: DRAFT },
  },
  email: {
    resourceType: 'email', requiredCapability: 'email', namedUserRequired: true,
    modes: { request_brief: REQUEST, draft_review: REVIEW, asset_comment: COMMENT, approval: APPROVAL, reporting_view: REPORT, delegated_operation: DRAFT },
  },
  seo: {
    resourceType: 'seo', requiredCapability: 'seo', namedUserRequired: true,
    modes: { request_brief: REQUEST, draft_review: REVIEW, asset_comment: COMMENT, approval: APPROVAL, reporting_view: REPORT, delegated_operation: ANALYZE },
  },
  ads: {
    resourceType: 'ads', requiredCapability: 'ads', namedUserRequired: true,
    modes: { request_brief: REQUEST, draft_review: REVIEW, asset_comment: COMMENT, approval: APPROVAL, reporting_view: REPORT, delegated_operation: ANALYZE },
  },
  analytics: {
    resourceType: 'analytics', requiredCapability: 'analytics', namedUserRequired: true,
    modes: { request_brief: REQUEST, reporting_view: REPORT, delegated_operation: ANALYZE },
  },
}

export class MarketingCollaborationPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketingCollaborationPolicyError'
  }
}

const OWNER_ONLY_OPERATIONS = new Set([
  'publish', 'schedule', 'send', 'spend', 'launch', 'configure', 'finance',
  'billing', 'provider_config', 'delete', 'archive', 'deploy',
])

export function resolveMarketingCollaborationAction(
  module: MarketingCollaborationModule,
  mode: MarketingCollaborationMode,
  delegatedOperation?: string,
): {
  action: string
  resourceType: PartnerResourceType
  requiredCapability: SharedBusinessCapability
  namedUserRequired: true
  humanApprovalRequired: boolean
} {
  const contract = MARKETING_COLLABORATION_CONTRACTS[module]
  if (!contract) throw new MarketingCollaborationPolicyError(`Unsupported marketing collaboration module: ${module}`)

  const normalizedOperation = delegatedOperation?.trim().toLowerCase()
  if (normalizedOperation && OWNER_ONLY_OPERATIONS.has(normalizedOperation)) {
    throw new MarketingCollaborationPolicyError(`${normalizedOperation} is owner-only and cannot be delegated cross-organisation`)
  }

  const rule = contract.modes[mode]
  if (!rule) throw new MarketingCollaborationPolicyError(`${mode} is not a supported collaboration mode for ${module}`)
  if (mode === 'delegated_operation' && normalizedOperation && normalizedOperation !== rule.delegatedOperation) {
    throw new MarketingCollaborationPolicyError(`${normalizedOperation} is not a supported delegated operation for ${module}`)
  }

  return {
    action: rule.action,
    resourceType: contract.resourceType,
    requiredCapability: contract.requiredCapability,
    namedUserRequired: true,
    humanApprovalRequired: rule.humanApprovalRequired,
  }
}

const ANALYTICS_TOP_LEVEL_FIELDS = new Set(['period', 'metrics', 'dimensions', 'series'])
const ANALYTICS_DIMENSIONS = new Set(['channel', 'source', 'campaign', 'device', 'country', 'segment'])
const ANALYTICS_SERIES_FIELDS = new Set(['date', 'period', 'value', 'sessions', 'pageviews', 'conversions', 'revenue'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'number' && Number.isFinite(field)) out[key] = field
  }
  return out
}

function safeDimensions(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, field] of Object.entries(value)) {
    if (ANALYTICS_DIMENSIONS.has(key) && typeof field === 'string') out[key] = field
  }
  return out
}

function safeSeries(value: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const safe: Record<string, string | number> = {}
    for (const [key, field] of Object.entries(item)) {
      if (ANALYTICS_SERIES_FIELDS.has(key) && (typeof field === 'string' || (typeof field === 'number' && Number.isFinite(field)))) {
        safe[key] = field
      }
    }
    return Object.keys(safe).length > 0 ? [safe] : []
  })
}

/**
 * Always applies an analytics-specific safe projection. This is stricter than
 * a blank grant field allowlist: raw events, identities, emails, IP data and
 * arbitrary provider payloads cannot cross the organisation boundary.
 */
export function projectAnalyticsReportingRecord(
  record: Record<string, unknown>,
  projection: CrossOrgProjection,
): Record<string, unknown> {
  const permitted = projection.fields === null
    ? ANALYTICS_TOP_LEVEL_FIELDS
    : new Set(projection.fields.filter((field) => ANALYTICS_TOP_LEVEL_FIELDS.has(field)))
  const out: Record<string, unknown> = {}
  if (permitted.has('period') && isRecord(record.period)) {
    const from = typeof record.period.from === 'string' ? record.period.from : undefined
    const to = typeof record.period.to === 'string' ? record.period.to : undefined
    if (from || to) out.period = { ...(from ? { from } : {}), ...(to ? { to } : {}) }
  }
  if (permitted.has('metrics')) out.metrics = safeNumberRecord(record.metrics)
  if (permitted.has('dimensions')) out.dimensions = safeDimensions(record.dimensions)
  if (permitted.has('series')) out.series = safeSeries(record.series)
  return out
}
