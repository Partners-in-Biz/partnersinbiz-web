/**
 * Source adapter for top-level content/email campaigns.
 *
 * Campaigns coordinate sequences, audiences, capture triggers, social/SEO
 * assets, and launch state. This adapter turns active campaign work into
 * Briefings cards so the desk can approve assets, launch, or archive.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface CampaignDocument extends Record<string, unknown> {
  orgId?: string | null
  name?: string | null
  description?: string | null
  status?: string | null
  segmentId?: string | null
  contactIds?: string[] | null
  sequenceId?: string | null
  fromName?: string | null
  fromDomainId?: string | null
  replyTo?: string | null
  triggers?: {
    captureSourceIds?: string[] | null
    tags?: string[] | null
  } | null
  startAt?: unknown
  endAt?: unknown
  stats?: {
    enrolled?: number | null
    sent?: number | null
    opened?: number | null
    clicked?: number | null
    bounced?: number | null
    unsubscribed?: number | null
  } | null
  createdBy?: string | null
  updatedAt?: unknown
  createdAt?: unknown
  deleted?: boolean | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isoDateTime(value: unknown): string | null {
  const date = normalizeTimestamp(value)
  return date ? date.toISOString() : null
}

function campaignOrgId(doc: CampaignDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function campaignName(doc: CampaignDocument, docId: string): string {
  return clean(doc.name) ?? docId
}

function campaignStatus(doc: CampaignDocument): string {
  return clean(doc.status) ?? 'draft'
}

function titlePrefix(status: string): string {
  switch (status) {
    case 'active':
      return 'Campaign active'
    case 'paused':
      return 'Campaign paused'
    case 'scheduled':
      return 'Campaign scheduled'
    default:
      return 'Campaign ready to launch'
  }
}

function contactCount(doc: CampaignDocument): number | null {
  return Array.isArray(doc.contactIds) ? doc.contactIds.length : null
}

export const campaignAdapter: BriefingSourceAdapter<CampaignDocument> = {
  sourceType: 'campaign',
  collectionPath: 'campaigns',

  hashSource(doc: CampaignDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'status', 'segmentId', 'contactIds', 'sequenceId', 'startAt', 'endAt', 'stats', 'updatedAt'])
  },

  shouldGenerate(doc: CampaignDocument): boolean {
    if (doc.deleted === true) return false
    return ['draft', 'scheduled', 'active', 'paused'].includes(campaignStatus(doc))
  },

  extractPriority(doc: CampaignDocument): BriefingPriority {
    const status = campaignStatus(doc)
    if (status === 'active') return 'progress'
    if (status === 'scheduled') return 'review'
    return 'needs-peet'
  },

  extractActor(doc: CampaignDocument) {
    const actorId = clean(doc.createdBy) ?? 'system:campaign'
    return {
      id: actorId,
      name: actorId === 'system:campaign' ? 'Campaign system' : null,
      role: actorId === 'system:campaign' ? 'system' as const : 'admin' as const,
      type: actorId === 'system:campaign' ? 'system' as const : 'user' as const,
    }
  },

  extractContext(doc: CampaignDocument, docId: string) {
    return {
      orgId: campaignOrgId(doc),
      campaignId: docId,
      campaignName: campaignName(doc, docId),
    }
  },

  extractTitle(doc: CampaignDocument, docId: string): string {
    return `${titlePrefix(campaignStatus(doc))}: ${campaignName(doc, docId)}`
  },

  extractSummary(doc: CampaignDocument): string {
    const parts: string[] = []
    const status = campaignStatus(doc)
    const contacts = contactCount(doc)
    const enrolled = numberValue(doc.stats?.enrolled)
    const sent = numberValue(doc.stats?.sent)
    const startAt = isoDateTime(doc.startAt)
    parts.push(`Campaign is ${status}`)
    if (contacts !== null) parts.push(`${contacts} direct contacts`)
    if (clean(doc.segmentId)) parts.push(`Segment: ${clean(doc.segmentId)}`)
    if (clean(doc.sequenceId)) parts.push(`Sequence: ${clean(doc.sequenceId)}`)
    if (enrolled !== null) parts.push(`${enrolled} enrolled`)
    if (sent !== null) parts.push(`${sent} sent`)
    if (startAt) parts.push(`Starts: ${startAt}`)
    const excerpt = extractMultiFieldExcerpt(doc, ['description'], { maxLength: 120 })
    if (excerpt) parts.push(excerpt)
    return parts.join('. ')
  },

  extractExcerpt(doc: CampaignDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, description: doc.description }, ['summary', 'description'], { maxLength })
  },

  extractOccurredAt(doc: CampaignDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.startAt)
  },

  extractMetadata(doc: CampaignDocument): Record<string, unknown> | null {
    return {
      campaignStatus: campaignStatus(doc),
      segmentId: clean(doc.segmentId),
      sequenceId: clean(doc.sequenceId),
      contactCount: contactCount(doc),
      fromName: clean(doc.fromName),
      fromDomainId: clean(doc.fromDomainId),
      replyTo: clean(doc.replyTo),
      triggerCaptureSourceIds: doc.triggers?.captureSourceIds ?? null,
      triggerTags: doc.triggers?.tags ?? null,
      startAt: isoDateTime(doc.startAt),
      endAt: isoDateTime(doc.endAt),
      enrolled: numberValue(doc.stats?.enrolled),
      sent: numberValue(doc.stats?.sent),
      opened: numberValue(doc.stats?.opened),
      clicked: numberValue(doc.stats?.clicked),
      bounced: numberValue(doc.stats?.bounced),
      unsubscribed: numberValue(doc.stats?.unsubscribed),
    }
  },

  toItem(doc: CampaignDocument, docId: string) {
    const orgId = campaignOrgId(doc)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/portal/campaigns/${encodeURIComponent(docId)}`,
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
