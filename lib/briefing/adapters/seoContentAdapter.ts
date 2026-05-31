/**
 * Source adapter for SEO content.
 *
 * Pulls review-ready SEO content into Briefings so clients and admins can
 * approve content or request changes without leaving the control desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface SeoContentDocument extends Record<string, unknown> {
  orgId?: string | null
  orgSlug?: string | null
  sprintId?: string | null
  campaignId?: string | null
  title?: string | null
  type?: string | null
  status?: string | null
  targetKeyword?: string | null
  targetKeywordId?: string | null
  targetUrl?: string | null
  publishDate?: unknown
  draftPostId?: string | null
  createdBy?: string | null
  createdByType?: string | null
  summary?: string | null
  notes?: string | null
  updatedAt?: unknown
  createdAt?: unknown
  deleted?: boolean | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isoDate(value: unknown): string | null {
  const date = normalizeTimestamp(value)
  return date ? date.toISOString().slice(0, 10) : null
}

function seoOrgId(doc: SeoContentDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function title(doc: SeoContentDocument, docId: string): string {
  return clean(doc.title) ?? docId
}

function sourceUrl(doc: SeoContentDocument, docId: string): string {
  const sprintId = clean(doc.sprintId)
  if (sprintId) return `/admin/seo/sprints/${encodeURIComponent(sprintId)}/content?content=${encodeURIComponent(docId)}`
  if (doc.orgSlug) return `/admin/org/${encodeURIComponent(doc.orgSlug)}/seo?content=${encodeURIComponent(docId)}`
  return `/admin/seo?content=${encodeURIComponent(docId)}`
}

export const seoContentAdapter: BriefingSourceAdapter<SeoContentDocument> = {
  sourceType: 'seo-content',
  collectionPath: 'seo_content',

  hashSource(doc: SeoContentDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['title', 'status', 'type', 'targetKeyword', 'publishDate', 'updatedAt'])
  },

  shouldGenerate(doc: SeoContentDocument): boolean {
    if (doc.deleted === true) return false
    return doc.status === 'review'
  },

  extractPriority(): BriefingPriority {
    return 'needs-peet'
  },

  extractActor(doc: SeoContentDocument) {
    const createdBy = clean(doc.createdBy)
    const createdByType = clean(doc.createdByType)
    const isAgent = createdByType === 'agent' || createdBy?.startsWith('agent:')
    return {
      id: createdBy ?? 'system',
      role: isAgent ? 'ai' as const : 'system' as const,
      type: isAgent ? 'agent' as const : 'system' as const,
    }
  },

  extractContext(doc: SeoContentDocument, docId: string) {
    return {
      orgId: seoOrgId(doc),
      orgSlug: clean(doc.orgSlug),
      seoContentId: docId,
      seoContentTitle: title(doc, docId),
      seoSprintId: clean(doc.sprintId),
    }
  },

  extractTitle(doc: SeoContentDocument, docId: string): string {
    return `SEO content awaiting review: ${title(doc, docId)}`
  },

  extractSummary(doc: SeoContentDocument): string {
    const parts: string[] = []
    const type = clean(doc.type)
    const keyword = clean(doc.targetKeyword) ?? clean(doc.targetKeywordId)
    const publishDate = isoDate(doc.publishDate)
    if (type && keyword) parts.push(`${type} content for ${keyword}`)
    else if (type) parts.push(`${type} content`)
    else if (keyword) parts.push(`SEO content for ${keyword}`)
    parts.push('Ready for client review')
    if (publishDate) parts.push(`Publish date: ${publishDate}`)
    const excerpt = extractMultiFieldExcerpt(doc, ['summary', 'notes'], { maxLength: 120 })
    if (excerpt) parts.push(excerpt)
    return parts.join('. ')
  },

  extractExcerpt(doc: SeoContentDocument, docId: string, maxLength = 300): string | null {
    const summary = this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ summary, rawSummary: doc.summary, notes: doc.notes }, ['summary', 'rawSummary', 'notes'], { maxLength })
  },

  extractOccurredAt(doc: SeoContentDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.publishDate)
  },

  extractMetadata(doc: SeoContentDocument): Record<string, unknown> | null {
    return {
      seoStatus: doc.status,
      contentType: clean(doc.type),
      targetKeyword: clean(doc.targetKeyword) ?? clean(doc.targetKeywordId),
      targetUrl: clean(doc.targetUrl),
      publishDate: isoDate(doc.publishDate),
      draftPostId: clean(doc.draftPostId),
      campaignId: clean(doc.campaignId),
      sprintId: clean(doc.sprintId),
    }
  },

  toItem(doc: SeoContentDocument, docId: string) {
    const orgId = seoOrgId(doc)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl(doc, docId),
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
