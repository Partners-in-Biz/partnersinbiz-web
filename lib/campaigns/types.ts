// lib/campaigns/types.ts
//
// Campaigns are the top-level container for an email program targeted at a
// segment of an org's contacts. A campaign owns:
//   - the audience (segment OR explicit contact list)
//   - the sender (which verified domain + display name)
//   - the content (a sequence of steps)
//   - optional auto-enrollment triggers (capture sources / tags)
//   - aggregate stats updated by webhooks
//
// At "launch" time, the campaign turns into a series of SequenceEnrollment
// docs in the existing `sequence_enrollments` collection. The cron then
// runs the steps as it does today.

import type { Timestamp } from 'firebase-admin/firestore'
import type { EmailDocument } from '@/lib/email-builder/types'

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed'

export interface CampaignStats {
  enrolled: number       // total contacts enrolled
  sent: number           // emails actually sent (sum of all steps)
  delivered: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
}

export const EMPTY_STATS: CampaignStats = {
  enrolled: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  unsubscribed: 0,
}

export interface CampaignTriggers {
  // Captures from these sources auto-enroll into this campaign
  captureSourceIds: string[]
  // OR contacts that gain any of these tags (Phase 2 hook)
  tags: string[]
}

export interface Campaign {
  id: string
  orgId: string
  /** Present on new writes; absent means this is a legacy record requiring an adapter. */
  recordType?: 'email_campaign' | 'email_program'
  schemaVersion?: number
  name: string
  description: string
  status: CampaignStatus

  // Email-builder fields already persisted by the campaign routes.
  subject?: string
  previewText?: string
  preheader?: string
  emailDocument?: EmailDocument | null
  tagId?: string
  tagIds?: string[]
  exclusionContactIds?: string[]
  excludeTagIds?: string[]

  // Sender
  senderPolicyId?: string
  replyPolicyId?: string
  fromDomainId: string   // "" = use shared PIB domain fallback
  fromName: string       // display name; "" = use orgName at send time
  fromLocal: string      // local part (e.g. "campaigns" or "noreply")
  replyTo: string        // optional

  // Audience — exactly one should be set; segmentId takes precedence
  segmentId: string      // "" if not segment-targeted
  contactIds: string[]   // explicit list (for one-off campaigns); empty if segment-driven

  // Content
  sequenceId: string     // links to an existing Sequence in this org

  // Auto-enrollment triggers (used by capture endpoints in Phase 2)
  triggers: CampaignTriggers

  // Schedule
  startAt: Timestamp | null
  endAt: Timestamp | null

  // Aggregated metrics — bumped by send + webhook handlers
  stats: CampaignStats

  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdBy: string
  accountScope?: 'org' | 'personal'
  ownerUid?: string | null
  createdByType?: 'user' | 'agent' | 'system'
  approvalState?: {
    status: 'not_required' | 'pending' | 'approved' | 'rejected' | 'revoked'
    approvedBy?: string | null
    approvedByType?: 'user' | 'agent' | 'system' | null
    approvedAt?: Timestamp | null
    approvalTaskId?: string | null
    approvedSnapshotHash?: string | null
  }
  deleted?: boolean
}

export type CampaignInput = Omit<Campaign, 'id' | 'stats' | 'createdAt' | 'updatedAt' | 'createdBy'>
