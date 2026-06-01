/**
 * Source adapter for social engagement inbox items.
 *
 * Pulls unread/read inbound engagement into Briefings so operators can mark it
 * read, replied, or archived without leaving the control desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface SocialInboxUser {
  name?: string | null
  username?: string | null
  profileUrl?: string | null
}

interface SocialInboxDocument extends Record<string, unknown> {
  orgId?: string | null
  platform?: string | null
  type?: string | null
  fromUser?: SocialInboxUser | null
  content?: string | null
  postId?: string | null
  platformItemId?: string | null
  platformUrl?: string | null
  status?: 'unread' | 'read' | 'replied' | 'archived' | string | null
  priority?: 'high' | 'normal' | 'low' | string | null
  sentiment?: 'positive' | 'neutral' | 'negative' | string | null
  createdAt?: unknown
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function inboxOrgId(doc: SocialInboxDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function fromName(doc: SocialInboxDocument): string {
  return clean(doc.fromUser?.name) ?? clean(doc.fromUser?.username) ?? 'Social user'
}

function fromHandle(doc: SocialInboxDocument, docId: string): string {
  return clean(doc.fromUser?.username) ?? clean(doc.platformItemId) ?? docId
}

function platformLabel(doc: SocialInboxDocument): string {
  return clean(doc.platform) ?? 'social'
}

function engagementType(doc: SocialInboxDocument): string {
  return clean(doc.type) ?? 'message'
}

function typeLabel(doc: SocialInboxDocument): string {
  const type = engagementType(doc)
  if (type.toLowerCase() === 'dm') return 'DM'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

export const socialInboxAdapter: BriefingSourceAdapter<SocialInboxDocument> = {
  sourceType: 'social-inbox',
  collectionPath: 'social_inbox',

  hashSource(doc: SocialInboxDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['platform', 'type', 'fromUser', 'content', 'postId', 'platformItemId', 'platformUrl', 'status', 'priority', 'sentiment', 'updatedAt'])
  },

  shouldGenerate(doc: SocialInboxDocument): boolean {
    const status = clean(doc.status) ?? 'unread'
    return status !== 'archived' && status !== 'replied' && Boolean(clean(doc.content) || clean(doc.platformItemId))
  },

  extractPriority(doc: SocialInboxDocument): BriefingPriority {
    if (doc.priority === 'high') return 'needs-peet'
    if (doc.sentiment === 'negative') return 'client-risk'
    if (doc.status === 'unread') return 'review'
    return 'fyi'
  },

  extractActor(doc: SocialInboxDocument, docId: string) {
    return {
      id: `social:${fromHandle(doc, docId)}`,
      name: fromName(doc),
      role: 'client' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: SocialInboxDocument, docId: string) {
    return {
      orgId: inboxOrgId(doc),
      socialInboxId: docId,
      socialInboxFrom: fromName(doc),
      socialPostId: clean(doc.postId),
    }
  },

  extractTitle(doc: SocialInboxDocument): string {
    return `Social ${typeLabel(doc)} needs reply from ${fromName(doc)}`
  },

  extractSummary(doc: SocialInboxDocument): string {
    const parts = [`${fromName(doc)} sent an ${platformLabel(doc)} ${typeLabel(doc)} that needs a response`]
    const excerpt = extractMultiFieldExcerpt({ content: doc.content }, ['content'], { maxLength: 160 })
    if (excerpt) parts.push(excerpt)
    return parts.join('. ')
  },

  extractExcerpt(doc: SocialInboxDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt({ content: doc.content }, ['content'], { maxLength })
  },

  extractOccurredAt(doc: SocialInboxDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: SocialInboxDocument): Record<string, unknown> | null {
    return {
      socialInboxStatus: clean(doc.status) ?? 'unread',
      platform: clean(doc.platform),
      engagementType: clean(doc.type),
      priority: clean(doc.priority),
      sentiment: clean(doc.sentiment),
      platformUrl: clean(doc.platformUrl),
      platformItemId: clean(doc.platformItemId),
      profileUrl: clean(doc.fromUser?.profileUrl),
      postId: clean(doc.postId),
    }
  },

  toItem(doc: SocialInboxDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: inboxOrgId(doc),
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/social/inbox?item=${encodeURIComponent(docId)}`,
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
