/**
 * Briefing system adapters registry.
 *
 * Exports all source adapters and provides utilities for working with them.
 */

export * from './types'
export * from './utils'

// Adapters
export { taskAdapter, projectAdapter } from './adapters/taskAdapter'
export { commentAdapter } from './adapters/commentAdapter'
export { agentOutputAdapter } from './adapters/agentOutputAdapter'
export { approvalAdapter, clientDocumentAdapter } from './adapters/approvalAdapter'
export { notificationAdapter, activityAdapter } from './adapters/notificationAdapter'
export { reportAdapter } from './adapters/reportAdapter'
export { socialPostAdapter } from './adapters/socialPostAdapter'
export { supportTicketAdapter } from './adapters/supportTicketAdapter'
export { invoiceAdapter } from './adapters/invoiceAdapter'
export { expenseAdapter } from './adapters/expenseAdapter'
export { seoContentAdapter } from './adapters/seoContentAdapter'
export { seoTaskAdapter } from './adapters/seoTaskAdapter'
export { adCampaignAdapter } from './adapters/adCampaignAdapter'
export { formSubmissionAdapter } from './adapters/formSubmissionAdapter'

import type { BriefingSourceAdapter, BriefingSourceType } from './types'
import { taskAdapter, projectAdapter } from './adapters/taskAdapter'
import { commentAdapter } from './adapters/commentAdapter'
import { agentOutputAdapter } from './adapters/agentOutputAdapter'
import { approvalAdapter, clientDocumentAdapter } from './adapters/approvalAdapter'
import { notificationAdapter, activityAdapter } from './adapters/notificationAdapter'
import { reportAdapter } from './adapters/reportAdapter'
import { socialPostAdapter } from './adapters/socialPostAdapter'
import { supportTicketAdapter } from './adapters/supportTicketAdapter'
import { invoiceAdapter } from './adapters/invoiceAdapter'
import { expenseAdapter } from './adapters/expenseAdapter'
import { seoContentAdapter } from './adapters/seoContentAdapter'
import { seoTaskAdapter } from './adapters/seoTaskAdapter'
import { adCampaignAdapter } from './adapters/adCampaignAdapter'
import { formSubmissionAdapter } from './adapters/formSubmissionAdapter'

/**
 * Registry of all source adapters.
 */
export const SOURCE_ADAPTERS: Record<BriefingSourceType, BriefingSourceAdapter> = {
  task: taskAdapter,
  project: projectAdapter,
  comment: commentAdapter,
  'agent-output': agentOutputAdapter,
  approval: approvalAdapter,
  'client-document': clientDocumentAdapter,
  'social-post': socialPostAdapter,
  notification: notificationAdapter,
  activity: activityAdapter,
  report: reportAdapter,
  'support-ticket': supportTicketAdapter,
  invoice: invoiceAdapter,
  expense: expenseAdapter,
  'seo-content': seoContentAdapter,
  'seo-task': seoTaskAdapter,
  'ad-campaign': adCampaignAdapter,
  'form-submission': formSubmissionAdapter,
}

/**
 * Get an adapter by source type.
 */
export function getAdapter(sourceType: BriefingSourceType): BriefingSourceAdapter | null {
  return SOURCE_ADAPTERS[sourceType] ?? null
}

/**
 * Get all available source types.
 */
export function getSourceTypes(): BriefingSourceType[] {
  return Object.keys(SOURCE_ADAPTERS) as BriefingSourceType[]
}

/**
 * Check if a source type is supported.
 */
export function isSourceTypeSupported(sourceType: string): sourceType is BriefingSourceType {
  return sourceType in SOURCE_ADAPTERS
}

/**
 * Default adapter to use when source type is unknown.
 */
export const DEFAULT_ADAPTER = taskAdapter
