/**
 * Source adapter for user mailbox messages.
 *
 * Pulls unread inbound email into Briefings so a user can mark it read,
 * archive it, or draft a reply from the control desk.
 */

import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface MailboxMessageDocument extends Record<string, unknown> {
  orgId?: string | null
  uid?: string | null
  accountId?: string | null
  accountEmail?: string | null
  folder?: 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | string | null
  direction?: 'inbound' | 'outbound' | 'draft' | string | null
  status?: 'received' | 'sent' | 'draft' | 'queued' | 'failed' | string | null
  read?: boolean | null
  starred?: boolean | null
  from?: string | null
  to?: string[] | string | null
  subject?: string | null
  bodyText?: string | null
  snippet?: string | null
  providerMessageId?: string | null
  threadId?: string | null
  receivedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function mailboxOrgId(doc: MailboxMessageDocument): string {
  return clean(doc.orgId) ?? extractOrgId(doc) ?? ''
}

function parseMailboxAddress(value: unknown): { name: string | null; email: string | null; label: string } {
  const raw = clean(value) ?? ''
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/)
  if (match) {
    const name = clean(match[1]?.replace(/^"|"$/g, ''))
    const email = clean(match[2])?.toLowerCase() ?? null
    return { name, email, label: name ?? email ?? 'Email sender' }
  }
  const emailOnly = raw.includes('@') ? raw.toLowerCase() : null
  return { name: emailOnly ? null : clean(raw), email: emailOnly, label: clean(raw) ?? 'Email sender' }
}

function subjectLabel(doc: MailboxMessageDocument): string {
  return clean(doc.subject) ?? '(no subject)'
}

export const mailboxMessageAdapter: BriefingSourceAdapter<MailboxMessageDocument> = {
  sourceType: 'mailbox-message',
  collectionPath: 'mailbox_messages',

  hashSource(doc: MailboxMessageDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['folder', 'direction', 'status', 'read', 'starred', 'from', 'to', 'subject', 'snippet', 'bodyText', 'threadId', 'updatedAt', 'receivedAt'])
  },

  shouldGenerate(doc: MailboxMessageDocument): boolean {
    return doc.folder === 'inbox' && doc.direction === 'inbound' && doc.status !== 'draft' && doc.read === false
  },

  extractPriority(doc: MailboxMessageDocument): BriefingPriority {
    if (doc.starred === true) return 'needs-peet'
    return 'review'
  },

  extractActor(doc: MailboxMessageDocument) {
    const sender = parseMailboxAddress(doc.from)
    return {
      id: `email:${sender.email ?? sender.label}`,
      name: sender.label,
      role: 'client' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: MailboxMessageDocument, docId: string) {
    const sender = parseMailboxAddress(doc.from)
    return {
      orgId: mailboxOrgId(doc),
      mailboxMessageId: docId,
      mailboxFrom: sender.label,
      mailboxSubject: subjectLabel(doc),
    }
  },

  extractTitle(doc: MailboxMessageDocument): string {
    return `Unread email from ${parseMailboxAddress(doc.from).label}`
  },

  extractSummary(doc: MailboxMessageDocument): string {
    const excerpt = extractMultiFieldExcerpt({ snippet: doc.snippet, bodyText: doc.bodyText }, ['bodyText', 'snippet'], { maxLength: 160 })
    return [parseMailboxAddress(doc.from).label, `emailed about ${subjectLabel(doc)}`, excerpt].filter(Boolean).join('. ')
  },

  extractExcerpt(doc: MailboxMessageDocument, _docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt({ snippet: doc.snippet, bodyText: doc.bodyText }, ['bodyText', 'snippet'], { maxLength })
  },

  extractOccurredAt(doc: MailboxMessageDocument): Date | null {
    return normalizeTimestamp(doc.receivedAt) ?? normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt)
  },

  extractMetadata(doc: MailboxMessageDocument): Record<string, unknown> | null {
    const sender = parseMailboxAddress(doc.from)
    return {
      mailboxFolder: clean(doc.folder) ?? 'inbox',
      mailboxStatus: clean(doc.status) ?? 'received',
      mailboxRead: doc.read === true,
      mailboxStarred: doc.starred === true,
      accountId: clean(doc.accountId),
      accountEmail: clean(doc.accountEmail),
      fromEmail: sender.email,
      fromLabel: sender.label,
      subject: subjectLabel(doc),
      providerMessageId: clean(doc.providerMessageId),
      threadId: clean(doc.threadId),
      receivedAt: normalizeTimestamp(doc.receivedAt)?.toISOString() ?? null,
    }
  },

  toItem(doc: MailboxMessageDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: mailboxOrgId(doc),
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: `/portal/email?message=${encodeURIComponent(docId)}`,
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
