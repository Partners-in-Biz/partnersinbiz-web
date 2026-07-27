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

function looksLikeOpaqueSubmittedId(value: string | null): boolean {
  if (!value || /\s/.test(value)) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return true
  if (value.length < 16 || !/^[A-Za-z0-9_-]+$/.test(value)) return false
  const uppercase = (value.match(/[A-Z]/g) ?? []).length
  const lowercase = (value.match(/[a-z]/g) ?? []).length
  return uppercase >= 6 && lowercase >= 6
}

function cleanHumanValue(value: unknown): string | null {
  const text = clean(value)
  return text && !looksLikeOpaqueSubmittedId(text) ? text : null
}

function scrubOpaqueSubmittedIds(value: unknown): string | null {
  const text = clean(value)
  if (!text) return null
  return text
    .replace(/[A-Za-z0-9_-]{16,}/g, (token) => looksLikeOpaqueSubmittedId(token) ? '[unavailable]' : token)
    .replace(/\s+/g, ' ')
    .trim()
}

function enquiryName(doc: EnquiryDocument, docId: string): string {
  void docId
  return cleanHumanValue(doc.name) ?? clean(doc.email) ?? 'Unknown enquirer'
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
    const company = cleanHumanValue(doc.company)
    const email = clean(doc.email)
    if (company) parts.push(`Company: ${company}`)
    if (email) parts.push(`Email: ${email}`)
    const detail = extractMultiFieldExcerpt({ ...doc, details: scrubOpaqueSubmittedIds(doc.details) }, ['details'], { maxLength: 160 })
    if (detail) parts.push(detail)
    return parts.join('. ')
  },

  extractExcerpt(doc: EnquiryDocument, docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt({
      ...doc,
      details: scrubOpaqueSubmittedIds(doc.details),
      company: cleanHumanValue(doc.company),
    }, ['details', 'company', 'email', 'projectType'], { maxLength })
      ?? this.extractSummary(doc, docId)
  },

  extractOccurredAt(doc: EnquiryDocument): Date | null {
    return normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.updatedAt)
  },

  extractMetadata(doc: EnquiryDocument): Record<string, unknown> | null {
    return {
      enquiryStatus: clean(doc.status),
      email: clean(doc.email),
      company: cleanHumanValue(doc.company),
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
