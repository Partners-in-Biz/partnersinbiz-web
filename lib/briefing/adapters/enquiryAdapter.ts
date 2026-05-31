import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, hashSourceDocument, normalizeTimestamp } from '../utils'

interface EnquiryDocument extends Record<string, unknown> {
  userId?: string | null
  name?: string | null
  email?: string | null
  company?: string | null
  projectType?: string | null
  details?: string | null
  status?: string | null
  assignedTo?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function enquiryName(doc: EnquiryDocument, docId: string): string {
  return clean(doc.name) ?? clean(doc.email) ?? docId
}

function sourceUrl(docId: string): string {
  return `/admin/briefings?source=enquiry&id=${encodeURIComponent(docId)}`
}

export const enquiryAdapter: BriefingSourceAdapter<EnquiryDocument> = {
  sourceType: 'enquiry',
  collectionPath: 'enquiries',

  hashSource(doc: EnquiryDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'email', 'company', 'projectType', 'details', 'status', 'assignedTo', 'createdAt', 'updatedAt'])
  },

  shouldGenerate(doc: EnquiryDocument): boolean {
    return doc.status === 'new' || doc.status === 'reviewing' || doc.status === 'active'
  },

  extractPriority(doc: EnquiryDocument): BriefingPriority {
    return doc.status === 'active' ? 'client-risk' : 'needs-peet'
  },

  extractActor(doc: EnquiryDocument, docId: string) {
    return {
      id: clean(doc.userId) ?? 'public-enquiry',
      name: enquiryName(doc, docId),
      role: 'client' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: EnquiryDocument, docId: string) {
    return {
      orgId: PIB_PLATFORM_ORG_ID,
      enquiryId: docId,
      enquiryName: enquiryName(doc, docId),
    }
  },

  extractTitle(doc: EnquiryDocument, docId: string): string {
    const status = clean(doc.status)
    const label = enquiryName(doc, docId)
    if (status === 'reviewing') return `Enquiry under review: ${label}`
    if (status === 'active') return `Active enquiry: ${label}`
    return `New enquiry from ${label}`
  },

  extractSummary(doc: EnquiryDocument, docId: string): string {
    const parts: string[] = []
    const label = enquiryName(doc, docId)
    const type = clean(doc.projectType)
    parts.push(type ? `${type} enquiry from ${label}` : `Enquiry from ${label}`)
    const company = clean(doc.company)
    const email = clean(doc.email)
    if (company) parts.push(`Company: ${company}`)
    if (email) parts.push(`Email: ${email}`)
    const detail = extractMultiFieldExcerpt(doc, ['details'], { maxLength: 160 })
    if (detail) parts.push(detail)
    return parts.join('. ')
  },

  extractExcerpt(doc: EnquiryDocument, docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['details', 'company', 'email', 'projectType'], { maxLength })
      ?? this.extractSummary(doc, docId)
  },

  extractOccurredAt(doc: EnquiryDocument): Date | null {
    return normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.updatedAt)
  },

  extractMetadata(doc: EnquiryDocument): Record<string, unknown> | null {
    return {
      enquiryStatus: clean(doc.status),
      email: clean(doc.email),
      company: clean(doc.company),
      projectType: clean(doc.projectType),
      assignedTo: clean(doc.assignedTo),
      userId: clean(doc.userId),
    }
  },

  toItem(doc: EnquiryDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: PIB_PLATFORM_ORG_ID,
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
