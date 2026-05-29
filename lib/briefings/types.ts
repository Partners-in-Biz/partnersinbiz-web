/**
 * Briefings - Live intelligence feed with priority scoring and deduplication
 *
 * Briefings are time-sensitive intelligence items (news, alerts, market signals)
 * that need rapid dissemination, deduplication, and snapshot reporting.
 */

export type BriefingKind =
  | 'news'           // General news items
  | 'market_signal'  // Market movements, trends
  | 'competitor'     // Competitor activity
  | 'risk'           // Risk alerts, issues
  | 'opportunity'    // Growth opportunities
  | 'regulation'     // Regulatory changes
  | 'technology'     // Tech news/disruptions
  | 'other'          // Uncategorized

export type BriefingStatus =
  | 'draft'          // Work in progress
  | 'pending_review' // Awaiting review
  | 'approved'       // Approved for distribution
  | 'distributed'    // Has been sent to recipients
  | 'archived'       // No longer relevant

export type BriefingPriority =
  | 'critical'       // Immediate action required
  | 'high'           // Review and act within hours
  | 'medium'         // Review within 24-48 hours
  | 'low'            // Informational only

export type BriefingVisibility =
  | 'internal'       // PiB internal only
  | 'client_visible' // Visible to client
  | 'public'         // Publicly shareable

export type SourceType =
  | 'news_article'
  | 'press_release'
  | 'social_media'
  | 'report'
  | 'official_source'
  | 'internal_note'
  | 'other'

export interface BriefingSource {
  id: string
  briefingId: string
  type: SourceType
  title: string
  url?: string
  excerpt?: string
  mediaUrl?: string
  publisher?: string
  author?: string
  sourceDate?: string
  confidence: 'high' | 'medium' | 'low'
  verified: boolean
  rawText?: string
  contentHash?: string  // SHA-256 hash of normalized content for deduplication
  metadata?: Record<string, unknown>
  createdAt: FirebaseFirestore.Timestamp
  createdBy: string
  updatedAt: FirebaseFirestore.Timestamp
  updatedBy: string
  deleted: boolean
}

export interface Briefing {
  id: string
  orgId: string
  title: string
  slug: string
  kind: BriefingKind
  status: BriefingStatus
  priority: BriefingPriority
  visibility: BriefingVisibility
  summary: string
  notesMarkdown?: string
  tags: string[]
  sources: BriefingSource[]
  linked: {
    projectId?: string
    campaignId?: string
    seoSprintId?: string
    dealId?: string
    companyId?: string
    contactId?: string
    documentIds?: string[]
  }
  dedupeHash?: string           // Composite hash for de-duplication
  dedupeScore?: number          // 0-1 similarity score against existing
  priorityScore?: number        // 0-100 composite priority score
  relevantEntities: string[]    // Extracted entities (companies, people, etc)
  timeframe?: string            // 'immediate', 'today', 'this_week', 'this_month', 'ongoing'
  distribution: {
    sentAt?: FirebaseFirestore.Timestamp
    recipientCount?: number
    channels?: string[]
  }
  obsidian?: {
    exported: boolean
    path?: string
    sourcesPath?: string
    exportedAt?: FirebaseFirestore.Timestamp
    exportedBy?: string
  }
  createdAt: FirebaseFirestore.Timestamp
  createdBy: string
  updatedAt: FirebaseFirestore.Timestamp
  updatedBy: string
  deleted: boolean
}

export interface BriefingSnapshot {
  id: string
  orgId: string
  briefingIds: string[]           // Briefings included in this snapshot
  title: string
  description?: string
  kind: 'daily' | 'weekly' | 'ad_hoc' | 'event_driven'
  status: 'draft' | 'generated' | 'shared' | 'archived'
  generatedAt: FirebaseFirestore.Timestamp
  generatedBy: string
  sharedAt?: FirebaseFirestore.Timestamp
  sharedBy?: string
  summary: {
    totalBriefings: number
    byPriority: Record<BriefingPriority, number>
    byKind: Record<BriefingKind, number>
    topTopics: string[]
  }
  metadata?: Record<string, unknown>
  createdAt: FirebaseFirestore.Timestamp
  createdBy: string
  updatedAt: FirebaseFirestore.Timestamp
  updatedBy: string
  deleted: boolean
}

export interface BriefingActivity {
  id: string
  briefingId?: string
  snapshotId?: string
  orgId: string
  userId: string
  action: 'created' | 'updated' | 'approved' | 'distributed' | 'archived' | 'viewed' | 'commented'
  details?: Record<string, unknown>
  timestamp: FirebaseFirestore.Timestamp
}

export type BriefingListFilters = {
  orgId: string
  status?: BriefingStatus
  kind?: BriefingKind
  priority?: BriefingPriority
  visibility?: BriefingVisibility
  q?: string
  timeframe?: string
  startDate?: string
  endDate?: string
  minPriorityScore?: number
}

export type BriefingSnapshotListFilters = {
  orgId: string
  status?: BriefingSnapshot['status']
  kind?: BriefingSnapshot['kind']
  startDate?: string
  endDate?: string
}

export const BRIEFING_KINDS: readonly BriefingKind[] = [
  'news', 'market_signal', 'competitor', 'risk', 'opportunity', 'regulation', 'technology', 'other'
] as const

export const BRIEFING_STATUSES: readonly BriefingStatus[] = [
  'draft', 'pending_review', 'approved', 'distributed', 'archived'
] as const

export const BRIEFING_PRIORITIES: readonly BriefingPriority[] = [
  'critical', 'high', 'medium', 'low'
] as const

export const BRIEFING_VISIBILITIES: readonly BriefingVisibility[] = [
  'internal', 'client_visible', 'public'
] as const

export const BRIEFING_SOURCE_TYPES: readonly SourceType[] = [
  'news_article', 'press_release', 'social_media', 'report', 'official_source', 'internal_note', 'other'
] as const

export const BRIEFING_SNAPSHOT_KINDS: readonly BriefingSnapshot['kind'][] = [
  'daily', 'weekly', 'ad_hoc', 'event_driven'
] as const

export const BRIEFING_SNAPSHOT_STATUSES: readonly BriefingSnapshot['status'][] = [
  'draft', 'generated', 'shared', 'archived'
] as const

export const PRIORITY_WEIGHTS: Record<BriefingPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25
} as const

export const KIND_BOOSTS: Partial<Record<BriefingKind, number>> = {
  risk: 10,
  market_signal: 5
} as const
