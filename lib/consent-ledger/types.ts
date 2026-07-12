import type { Timestamp } from 'firebase-admin/firestore'

export type ConsentChannel = 'email' | 'sms'
export type ConsentState = 'pending' | 'granted' | 'confirmed' | 'revoked' | 'suppressed'
export type ConsentLegalBasis =
  | 'consent'
  | 'legitimate-interest'
  | 'contract'
  | 'legal-obligation'
  | 'not-applicable'

export type ConsentSource =
  | 'capture'
  | 'double-opt-in-request'
  | 'double-opt-in-confirmation'
  | 'preferences-page'
  | 'one-click-unsubscribe'
  | 'provider-complaint'
  | 'admin'
  | 'migration'
  | 'api'

export interface ContactConsentEventInput {
  orgId: string
  contactId: string
  channel: ConsentChannel
  topicId: string
  state: ConsentState
  legalBasis: ConsentLegalBasis
  source: ConsentSource
  sourceEventId?: string
  sourceId?: string
  captureVersion?: string
  formCopyVersion?: string
  locale?: string
  jurisdiction?: string
  occurredAt: string
  ipHash?: string
  userAgentHash?: string
  doubleOptIn?: 'requested' | 'confirmed' | 'not-applicable'
  policyVersion?: string
  proofRef?: string
  metadata?: Record<string, unknown>
}

export interface ContactConsentEventRecord extends ContactConsentEventInput {
  id: string
  deduplicationKey: string
  schemaVersion: 1
  immutable: true
  receivedAt: Timestamp | string
}
