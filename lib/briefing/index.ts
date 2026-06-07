/**
 * Briefing system adapters registry.
 *
 * Exports all source adapters and provides utilities for working with them.
 */

export * from './types'
export * from './utils'
export * from './cardContract'

// Adapters
export { taskAdapter, projectAdapter } from './adapters/taskAdapter'
export { agentLearningReviewAdapter } from './adapters/agentLearningReviewAdapter'
export { commentAdapter } from './adapters/commentAdapter'
export { agentOutputAdapter } from './adapters/agentOutputAdapter'
export { agentRunAdapter } from './adapters/agentRunAdapter'
export { workspaceBrokerJobAdapter } from './adapters/workspaceBrokerJobAdapter'
export { calendarEventAdapter } from './adapters/calendarEventAdapter'
export { bookingAdapter } from './adapters/bookingAdapter'
export { contactAdapter } from './adapters/contactAdapter'
export { dealAdapter } from './adapters/dealAdapter'
export { approvalAdapter, clientDocumentAdapter } from './adapters/approvalAdapter'
export { notificationAdapter, activityAdapter } from './adapters/notificationAdapter'
export { reportAdapter } from './adapters/reportAdapter'
export { socialPostAdapter } from './adapters/socialPostAdapter'
export { socialInboxAdapter } from './adapters/socialInboxAdapter'
export { mailboxMessageAdapter } from './adapters/mailboxMessageAdapter'
export { supportTicketAdapter } from './adapters/supportTicketAdapter'
export { invoiceAdapter } from './adapters/invoiceAdapter'
export { quoteAdapter } from './adapters/quoteAdapter'
export { orderAdapter } from './adapters/orderAdapter'
export { inventoryItemAdapter } from './adapters/inventoryItemAdapter'
export { shipmentAdapter } from './adapters/shipmentAdapter'
export { expenseAdapter } from './adapters/expenseAdapter'
export { seoContentAdapter } from './adapters/seoContentAdapter'
export { seoTaskAdapter } from './adapters/seoTaskAdapter'
export { adCampaignAdapter } from './adapters/adCampaignAdapter'
export { broadcastAdapter } from './adapters/broadcastAdapter'
export { campaignAdapter } from './adapters/campaignAdapter'
export { enquiryAdapter } from './adapters/enquiryAdapter'
export { formSubmissionAdapter } from './adapters/formSubmissionAdapter'

import type { BriefingSourceAdapter, BriefingSourceType } from './types'
import { taskAdapter, projectAdapter } from './adapters/taskAdapter'
import { agentLearningReviewAdapter } from './adapters/agentLearningReviewAdapter'
import { commentAdapter } from './adapters/commentAdapter'
import { agentOutputAdapter } from './adapters/agentOutputAdapter'
import { agentRunAdapter } from './adapters/agentRunAdapter'
import { workspaceBrokerJobAdapter } from './adapters/workspaceBrokerJobAdapter'
import { calendarEventAdapter } from './adapters/calendarEventAdapter'
import { bookingAdapter } from './adapters/bookingAdapter'
import { contactAdapter } from './adapters/contactAdapter'
import { dealAdapter } from './adapters/dealAdapter'
import { approvalAdapter, clientDocumentAdapter } from './adapters/approvalAdapter'
import { notificationAdapter, activityAdapter } from './adapters/notificationAdapter'
import { reportAdapter } from './adapters/reportAdapter'
import { socialPostAdapter } from './adapters/socialPostAdapter'
import { socialInboxAdapter } from './adapters/socialInboxAdapter'
import { mailboxMessageAdapter } from './adapters/mailboxMessageAdapter'
import { supportTicketAdapter } from './adapters/supportTicketAdapter'
import { invoiceAdapter } from './adapters/invoiceAdapter'
import { quoteAdapter } from './adapters/quoteAdapter'
import { orderAdapter } from './adapters/orderAdapter'
import { inventoryItemAdapter } from './adapters/inventoryItemAdapter'
import { shipmentAdapter } from './adapters/shipmentAdapter'
import { expenseAdapter } from './adapters/expenseAdapter'
import { seoContentAdapter } from './adapters/seoContentAdapter'
import { seoTaskAdapter } from './adapters/seoTaskAdapter'
import { adCampaignAdapter } from './adapters/adCampaignAdapter'
import { broadcastAdapter } from './adapters/broadcastAdapter'
import { campaignAdapter } from './adapters/campaignAdapter'
import { enquiryAdapter } from './adapters/enquiryAdapter'
import { formSubmissionAdapter } from './adapters/formSubmissionAdapter'

/**
 * Registry of all source adapters.
 */
export const SOURCE_ADAPTERS: Record<BriefingSourceType, BriefingSourceAdapter> = {
  task: taskAdapter,
  project: projectAdapter,
  'agent-learning-review': agentLearningReviewAdapter,
  comment: commentAdapter,
  'agent-output': agentOutputAdapter,
  'agent-run': agentRunAdapter,
  'workspace-broker-job': workspaceBrokerJobAdapter,
  'calendar-event': calendarEventAdapter,
  booking: bookingAdapter,
  contact: contactAdapter,
  deal: dealAdapter,
  approval: approvalAdapter,
  'client-document': clientDocumentAdapter,
  'social-post': socialPostAdapter,
  'social-inbox': socialInboxAdapter,
  'mailbox-message': mailboxMessageAdapter,
  notification: notificationAdapter,
  activity: activityAdapter,
  report: reportAdapter,
  'support-ticket': supportTicketAdapter,
  invoice: invoiceAdapter,
  quote: quoteAdapter,
  order: orderAdapter,
  'inventory-item': inventoryItemAdapter,
  shipment: shipmentAdapter,
  expense: expenseAdapter,
  'seo-content': seoContentAdapter,
  'seo-task': seoTaskAdapter,
  'ad-campaign': adCampaignAdapter,
  broadcast: broadcastAdapter,
  campaign: campaignAdapter,
  enquiry: enquiryAdapter,
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
