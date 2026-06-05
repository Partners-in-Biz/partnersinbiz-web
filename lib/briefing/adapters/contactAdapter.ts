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
  source?: string | null
  notes?: string | null
  assignedTo?: string | null
  leadScore?: number | null
  icpScore?: number | null
  aiLeadScore?: number | null
  scoreUpdatedAt?: unknown
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

type ContactRevenueSignal = 'hot-prospect' | 'proposal-follow-up' | 'import-suggestion' | 'no-touch-warning' | 'stale-contact'

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bestScore(doc: ContactDocument): number {
  return Math.max(score(doc.leadScore) ?? 0, score(doc.icpScore) ?? 0, score(doc.aiLeadScore) ?? 0)
}

function revenueSignal(doc: ContactDocument): ContactRevenueSignal {
  const stage = clean(doc.stage)?.toLowerCase() ?? ''
  const source = clean(doc.source)?.toLowerCase() ?? ''
  const lastContactedDays = daysSince(doc.lastContactedAt)
  if (bestScore(doc) >= 80 && ['prospect', 'lead'].includes(clean(doc.type)?.toLowerCase() ?? '')) return 'hot-prospect'
  if (stage === 'proposal' || stage.includes('proposal')) return 'proposal-follow-up'
  if (source === 'import' && (stage === 'new' || !stage) && lastContactedDays === null) return 'import-suggestion'
  if (lastContactedDays === null) return 'no-touch-warning'
  return 'stale-contact'
}

function nextAction(signal: ContactRevenueSignal): string {
  switch (signal) {
    case 'hot-prospect':
      return 'Book or confirm the next sales step while the prospect is warm; keep outbound sends approval-gated.'
    case 'proposal-follow-up':
      return 'Review proposal status and prepare the next internal follow-up task before any external send.'
    case 'import-suggestion':
      return 'Qualify the imported lead, check duplicates/suppression, and decide whether it belongs in an approved segment.'
    case 'no-touch-warning':
      return 'Assign an internal owner to inspect source and qualification before any outreach.'
    default:
      return 'Create a safe internal follow-up task or update the next action; do not send externally without approval.'
  }
}

export const contactAdapter: BriefingSourceAdapter<ContactDocument> = {
  sourceType: 'contact',
  collectionPath: 'contacts',

  hashSource(doc: ContactDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'email', 'stage', 'type', 'source', 'leadScore', 'icpScore', 'aiLeadScore', 'lastContactedAt', 'lastRepliedAt', 'updatedAt'])
  },

  shouldGenerate(doc: ContactDocument): boolean {
    if (doc.deleted === true) return false
    if (!clean(doc.orgId)) return false
    if (clean(doc.type) === 'churned' || clean(doc.stage) === 'lost') return false

    const signal = revenueSignal(doc)
    if (signal === 'hot-prospect' || signal === 'proposal-follow-up' || signal === 'import-suggestion' || signal === 'no-touch-warning') return true
    const lastContactedDays = daysSince(doc.lastContactedAt)
    return lastContactedDays !== null && lastContactedDays >= 30
  },

  extractPriority(doc: ContactDocument): BriefingPriority {
    const signal = revenueSignal(doc)
    if (signal === 'no-touch-warning') return 'client-risk'
    const days = daysSince(doc.lastContactedAt)
    if (signal === 'stale-contact' && days !== null && days >= 90) return 'client-risk'
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
    const name = contactName(doc, docId)
    const signal = revenueSignal(doc)
    if (signal === 'hot-prospect') return `Hot prospect: ${name}`
    if (signal === 'proposal-follow-up') return `Proposal follow-up: ${name}`
    if (signal === 'import-suggestion') return `Import follow-up: ${name}`
    if (signal === 'no-touch-warning') return `No-touch warning: ${name}`
    return `Follow up ${name}`
  },

  extractSummary(doc: ContactDocument, docId: string): string {
    const name = contactName(doc, docId)
    const lastContacted = dateLabel(doc.lastContactedAt)
    const signal = revenueSignal(doc)
    const parts: string[] = []
    if (signal === 'hot-prospect') parts.push(`${name} is a high-fit/high-score prospect`)
    else if (signal === 'proposal-follow-up') parts.push(lastContacted ? `Proposal-stage prospect has not been touched since ${lastContacted}` : `Proposal-stage prospect has no recorded contact touchpoint`)
    else if (signal === 'import-suggestion') parts.push(`Imported lead needs qualification before any outreach`)
    else parts.push(lastContacted ? `${name} has not been contacted since ${lastContacted}` : `${name} has no recorded contact touchpoint`)
    const stage = clean(doc.stage)
    if (stage) parts.push(`Stage: ${stage}`)
    const type = clean(doc.type)
    if (type) parts.push(`Type: ${type}`)
    const company = companyLabel(doc)
    if (company) parts.push(`Company: ${company}`)
    const leadScore = score(doc.leadScore)
    if (leadScore !== null) parts.push(`Lead score: ${leadScore}`)
    parts.push(`Next action: ${nextAction(signal)}`)
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
      revenueSignal: revenueSignal(doc),
      nextAction: nextAction(revenueSignal(doc)),
      contactStage: clean(doc.stage),
      contactType: clean(doc.type),
      source: clean(doc.source),
      lastContactedAt: isoDate(doc.lastContactedAt),
      lastRepliedAt: isoDate(doc.lastRepliedAt),
      company: companyLabel(doc),
      email: clean(doc.email),
      assignedTo: clean(doc.assignedTo),
      leadScore: score(doc.leadScore),
      icpScore: score(doc.icpScore),
      aiLeadScore: score(doc.aiLeadScore),
      scoreUpdatedAt: isoDate(doc.scoreUpdatedAt),
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
