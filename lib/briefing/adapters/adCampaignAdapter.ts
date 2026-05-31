/**
 * Source adapter for ad campaigns.
 *
 * Brings client approval work from the Ads module into the Briefings control
 * desk so campaign launches can be approved or sent back from the live feed.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface AdCampaignDocument extends Record<string, unknown> {
  orgId?: string | null
  orgSlug?: string | null
  platform?: string | null
  adAccountId?: string | null
  name?: string | null
  objective?: string | null
  status?: string | null
  reviewState?: string | null
  dailyBudget?: number | null
  lifetimeBudget?: number | null
  startTime?: unknown
  endTime?: unknown
  submittedForReviewAt?: unknown
  submittedForReviewBy?: string | null
  createdBy?: string | null
  updatedAt?: unknown
  createdAt?: unknown
  approvalNotes?: string | null
  rejectionReason?: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function moneyFromCents(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `R${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isoDate(value: unknown): string | null {
  const date = normalizeTimestamp(value)
  return date ? date.toISOString().slice(0, 10) : null
}

function adCampaignOrgId(doc: AdCampaignDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function campaignName(doc: AdCampaignDocument, docId: string): string {
  return clean(doc.name) ?? docId
}

function adminSourceUrl(doc: AdCampaignDocument, docId: string): string {
  const slug = clean(doc.orgSlug)
  if (slug) return `/admin/org/${encodeURIComponent(slug)}/ads/campaigns/${encodeURIComponent(docId)}`
  return `/admin/marketing?adCampaign=${encodeURIComponent(docId)}`
}

export const adCampaignAdapter: BriefingSourceAdapter<AdCampaignDocument> = {
  sourceType: 'ad-campaign',
  collectionPath: 'ad_campaigns',

  hashSource(doc: AdCampaignDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'status', 'reviewState', 'dailyBudget', 'lifetimeBudget', 'submittedForReviewAt', 'updatedAt'])
  },

  shouldGenerate(doc: AdCampaignDocument): boolean {
    return doc.reviewState === 'awaiting' && doc.status === 'PENDING_REVIEW'
  },

  extractPriority(): BriefingPriority {
    return 'needs-peet'
  },

  extractActor(doc: AdCampaignDocument) {
    const actorId = clean(doc.submittedForReviewBy) ?? clean(doc.createdBy) ?? 'system'
    return {
      id: actorId,
      role: actorId === 'system' ? 'system' as const : 'admin' as const,
      type: actorId === 'system' ? 'system' as const : 'user' as const,
    }
  },

  extractContext(doc: AdCampaignDocument, docId: string) {
    return {
      orgId: adCampaignOrgId(doc),
      orgSlug: clean(doc.orgSlug),
      adCampaignId: docId,
      adCampaignName: campaignName(doc, docId),
    }
  },

  extractTitle(doc: AdCampaignDocument, docId: string): string {
    return `Ad campaign awaiting approval: ${campaignName(doc, docId)}`
  },

  extractSummary(doc: AdCampaignDocument): string {
    const parts: string[] = []
    const platform = clean(doc.platform)
    const objective = clean(doc.objective)
    const dailyBudget = moneyFromCents(doc.dailyBudget)
    const lifetimeBudget = moneyFromCents(doc.lifetimeBudget)
    const startDate = isoDate(doc.startTime)
    if (platform && objective) parts.push(`${platform} ${objective} campaign`)
    else if (objective) parts.push(`${objective} campaign`)
    else if (platform) parts.push(`${platform} ad campaign`)
    else parts.push('Ad campaign')
    parts.push('Waiting for client approval before launch')
    if (dailyBudget) parts.push(`${dailyBudget} daily budget`)
    if (lifetimeBudget) parts.push(`${lifetimeBudget} lifetime budget`)
    if (startDate) parts.push(`Starts: ${startDate}`)
    const notes = extractMultiFieldExcerpt(doc, ['approvalNotes', 'rejectionReason'], { maxLength: 120 })
    if (notes) parts.push(notes)
    return parts.join('. ')
  },

  extractExcerpt(doc: AdCampaignDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, approvalNotes: doc.approvalNotes, rejectionReason: doc.rejectionReason }, ['summary', 'approvalNotes', 'rejectionReason'], { maxLength })
  },

  extractOccurredAt(doc: AdCampaignDocument): Date | null {
    return normalizeTimestamp(doc.submittedForReviewAt) ?? normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: AdCampaignDocument): Record<string, unknown> | null {
    return {
      adCampaignStatus: clean(doc.status),
      reviewState: clean(doc.reviewState),
      platform: clean(doc.platform),
      objective: clean(doc.objective),
      dailyBudget: doc.dailyBudget,
      lifetimeBudget: doc.lifetimeBudget,
      adAccountId: clean(doc.adAccountId),
      submittedForReviewAt: isoDate(doc.submittedForReviewAt),
      startTime: isoDate(doc.startTime),
      endTime: isoDate(doc.endTime),
    }
  },

  toItem(doc: AdCampaignDocument, docId: string) {
    const orgId = adCampaignOrgId(doc)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: adminSourceUrl(doc, docId),
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
