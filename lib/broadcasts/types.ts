// lib/broadcasts/types.ts
//
// One-time email blasts ("broadcasts") — a single email sent to a snapshot
// audience (segment OR contactIds OR tags) at a specific time. The PiB
// counterpart to Mailchimp's "regular campaign".
//
// Unlike sequence-backed Campaigns (lib/campaigns/types.ts), a Broadcast has
// no multi-step drip; it is one send to one audience with one piece of
// content (either inline subject/body or a referenced email_templates doc).
//
// At send time a cron picks broadcasts where status === 'scheduled' and
// scheduledFor <= now, walks the resolved audience in chunks, and emits one
// `emails` doc per contact tagged with `broadcastId` so webhooks can roll
// stats back onto the broadcast.

import type { Timestamp } from 'firebase-admin/firestore'
import type { AbConfig } from '@/lib/ab-testing/types'
import { EMPTY_AB } from '@/lib/ab-testing/types'

export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'paused'
  | 'failed'
  | 'canceled'

export interface BroadcastAudience {
  segmentId: string                // "" if not used
  contactIds: string[]             // explicit list
  tags: string[]                   // OR-of-tags
  excludeUnsubscribed: boolean     // default true; always honoured at send time anyway
  excludeBouncedAt: boolean        // default true
}

export interface BroadcastSendStats {
  audienceSize: number
  queued: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
  failed: number
}

export interface BroadcastContent {
  // Either inline content OR a templateId pointing to email_templates.
  // If templateId is set, bodyHtml/bodyText are ignored — the renderer fills
  // them in from the referenced template's document.
  templateId: string               // "" if inline
  subject: string
  preheader: string
  bodyHtml: string                 // ignored when templateId is set
  bodyText: string
}

export interface Broadcast {
  id: string
  orgId: string
  name: string
  description: string
  status: BroadcastStatus

  // Multi-channel support. Defaults to 'email' when omitted. When 'sms', the
  // cron renders `content.bodyText` as the SMS body, ignores subject/HTML/
  // template/from-domain, and dispatches via lib/sms/send.sendSmsToContact().
  channel?: 'email' | 'sms'

  // Sender — resolved through lib/email/resolveFrom.ts (email channel only;
  // SMS uses the org's Twilio messaging service / default number).
  /** Canonical V2 sender policy. Send-time resolution fails closed when configured but unavailable. */
  senderPolicyId?: string
  fromDomainId: string
  fromName: string
  fromLocal: string
  replyTo: string

  content: BroadcastContent
  audience: BroadcastAudience

  // Schedule
  scheduledFor: Timestamp | null
  approvalRequestedSchedule?: string | null
  sendStartedAt: Timestamp | null
  sendCompletedAt: Timestamp | null

  stats: BroadcastSendStats

  // A/B testing configuration (optional — `EMPTY_AB` when not set up).
  ab?: AbConfig

  // Preference topic this broadcast belongs to. Defaults to 'newsletter'.
  // Used by `shouldSendToContact` to honour per-topic opt-outs and by the
  // frequency cap to exempt transactional topics.
  topicId?: string

  // Send-time optimisation: when true, the cron treats `scheduledFor`'s
  // local-clock time (in the org's timezone) as the *target wall time per
  // recipient*. For each contact we only send once their local clock has
  // reached that target. After `localDeliveryWindowHours` we send regardless.
  audienceLocalDelivery?: boolean
  localDeliveryWindowHours?: number   // default 24

  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  approvalState?: {
    status: 'pending' | 'approved' | 'rejected' | 'revoked'
    approvedBy?: string | null
    approvedByType?: 'user' | 'agent' | 'system' | null
    approvedAt?: Timestamp | null
    approvalTaskId?: string | null
    approvedSnapshotHash?: string | null
    invalidatedAt?: Timestamp | null
    invalidatedReason?: string | null
  }
  deleted?: boolean
}

export type BroadcastInput = Omit<
  Broadcast,
  'id' | 'stats' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByType'
>

export const EMPTY_BROADCAST_STATS: BroadcastSendStats = {
  audienceSize: 0,
  queued: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  unsubscribed: 0,
  failed: 0,
}

export const EMPTY_BROADCAST_AUDIENCE: BroadcastAudience = {
  segmentId: '',
  contactIds: [],
  tags: [],
  excludeUnsubscribed: true,
  excludeBouncedAt: true,
}

export const EMPTY_BROADCAST_CONTENT: BroadcastContent = {
  templateId: '',
  subject: '',
  preheader: '',
  bodyHtml: '',
  bodyText: '',
}

export const DEFAULT_BROADCAST_AB: AbConfig = { ...EMPTY_AB }
