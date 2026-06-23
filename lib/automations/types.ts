// lib/automations/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type TriggerEvent =
  | 'deal.created'
  | 'deal.stage_changed'
  | 'deal.won'
  | 'deal.lost'
  | 'contact.created'
  | 'contact.lifecycle_changed'

export interface AutomationTrigger {
  event: TriggerEvent
  toStageId?: string    // filter: only fire when moving TO this stageId (deal.stage_changed)
  pipelineId?: string   // filter: only fire for this pipeline
}

export type ActionType =
  | 'send_email'
  | 'send_notification'
  | 'assign_owner'
  | 'dispatch_webhook'
  | 'enroll_in_sequence'
  | 'add_tag'
  | 'assign_to_segment'

export interface AutomationAction {
  type: ActionType
  // Per-step wait: minutes to pause BEFORE this action runs. The processor
  // executes everything up to a delayed step, then re-queues the remaining
  // steps with scheduledAt = now + delayMinutes. 0 / absent = no wait.
  delayMinutes?: number
  // send_email
  emailSubject?: string
  emailBody?: string
  emailTo?: 'contact' | 'owner' | string  // 'contact', 'owner', or literal email
  // send_notification
  notificationMessage?: string
  notificationTo?: 'owner' | 'all_admins'
  // assign_owner
  ownerUid?: string
  ownerDisplayName?: string
  // dispatch_webhook
  webhookUrl?: string
  // enroll_in_sequence
  sequenceId?: string
  sequenceName?: string   // display only
  // add_tag
  tag?: string
  // assign_to_segment — writes the segment's membership tag to the contact so
  // dynamic (tag-based) segments resolve the contact in. segmentName is display
  // only.
  segmentId?: string
  segmentName?: string
}

export interface AutomationRule {
  id: string
  orgId: string
  name: string
  description?: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
  conditions?: Record<string, unknown>
  delayMinutes?: number    // 0 or absent = immediate
  deleted?: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
}

export type AutomationRuleInput = Omit<AutomationRule, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>

export interface PendingAutomation {
  id: string
  orgId: string
  ruleId: string
  triggerEvent: TriggerEvent
  actions: AutomationAction[]
  contextDealId?: string
  contextContactId?: string
  contextContactEmail?: string
  contextOwnerEmail?: string
  scheduledAt: Timestamp
  status: 'pending' | 'executed' | 'failed'
  executedAt?: Timestamp | null
  error?: string
  createdAt: Timestamp | null
}

export interface TriggerContext {
  orgId: string
  dealId?: string
  contactId?: string
  contactEmail?: string
  ownerEmail?: string
  toStageId?: string    // for stage_changed events
  pipelineId?: string   // for stage_changed events
}
