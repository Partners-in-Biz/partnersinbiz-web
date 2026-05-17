import { Timestamp } from 'firebase-admin/firestore'
import type { MailboxAccountSafe, MailboxFolder, MailboxMessageSafe } from './types'

export function toIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value === 'object' && value !== null && '_seconds' in (value as Record<string, unknown>)) {
    const seconds = (value as { _seconds?: number })._seconds ?? 0
    return new Date(seconds * 1000).toISOString()
  }
  return null
}

export function splitEmails(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean)
  }
  if (typeof value !== 'string') return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isMailboxFolder(value: unknown): value is MailboxFolder {
  return value === 'inbox' || value === 'sent' || value === 'drafts' || value === 'archive' || value === 'trash'
}

export function serializeAccount(id: string, data: Record<string, unknown>): MailboxAccountSafe {
  return {
    id,
    orgId: String(data.orgId ?? ''),
    uid: String(data.uid ?? ''),
    profileId: String(data.profileId ?? ''),
    provider: data.provider === 'google' ? 'google' : 'smtp_imap',
    emailAddress: String(data.emailAddress ?? ''),
    displayName: String(data.displayName ?? ''),
    status: data.status === 'connected' || data.status === 'error' ? data.status : 'needs_setup',
    isDefault: data.isDefault === true,
    hasSmtp: Boolean(data.smtpEnc),
    hasImap: Boolean(data.imapEnc),
    hasGoogleOAuth: Boolean(data.googleEnc),
    lastSyncAt: toIso(data.lastSyncAt),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

export function serializeMessage(id: string, data: Record<string, unknown>): MailboxMessageSafe {
  const bodyText = String(data.bodyText ?? '')
  return {
    id,
    orgId: String(data.orgId ?? ''),
    uid: String(data.uid ?? ''),
    profileId: String(data.profileId ?? ''),
    accountId: String(data.accountId ?? ''),
    accountEmail: String(data.accountEmail ?? ''),
    folder: isMailboxFolder(data.folder) ? data.folder : 'inbox',
    direction: data.direction === 'outbound' || data.direction === 'draft' ? data.direction : 'inbound',
    status:
      data.status === 'sent' || data.status === 'draft' || data.status === 'queued' || data.status === 'failed'
        ? data.status
        : 'received',
    read: data.read !== false,
    starred: data.starred === true,
    from: String(data.from ?? ''),
    to: splitEmails(data.to),
    cc: splitEmails(data.cc),
    bcc: splitEmails(data.bcc),
    subject: String(data.subject ?? ''),
    bodyText,
    bodyHtml: typeof data.bodyHtml === 'string' ? data.bodyHtml : undefined,
    snippet: String(data.snippet ?? bodyText.replace(/\s+/g, ' ').slice(0, 180)),
    providerMessageId: typeof data.providerMessageId === 'string' ? data.providerMessageId : null,
    threadId: typeof data.threadId === 'string' ? data.threadId : null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    sentAt: toIso(data.sentAt),
    receivedAt: toIso(data.receivedAt),
  }
}
