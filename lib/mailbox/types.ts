import type { EncryptedCredentials } from '@/lib/integrations/crypto'

export type MailboxAccountProvider = 'smtp_imap' | 'google'
export type MailboxAccountStatus = 'connected' | 'needs_setup' | 'error'
export type MailboxFolder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash'

export interface MailboxAccountSafe {
  id: string
  orgId: string
  uid: string
  profileId: string
  provider: MailboxAccountProvider
  emailAddress: string
  displayName: string
  status: MailboxAccountStatus
  isDefault: boolean
  hasSmtp: boolean
  hasImap: boolean
  hasGoogleOAuth: boolean
  lastSyncAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface MailboxAccountStored extends Omit<MailboxAccountSafe, 'id' | 'hasSmtp' | 'hasImap' | 'hasGoogleOAuth' | 'lastSyncAt' | 'createdAt' | 'updatedAt'> {
  smtpEnc?: EncryptedCredentials
  imapEnc?: EncryptedCredentials
  googleEnc?: EncryptedCredentials
  lastSyncAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export interface MailboxMessageSafe {
  id: string
  orgId: string
  uid: string
  profileId: string
  accountId: string
  accountEmail: string
  folder: MailboxFolder
  direction: 'inbound' | 'outbound' | 'draft'
  status: 'received' | 'sent' | 'draft' | 'queued' | 'failed'
  read: boolean
  starred: boolean
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  attachments: Array<{
    name: string
    contentType: string
    sizeBytes: number
  }>
  snippet: string
  providerMessageId?: string | null
  threadId?: string | null
  createdAt: string | null
  updatedAt: string | null
  sentAt?: string | null
  receivedAt?: string | null
}

export const MAILBOX_FOLDERS: MailboxFolder[] = ['inbox', 'sent', 'drafts', 'archive', 'trash']
