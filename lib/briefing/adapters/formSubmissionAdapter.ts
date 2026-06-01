/**
 * Source adapter for public form submissions.
 *
 * Brings inbound website/contact form leads into Briefings so admins can
 * review, mark read, or archive each submission from the control desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface FormSubmissionDocument extends Record<string, unknown> {
  orgId?: string | null
  formId?: string | null
  data?: Record<string, unknown> | null
  submittedAt?: unknown
  status?: 'new' | 'read' | 'archived' | string | null
  contactId?: string | null
  source?: string | null
  createdBy?: string | null
  createdByRef?: {
    uid?: string | null
    displayName?: string | null
    name?: string | null
    email?: string | null
    role?: 'admin' | 'client' | 'ai' | 'system' | string | null
  } | null
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function lowerData(doc: FormSubmissionDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc.data ?? {})) {
    out[key.toLowerCase()] = value
  }
  return out
}

function firstDataString(doc: FormSubmissionDocument, keys: string[]): string | null {
  const data = lowerData(doc)
  for (const key of keys) {
    const value = clean(data[key])
    if (value) return value
  }
  return null
}

function submitterName(doc: FormSubmissionDocument): string | null {
  return firstDataString(doc, ['name', 'full_name', 'fullname', 'first_name'])
    ?? clean(doc.createdByRef?.displayName)
    ?? clean(doc.createdByRef?.name)
}

function submitterEmail(doc: FormSubmissionDocument): string | null {
  return firstDataString(doc, ['email', 'email_address', 'mail'])
    ?? clean(doc.createdByRef?.email)
}

function formOrgId(doc: FormSubmissionDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function sourceLabel(doc: FormSubmissionDocument): string {
  return clean(doc.source) ?? clean(doc.formId) ?? 'form'
}

function dataSummary(doc: FormSubmissionDocument): string | null {
  const data = doc.data ?? {}
  const values = Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('. ')
  return values || null
}

function actorRole(role: unknown): 'admin' | 'client' | 'ai' | 'system' {
  if (role === 'admin' || role === 'client' || role === 'ai' || role === 'system') return role
  return 'client'
}

export const formSubmissionAdapter: BriefingSourceAdapter<FormSubmissionDocument> = {
  sourceType: 'form-submission',
  collectionPath: 'form_submissions',

  hashSource(doc: FormSubmissionDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['formId', 'status', 'data', 'submittedAt', 'updatedAt'])
  },

  shouldGenerate(doc: FormSubmissionDocument): boolean {
    return doc.status === 'new' && Boolean(clean(doc.formId))
  },

  extractPriority(): BriefingPriority {
    return 'needs-peet'
  },

  extractActor(doc: FormSubmissionDocument) {
    const uid = clean(doc.createdByRef?.uid) ?? clean(doc.createdBy) ?? 'public-form'
    const role = actorRole(doc.createdByRef?.role)
    return {
      id: uid,
      name: clean(doc.createdByRef?.displayName) ?? clean(doc.createdByRef?.name) ?? submitterName(doc) ?? 'Website visitor',
      role,
      type: role === 'system' ? 'system' as const : 'user' as const,
    }
  },

  extractContext(doc: FormSubmissionDocument, docId: string) {
    return {
      orgId: formOrgId(doc),
      formId: clean(doc.formId),
      formSubmissionId: docId,
      contactId: clean(doc.contactId),
      contactName: submitterName(doc),
    }
  },

  extractTitle(doc: FormSubmissionDocument): string {
    const name = submitterName(doc)
    return name ? `New form submission from ${name}` : `New form submission from ${sourceLabel(doc)}`
  },

  extractSummary(doc: FormSubmissionDocument): string {
    const parts: string[] = []
    const name = submitterName(doc)
    const email = submitterEmail(doc)
    if (name) parts.push(`${name} submitted ${sourceLabel(doc)}`)
    else parts.push(`New submission from ${sourceLabel(doc)}`)
    if (email) parts.push(`Email: ${email}`)
    const detail = dataSummary(doc)
    if (detail) {
      const safe = extractMultiFieldExcerpt({ detail }, ['detail'], { maxLength: 160 })
      if (safe) parts.push(safe)
    }
    return parts.join('. ')
  },

  extractExcerpt(doc: FormSubmissionDocument, docId: string, maxLength = 300): string | null {
    const detail = dataSummary(doc) ?? this.extractSummary(doc, docId)
    return extractMultiFieldExcerpt({ detail }, ['detail'], { maxLength })
  },

  extractOccurredAt(doc: FormSubmissionDocument): Date | null {
    return normalizeTimestamp(doc.submittedAt) ?? normalizeTimestamp(doc.updatedAt)
  },

  extractMetadata(doc: FormSubmissionDocument): Record<string, unknown> | null {
    return {
      formSubmissionStatus: clean(doc.status),
      formId: clean(doc.formId),
      source: clean(doc.source),
      contactId: clean(doc.contactId),
      email: submitterEmail(doc),
      submittedAt: normalizeTimestamp(doc.submittedAt)?.toISOString() ?? null,
    }
  },

  toItem(doc: FormSubmissionDocument, docId: string) {
    const orgId = formOrgId(doc)
    const formId = clean(doc.formId) ?? ''
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/admin/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(docId)}`,
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
