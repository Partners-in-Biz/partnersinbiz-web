/** Phase-2 cross-org payment notify + recipient confirm (observe-only). */

export type CrossOrgPaymentNoticeStatus = 'notified' | 'confirmed' | 'disputed' | 'dismissed'

/**
 * How the money movement appears to the recipient org.
 * inbound_to_recipient = source paid recipient (recipient should see a receipt)
 * outbound_from_recipient = recipient paid source (recipient should see a disbursement)
 */
export type CrossOrgPaymentPerspective = 'inbound_to_recipient' | 'outbound_from_recipient'

export interface CrossOrgPaymentNotice {
  id: string
  sourceOrgId: string
  recipientOrgId: string
  /** CRM company on the source org that links to recipientOrgId via linkedOrgId. */
  sourceCompanyId?: string
  relationshipId?: string
  sourcePaymentId: string
  sourceLegalEntityId?: string
  sourceBookId?: string
  perspective: CrossOrgPaymentPerspective
  amountMinor: number
  currency: string
  description: string
  observedDate: string
  method?: 'eft' | 'cash' | 'card' | 'other'
  externalReference?: string
  status: CrossOrgPaymentNoticeStatus
  notifiedBy: string
  notifiedAt: string
  resolvedAt?: string
  resolvedBy?: string
  resolutionNote?: string
  /** Optional local payment id created on recipient confirm (record-only). */
  recipientPaymentId?: string
  schemaVersion: 1
  version: number
  /** Hard gate: never true — money movement is observed only. */
  externalPaymentInitiated: false
}

export type CrossOrgFinanceAction =
  | 'cross_org.payment.notify'
  | 'cross_org.payment.confirm'
  | 'cross_org.payment.dispute'
  | 'cross_org.payment.dismiss'
  | 'cross_org.payment.read'

/** Lookup result used to prove a lawful cross-org link before notify. */
export interface CrossOrgLinkEvidence {
  recipientOrgId: string
  sourceCompanyId?: string
  relationshipId?: string
  reason: 'linkedOrgId' | 'businessRelationship'
}
