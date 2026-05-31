/**
 * Source adapter for broadcast campaigns.
 *
 * Pulls email/social broadcast work into Briefings so campaign sends can be
 * queued, paused, resumed, or inspected from the control desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface BroadcastDocument extends Record<string, unknown> {
  orgId?: string | null
  name?: string | null
  description?: string | null
  status?: string | null
  channel?: string | null
  content?: {
    subject?: string | null
    preheader?: string | null
    bodyText?: string | null
  } | null
  audience?: {
    segmentId?: string | null
    contactIds?: string[] | null
    tags?: string[] | null
  } | null
  stats?: {
    audienceSize?: number | null
    sent?: number | null
    failed?: number | null
  } | null
  topicId?: string | null
  createdBy?: string | null
  scheduledFor?: unknown
  sendStartedAt?: unknown
  sendCompletedAt?: unknown
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

function broadcastOrgId(doc: BroadcastDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function broadcastName(doc: BroadcastDocument, docId: string): string {
  return clean(doc.name) ?? clean(doc.content?.subject) ?? docId
}

function broadcastStatus(doc: BroadcastDocument): string {
  return clean(doc.status) ?? 'draft'
}

function sourceUrl(docId: string): string {
  return `/portal/campaigns/broadcast/${encodeURIComponent(docId)}`
}

function statusTitle(status: string): string {
  switch (status) {
    case 'failed':
      return 'Broadcast failed'
    case 'paused':
      return 'Broadcast paused'
    case 'scheduled':
      return 'Broadcast scheduled'
    case 'sending':
      return 'Broadcast sending'
    default:
      return 'Broadcast ready to send'
  }
}

export const broadcastAdapter: BriefingSourceAdapter<BroadcastDocument> = {
  sourceType: 'broadcast',
  collectionPath: 'broadcasts',

  hashSource(doc: BroadcastDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'status', 'channel', 'content', 'audience', 'stats', 'scheduledFor', 'updatedAt'])
  },

  shouldGenerate(doc: BroadcastDocument): boolean {
    if (doc.deleted === true) return false
    return ['draft', 'scheduled', 'sending', 'paused', 'failed'].includes(broadcastStatus(doc))
  },

  extractPriority(doc: BroadcastDocument): BriefingPriority {
    const status = broadcastStatus(doc)
    if (status === 'failed') return 'critical'
    if (status === 'sending') return 'progress'
    if (status === 'scheduled') return 'review'
    return 'needs-peet'
  },

  extractActor(doc: BroadcastDocument) {
    const actorId = clean(doc.createdBy) ?? 'system:broadcast'
    return {
      id: actorId,
      name: actorId === 'system:broadcast' ? 'Campaign system' : null,
      role: actorId === 'system:broadcast' ? 'system' as const : 'admin' as const,
      type: actorId === 'system:broadcast' ? 'system' as const : 'user' as const,
    }
  },

  extractContext(doc: BroadcastDocument, docId: string) {
    return {
      orgId: broadcastOrgId(doc),
      broadcastId: docId,
      broadcastName: broadcastName(doc, docId),
    }
  },

  extractTitle(doc: BroadcastDocument, docId: string): string {
    return `${statusTitle(broadcastStatus(doc))}: ${broadcastName(doc, docId)}`
  },

  extractSummary(doc: BroadcastDocument): string {
    const parts: string[] = []
    const channel = clean(doc.channel) ?? 'email'
    const status = broadcastStatus(doc)
    const subject = clean(doc.content?.subject)
    const audienceSize = numberValue(doc.stats?.audienceSize) ?? doc.audience?.contactIds?.length ?? null
    const scheduledFor = isoDateTime(doc.scheduledFor)
    parts.push(`${channel} broadcast is ${status}`)
    if (audienceSize !== null) parts.push(`${audienceSize} recipients`)
    if (subject) parts.push(`Subject: ${subject}`)
    if (scheduledFor) parts.push(`Scheduled: ${scheduledFor}`)
    const excerpt = extractMultiFieldExcerpt(doc, ['description', 'content.preheader', 'content.bodyText'], { maxLength: 120 })
    if (excerpt) parts.push(excerpt)
    return parts.join('. ')
  },

  extractExcerpt(doc: BroadcastDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, description: doc.description, content: doc.content }, ['summary', 'description', 'content.bodyText', 'content.preheader'], { maxLength })
  },

  extractOccurredAt(doc: BroadcastDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.scheduledFor)
  },

  extractMetadata(doc: BroadcastDocument): Record<string, unknown> | null {
    return {
      broadcastStatus: broadcastStatus(doc),
      channel: clean(doc.channel) ?? 'email',
      subject: clean(doc.content?.subject),
      preheader: clean(doc.content?.preheader),
      audienceSize: numberValue(doc.stats?.audienceSize) ?? doc.audience?.contactIds?.length ?? null,
      segmentId: clean(doc.audience?.segmentId),
      tags: doc.audience?.tags ?? null,
      scheduledFor: isoDateTime(doc.scheduledFor),
      sendStartedAt: isoDateTime(doc.sendStartedAt),
      sendCompletedAt: isoDateTime(doc.sendCompletedAt),
      sent: numberValue(doc.stats?.sent),
      failed: numberValue(doc.stats?.failed),
      topicId: clean(doc.topicId),
    }
  },

  toItem(doc: BroadcastDocument, docId: string) {
    const orgId = broadcastOrgId(doc)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl(docId),
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
