// lib/crm/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

// ── Attribution ──────────────────────────────────────────────────────────────

/**
 * Embedded identity snapshot fields written on every CRM write.
 * Routes spread these into records via `snapshotForWrite()` (see PR 2+).
 * NB: `createdBy` is required on Activity, so Activity cannot directly extend this.
 */
export interface Attribution {
  createdAt: Timestamp | null
  createdBy?: string
  createdByRef?: MemberRef
  updatedAt: Timestamp | null
  updatedBy?: string
  updatedByRef?: MemberRef
}

// ── Contacts ────────────────────────────────────────────────────────────────

export type ContactSource = 'manual' | 'form' | 'import' | 'outreach'
export type ContactType = 'lead' | 'prospect' | 'client' | 'churned'
export type ContactAgreementRole =
  | 'primary_contact'
  | 'accounts_contact'
  | 'authorized_signatory'
  | 'approval_contact'
export type ContactStage =
  | 'new'
  | 'contacted'
  | 'replied'
  | 'demo'
  | 'proposal'
  | 'won'
  | 'lost'

export interface Contact {
  id: string
  orgId: string            // required after Phase 1 backfill
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  assignedToRef?: MemberRef
  convertedToOrgId?: string | null
  capturedFromId: string   // "" if not captured via a CaptureSource
  name: string
  email: string
  phone: string
  jobTitle?: string
  department?: string
  agreementRoles?: ContactAgreementRole[]
  company: string
  website: string
  source: ContactSource
  type: ContactType
  stage: ContactStage
  tags: string[]
  notes: string
  assignedTo: string
  subscribedAt: Timestamp | null
  unsubscribedAt: Timestamp | null
  bouncedAt: Timestamp | null
  // Per-contact IANA timezone override. Falls back to org timezone when unset.
  // Used by send-time optimisation (lib/email/send-time.ts).
  timezone?: string
  // Reply-tracking stats — populated by the inbound webhook pipeline.
  lastRepliedAt?: Timestamp | null
  repliesCount?: number
  // SMS-channel fields — populated by the SMS pipeline (Twilio inbound webhook,
  // contact-edit form, capture flows). All optional so existing email-only
  // contacts continue to work without a backfill.
  phoneVerified?: boolean
  smsOptedIn?: boolean
  smsUnsubscribedAt?: Timestamp | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  lastContactedAt: Timestamp | null
  deleted?: boolean
  companyId?: string
  companyName?: string
  linkedUserId?: string       // PiB user linked through a sender-owned CRM contact
  linkedOrgId?: string        // PiB client org this contact belongs to when mirrored into platform CRM
  clientMemberActive?: boolean
  // A4 scoring fields (additive — never required)
  leadScore?: number          // 0-100, formula-based engagement
  icpScore?: number           // 0-100, ICP-match (company attrs vs ICP profile)
  aiLeadScore?: number        // 0-100, LLM-based (only set if scoringConfig.aiEnabled)
  scoreUpdatedAt?: Timestamp  // last computed
  scoreSignals?: Record<string, number>  // per-signal contribution (debug)
}

export type ContactInput = Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>

// ── Deals ────────────────────────────────────────────────────────────────────

// NOTE: DealStage type removed in A3 W2-F. Deals now use pipelineId + stageId
// referencing a Pipeline document's stages array. See lib/pipelines/types.ts.

export type Currency = 'USD' | 'EUR' | 'ZAR'

export interface DealLineItem {
  productId?: string    // soft reference; absent for ad-hoc items
  name: string
  qty: number
  unitPrice: number
  discount?: number     // percentage 0–100
  total: number
  currency: Currency
}

export interface DealStageHistoryEntry {
  pipelineId: string
  stageId: string
  enteredAt: Timestamp | null
  enteredByRef?: MemberRef
}

export interface Deal {
  id: string
  orgId: string
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  ownerUid?: string
  ownerRef?: MemberRef
  contactId: string
  title: string
  value: number
  currency: Currency
  /** Pipeline this deal belongs to. Required. */
  pipelineId: string
  /** Stage within the pipeline. Required. */
  stageId: string
  expectedCloseDate: Timestamp | null
  notes: string
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
  probability?: number      // 0–100; auto-set from stage.probability, overridable
  lostReason?: string       // freetext; surfaced on "lost" stages
  lineItems?: DealLineItem[]
  stageHistory?: DealStageHistoryEntry[]
  companyId?: string
  companyName?: string
}

export type DealInput = Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>

// ── Activities ───────────────────────────────────────────────────────────────

export type ActivityType =
  | 'email_sent'
  | 'email_received'
  | 'email_replied'
  | 'email_auto_reply'
  | 'email_bounce_reply'
  | 'email_unsubscribe_reply'
  | 'email_inbound_unknown'
  | 'call'
  | 'note'
  | 'stage_change'
  | 'sequence_enrolled'
  | 'sequence_completed'

export interface Activity {
  id: string
  orgId: string
  contactId: string
  dealId: string
  type: ActivityType
  summary: string
  metadata: Record<string, unknown>
  createdAt: Timestamp | null
  createdBy: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  companyId?: string
}

export type ActivityInput = Omit<Activity, 'id' | 'createdAt'>

// ── API list params ──────────────────────────────────────────────────────────

export interface ContactListParams {
  orgId?: string
  stage?: ContactStage
  type?: ContactType
  source?: ContactSource
  search?: string
  limit?: number
  page?: number
}

export interface DealListParams {
  orgId?: string
  pipelineId?: string
  stageId?: string
  contactId?: string
  limit?: number
  page?: number
}
