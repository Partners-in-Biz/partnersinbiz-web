/**
 * Per-module field allowlists for company-work projection.
 * Pattern mirrors lib/partner-links/shares.ts RESOURCE_FIELDS.
 */
import type { SharedBusinessCapability } from '@/lib/business-relationships/types'

const COMMON = [
  'id',
  'orgId',
  'companyId',
  'name',
  'title',
  'status',
  'createdAt',
  'updatedAt',
  'clientVisibility',
  'clientApproval',
  'clientCommentCount',
  'clientLastCommentAt',
] as const

export const COMPANY_WORK_FIELDS: Partial<Record<SharedBusinessCapability, string[]>> = {
  seo: [
    ...COMMON,
    'siteUrl',
    'siteName',
    'clientId',
    'progress',
    'currentWeek',
    'templateId',
    'summary',
    'keywordCount',
    'auditScore',
  ],
  ads: [
    ...COMMON,
    'platform',
    'objective',
    'state',
    'campaignName',
    'summary',
  ],
  campaigns: [
    ...COMMON,
    'description',
    'channel',
    'startDate',
    'endDate',
    'approvalState',
    'publishState',
  ],
  social: [
    ...COMMON,
    'platform',
    'caption',
    'scheduledAt',
    'publishedAt',
    'approvalState',
    'mediaType',
  ],
  email: [
    ...COMMON,
    'subject',
    'previewText',
    'sentAt',
    'openRate',
  ],
  research: [
    ...COMMON,
    'summary',
    'visibility',
    'topic',
  ],
  documents: [
    ...COMMON,
    'documentType',
    'version',
    'approvalState',
    'visibility',
  ],
  projects: [
    ...COMMON,
    'description',
    'targetDate',
    'milestoneCount',
    'taskCount',
    'completedTaskCount',
    'progressPercent',
  ],
  analytics: [
    ...COMMON,
    'metric',
    'period',
    'value',
  ],
  properties: [
    ...COMMON,
    'address',
    'propertyType',
    'reportingView',
  ],
  support: [
    ...COMMON,
    'subject',
    'priority',
    'ticketNumber',
  ],
  services: [
    ...COMMON,
    'serviceType',
    'visibility',
  ],
  messages: [
    ...COMMON,
    'threadSummary',
    'lastMessageAt',
    'messageCount',
  ],
  crm: [...COMMON, 'lifecycleStage', 'domain'],
  invoices: [...COMMON, 'amount', 'currency', 'dueDate'],
  orders: [...COMMON, 'orderNumber', 'total'],
  shipments: [...COMMON, 'trackingNumber'],
  inventory: [...COMMON, 'sku', 'quantity'],
}

export function projectRecordFields(
  module: SharedBusinessCapability,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const allow = COMPANY_WORK_FIELDS[module] ?? [...COMMON]
  const out: Record<string, unknown> = {}
  for (const key of allow) {
    if (record[key] !== undefined) out[key] = record[key]
  }
  return out
}
