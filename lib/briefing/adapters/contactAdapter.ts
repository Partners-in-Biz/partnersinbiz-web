/**
 * Source adapter for CRM contacts that need relationship follow-up.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, hashSourceDocument, normalizeTimestamp } from '../utils'

interface ContactDocument extends Record<string, unknown> {
  orgId?: string | null
  name?: string | null
  email?: string | null
  company?: string | null
  companyName?: string | null
  type?: string | null
  stage?: string | null
  notes?: string | null
  assignedTo?: string | null
  deleted?: boolean
  lastContactedAt?: unknown
  lastRepliedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isoDate(value: unknown): string | null {
  return normalizeTimestamp(value)?.toISOString() ?? null
}

function dateLabel(value: unknown): string | null {
  return isoDate(value)?.slice(0, 10) ?? null
}

function daysSince(value: unknown): number | null {
  const timestamp = normalizeTimestamp(value)
  if (!timestamp) return null
  return Math.floor((Date.now() - timestamp.getTime()) / 86_400_000)
}

function contactName(doc: ContactDocument, docId: string): string {
  return clean(doc.name) ?? clean(doc.email) ?? docId
}

function companyLabel(doc: ContactDocument): string | null {
  return clean(doc.companyName) ?? clean(doc.company)
}

export const contactAdapter: BriefingSourceAdapter<ContactDocument> = {
  sourceType: 'contact',
  collectionPath: 'contacts',

  hashSource(doc: ContactDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'email', 'stage', 'type', 'lastContactedAt', 'lastRepliedAt', 'updatedAt'])
  },

  shouldGenerate(doc: ContactDocument): boolean {
    if (doc.deleted === true) return false
    if (!clean(doc.orgId)) return false
    if (clean(doc.type) === 'churned' || clean(doc.stage) === 'lost') return false

    const lastContactedDays = daysSince(doc.lastContactedAt)
    if (lastContactedDays === null) return true
    return lastContactedDays >= 30
  },

  extractPriority(doc: ContactDocument): BriefingPriority {
    const days = daysSince(doc.lastContactedAt)
    if (days === null || days >= 90) return 'client-risk'
    return 'needs-peet'
  },

  extractActor(doc: ContactDocument, docId: string) {
    return {
      id: `crm:${docId}`,
      name: contactName(doc, docId),
      role: 'client' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: ContactDocument, docId: string) {
    return {
      orgId: clean(doc.orgId) ?? '',
      contactId: docId,
      contactName: contactName(doc, docId),
    }
  },

  extractTitle(doc: ContactDocument, docId: string): string {
    return `Follow up ${contactName(doc, docId)}`
  },

  extractSummary(doc: ContactDocument, docId: string): string {
    const name = contactName(doc, docId)
    const lastContacted = dateLabel(doc.lastContactedAt)
    const parts = [
      lastContacted
        ? `${name} has not been contacted since ${lastContacted}`
        : `${name} has no recorded contact touchpoint`,
    ]
    const stage = clean(doc.stage)
    if (stage) parts.push(`Stage: ${stage}`)
    const type = clean(doc.type)
    if (type) parts.push(`Type: ${type}`)
    const company = companyLabel(doc)
    if (company) parts.push(`Company: ${company}`)
    return parts.join('. ')
  },

  extractExcerpt(doc: ContactDocument, docId: string, maxLength = 300): string | null {
    const safeNotes = extractMultiFieldExcerpt(doc, ['notes'], { maxLength })
    return safeNotes ?? this.extractSummary(doc, docId)
  },

  extractOccurredAt(doc: ContactDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.lastContactedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: ContactDocument): Record<string, unknown> | null {
    return {
      contactStage: clean(doc.stage),
      contactType: clean(doc.type),
      lastContactedAt: isoDate(doc.lastContactedAt),
      lastRepliedAt: isoDate(doc.lastRepliedAt),
      company: companyLabel(doc),
      email: clean(doc.email),
      assignedTo: clean(doc.assignedTo),
    }
  },

  toItem(doc: ContactDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: clean(doc.orgId) ?? '',
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/portal/contacts/${encodeURIComponent(docId)}`,
      },
      priority: this.extractPriority(doc, docId),
      status: 'new',
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
