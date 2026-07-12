import type { Timestamp } from 'firebase-admin/firestore'

export type EmailProvider = 'resend' | 'ses' | 'manual' | 'system'

export type EmailEventType =
  | 'queued'
  | 'attempted'
  | 'sent'
  | 'delivered'
  | 'deferred'
  | 'failed'
  | 'opened'
  | 'machine_opened'
  | 'clicked'
  | 'replied'
  | 'positive_reply'
  | 'bounced'
  | 'complained'
  | 'unsubscribed'
  | 'converted'

export interface EmailEventInput {
  orgId: string
  messageId: string
  programId?: string
  contactId?: string
  senderIdentityId?: string
  provider: EmailProvider
  providerMessageId: string
  providerEventId?: string
  event: EmailEventType
  providerTimestamp?: string
  receivedAt?: string
  url?: string
  linkId?: string
  userAgent?: string
  privacyClassification?: 'human' | 'machine' | 'privacy-affected' | 'unknown'
  bounceClass?: 'hard' | 'soft' | 'undetermined'
  recipient?: string
  metadata?: Record<string, unknown>
}

export interface EmailEventIdentity {
  id: string
  deduplicationKey: string
  uniqueEventKey: string
}

export interface EmailEventRecord extends Omit<EmailEventInput, 'receivedAt'>, EmailEventIdentity {
  schemaVersion: 1
  immutable: true
  receivedAt: Timestamp | string
}
