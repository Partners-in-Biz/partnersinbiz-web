/**
 * Data contracts for Admin Teleprompter / Briefing system.
 *
 * Cards normalize source data into auditable briefing items with:
 * - Source links
 * - Raw source hashes
 * - Org/client/project/task context
 * - Actor
 * - Timestamps
 * - Priority signal
 * - Safe excerpts
 */

import type { FieldValue } from 'firebase-admin/firestore'

/**
 * Briefing priority levels in order of urgency.
 */
export type BriefingPriority =
  | 'critical'       // Urgent blockers, production incidents, data loss risk
  | 'needs-peet'     // Requires Peet's decision/action
  | 'client-risk'    // Client-facing risks, SLA concerns, billing issues
  | 'review'         // Agent work completed and awaiting review
  | 'progress'       // In-progress agent work, non-blocking updates
  | 'fyi'            // Informational, digest-only items

/**
 * Briefing source types where items originate.
 */
export type BriefingSourceType =
  | 'project'              // Projects/Kanban tasks
  | 'task'                 // Task events (created, updated, moved, completed)
  | 'comment'              // Comments on tasks, documents, conversations
  | 'agent-output'         // Agent completion summaries and artifacts
  | 'agent-run'            // Live Hermes agent run status and approval prompts
  | 'workspace-broker-job' // Google Workspace broker jobs awaiting approval or recovery
  | 'calendar-event'      // Upcoming calendar events needing RSVP or schedule attention
  | 'approval'             // Approval gates and client document approvals
  | 'client-document'      // Client documents, specs, reports
  | 'social-post'          // Social content awaiting QA/client approval or attention
  | 'social-inbox'         // Social engagement inbox items needing read/reply/archive
  | 'mailbox-message'      // Unread mailbox messages needing read/archive/reply handling
  | 'notification'         // User notifications and inboxes
  | 'activity'             // Activity log entries
  | 'report'               // Stored snapshot reports
  | 'support-ticket'       // Client support tickets and ticket replies
  | 'invoice'              // Billing invoices that need review, payment, or sending
  | 'expense'              // Submitted expenses that need approval or rejection
  | 'seo-content'          // SEO content awaiting client review or publishing action
  | 'seo-task'             // SEO sprint tasks needing admin execution, completion, or skip
  | 'ad-campaign'          // Ad campaigns awaiting client approval or changes
  | 'form-submission'      // Public form submissions needing admin follow-up

/**
 * Briefing item lifecycle states.
 */
export type BriefingStatus =
  | 'new'           // Freshly ingested, not yet processed
  | 'active'        // Currently visible in the feed
  | 'acknowledged'  // User has seen/acted on this item
  | 'archived'      // Historical, kept for audit but hidden from active feed
  | 'resolved'      // Issue resolved, marked as done

/**
 * Actor information for briefing items.
 */
export interface BriefingActor {
  id: string
  name?: string | null
  role?: 'admin' | 'client' | 'ai' | 'system'
  type?: 'user' | 'agent' | 'system'
}

/**
 * Contextual metadata for briefing items.
 */
export interface BriefingContext {
  orgId: string
  orgSlug?: string | null
  orgName?: string | null
  clientId?: string | null
  clientName?: string | null
  projectId?: string | null
  projectName?: string | null
  taskId?: string | null
  taskTitle?: string | null
  documentId?: string | null
  documentTitle?: string | null
  conversationId?: string | null
  conversationTitle?: string | null
  contactId?: string | null
  contactName?: string | null
  dealId?: string | null
  dealTitle?: string | null
  reportId?: string | null
  reportTitle?: string | null
  supportTicketId?: string | null
  supportTicketSubject?: string | null
  invoiceId?: string | null
  invoiceNumber?: string | null
  expenseId?: string | null
  expenseCategory?: string | null
  seoContentId?: string | null
  seoContentTitle?: string | null
  seoTaskId?: string | null
  seoTaskTitle?: string | null
  seoSprintId?: string | null
  adCampaignId?: string | null
  adCampaignName?: string | null
  formId?: string | null
  formSubmissionId?: string | null
  formName?: string | null
  socialInboxId?: string | null
  socialInboxFrom?: string | null
  socialPostId?: string | null
  mailboxMessageId?: string | null
  mailboxFrom?: string | null
  mailboxSubject?: string | null
  agentRunId?: string | null
  agentProfile?: string | null
  workspaceBrokerJobId?: string | null
  workspaceBrokerOperation?: string | null
  workspaceArtifactId?: string | null
  workspaceArtifactTitle?: string | null
  calendarEventId?: string | null
  calendarEventTitle?: string | null
  sourceIds?: string[]  // Related source IDs for cross-reference
}

/**
 * Reference back to the original source document.
 */
export interface BriefingSourceRef {
  type: BriefingSourceType
  id: string
  collectionPath: string  // Firestore collection path
  url?: string            // Web UI URL for the source
}

/**
 * A normalized briefing item from a source adapter.
 */
export interface BriefingSourceItem {
  /**
   * Briefing item unique identifier.
   */
  id?: string

  /**
   * Organization this item belongs to.
   */
  orgId: string

  /**
   * Source reference (what this item is about).
   */
  source: BriefingSourceRef

  /**
   * Priority level for sorting/filtering.
   */
  priority: BriefingPriority

  /**
   * Briefing item status.
   */
  status?: BriefingStatus

  /**
   * Human-readable title for the briefing card.
   */
  title: string

  /**
   * Brief description/summary of the item.
   */
  summary: string

  /**
   * Safe excerpt from the source content (truncated, sanitized).
   */
  excerpt?: string | null

  /**
   * Actor who triggered this briefing item.
   */
  actor: BriefingActor

  /**
   * Contextual metadata about the org/client/project/task.
   */
  context: BriefingContext

  /**
   * When the source event occurred.
   */
  occurredAt: Date | { toDate: () => Date } | number | string

  /**
   * When this briefing item was ingested/created.
   */
  createdAt?: Date | FieldValue

  /**
   * When this briefing item was last updated.
   */
  updatedAt?: Date | FieldValue

  /**
   * Deterministic hash of the raw source document for deduplication.
   */
  sourceHash: string

  /**
   * Additional metadata specific to the source type.
   */
  metadata?: Record<string, unknown> | null
}

/**
 * A briefing card as rendered in the teleprompter UI.
 * Extends BriefingSourceItem with computed/display fields.
 */
export interface BriefingCard extends BriefingSourceItem {
  /**
   * Time-ago string for display (e.g., "5 minutes ago").
   */
  timeAgo?: string

  /**
   * Whether this card is new/unread.
   */
  unread?: boolean

  /**
   * Whether this card requires action.
   */
  requiresAction?: boolean

  /**
   * Related briefings that should be grouped together.
   */
  relatedIds?: string[]

  /**
   * Computed relevance score for sorting.
   */
  relevanceScore?: number

  /**
   * Per-user control state from the briefing desk.
   */
  userState?: {
    status: 'active' | 'handled' | 'snoozed'
    note?: string | null
    snoozedUntil?: string | null
    updatedAt?: string | null
  } | null
}

/**
 * Source adapter interface for converting Firestore docs to briefing items.
 */
export interface BriefingSourceAdapter<T = Record<string, unknown>> {
  /**
   * Source type this adapter handles.
   */
  sourceType: BriefingSourceType

  /**
   * Firestore collection path for this source.
   */
  collectionPath: string

  /**
   * Extract a deterministic hash from the source document.
   */
  hashSource(doc: T, docId: string): string

  /**
   * Determine if the source document should generate a briefing item.
   */
  shouldGenerate(doc: T, docId: string): boolean

  /**
   * Extract priority from the source document.
   */
  extractPriority(doc: T, docId: string): BriefingPriority

  /**
   * Extract actor information from the source document.
   */
  extractActor(doc: T, docId: string): BriefingActor

  /**
   * Extract context metadata from the source document.
   */
  extractContext(doc: T, docId: string): BriefingContext

  /**
   * Extract title from the source document.
   */
  extractTitle(doc: T, docId: string): string

  /**
   * Extract summary from the source document.
   */
  extractSummary(doc: T, docId: string): string

  /**
   * Extract a safe excerpt (truncated, sanitized) from the source document.
   */
  extractExcerpt(doc: T, docId: string, maxLength?: number): string | null

  /**
   * Extract the timestamp when the source event occurred.
   */
  extractOccurredAt(doc: T, docId: string): Date | null

  /**
   * Extract additional metadata specific to this source type.
   */
  extractMetadata?(doc: T, docId: string): Record<string, unknown> | null

  /**
   * Convert the full source document to a briefing source item.
   */
  toItem(doc: T, docId: string): BriefingSourceItem
}

/**
 * Safe excerpt generation options.
 */
export interface SafeExcerptOptions {
  maxLength?: number
  stripHtml?: boolean
  stripMarkdown?: boolean
  collapseWhitespace?: boolean
}

/**
 * Briefing filter criteria for queries.
 */
export interface BriefingFilter {
  orgIds?: string[]
  priorities?: BriefingPriority[]
  sourceTypes?: BriefingSourceType[]
  status?: BriefingStatus
  requiresAction?: boolean
  clientIds?: string[]
  projectIds?: string[]
  actorIds?: string[]
  occurredAfter?: Date
  occurredBefore?: Date
}

/**
 * Briefing sort options.
 */
export interface BriefingSort {
  field: 'occurredAt' | 'createdAt' | 'priority' | 'relevanceScore'
  direction: 'asc' | 'desc'
}

/**
 * Paginated briefing items response.
 */
export interface BriefingResponse {
  items: BriefingCard[]
  total: number
  page?: number
  pageSize?: number
  hasMore: boolean
}
