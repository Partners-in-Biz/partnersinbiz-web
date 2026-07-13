// lib/sequences/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { AbConfig } from '@/lib/ab-testing/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

// ── Branching / Goal / Wait-Until ───────────────────────────────────────────
//
// All three features are OPTIONAL on existing sequences. Sequences without
// `branch`/`waitUntil`/`goals` fall through to linear progression.

/**
 * Conditions evaluated against an enrollment's send history and the contact
 * itself. Used by branch rules, exit goals, and (a subset of) wait-until
 * conditions.
 */
export type BranchCondition =
  | { kind: 'opened' }
  | { kind: 'not-opened' }
  | { kind: 'clicked' }
  | { kind: 'not-clicked' }
  | { kind: 'clicked-link'; urlSubstring: string }
  | { kind: 'contact-has-tag'; tag: string }
  | { kind: 'contact-at-stage'; stage: string }
  | { kind: 'replied' }
  | { kind: 'days-since-step'; days: number }

export interface SequenceBranchRule {
  condition: BranchCondition
  /** 0-based index into sequence.steps. Use -1 to exit the sequence. */
  nextStepNumber: number
  /** Days to wait after this step sent before checking this rule. Default 1. */
  evaluateAfterDays: number
}

export interface SequenceBranch {
  /** Evaluated in order; first match wins. */
  rules: SequenceBranchRule[]
  /** Fallback when no rule matches. -1 to exit. */
  defaultNextStepNumber: number
}

/**
 * Wait-until conditions — gate progression to a step until the condition
 * becomes true (or maxWaitDays expires).
 */
export type WaitCondition =
  | { kind: 'business-hours'; timezone?: string; startHourLocal: number; endHourLocal: number }
  | { kind: 'day-of-week'; daysOfWeek: number[]; timezone?: string }
  | { kind: 'contact-tag-added'; tag: string }
  | { kind: 'contact-stage-reached'; stage: string }
  | { kind: 'goal-hit'; goalId: string }

export interface WaitUntil {
  condition: WaitCondition
  /** Safety cap. After this many days waiting, fall through per onTimeout. */
  maxWaitDays: number
  onTimeout: 'send' | 'exit'
}

/**
 * Sequence-level exit goals. Evaluated BEFORE every step send. If any goal
 * matches, the enrollment exits immediately.
 */
export interface SequenceGoal {
  id: string
  label: string
  condition: BranchCondition
  exitReason?: string
  /** Whether hitting this goal completes the journey or exits it early. */
  outcome?: 'complete' | 'exit'
}

export interface SequenceQuietHours {
  enabled: boolean
  /** Minute of local day, 0..1439. Overnight windows wrap across midnight. */
  startMinuteLocal: number
  /** Minute of local day, 0..1439. Equal start/end means quiet all day. */
  endMinuteLocal: number
  timezoneMode: 'recipient' | 'organization'
}

export interface SequenceWorkflowSnapshot {
  id: string
  sequenceId: string
  orgId: string
  schemaVersion: 1
  version: number
  contentHash: string
  activatedAtIso: string
  steps: SequenceStep[]
  goals: SequenceGoal[]
  topicId: string
  quietHours?: SequenceQuietHours
  reentryPolicy?: SequenceReentryPolicy
  maxActiveEnrollments?: number
  /** Exact resource shape whose approval evidence was accepted at activation. */
  approvalResource?: Record<string, unknown>
}

export interface SequenceStep {
  stepNumber: number
  delayDays: number
  subject: string
  bodyHtml: string
  bodyText: string
  // Optional A/B testing config for this step. Backwards-compatible — existing
  // steps without `ab` continue to send as a single variant.
  ab?: AbConfig
  // Optional per-step preference topic override. Defaults to the sequence's
  // `topicId` (which defaults to 'newsletter').
  topicId?: string
  // Optional branch evaluation AFTER this step sends. When unset, the cron
  // advances linearly (currentStep + 1).
  branch?: SequenceBranch
  // Optional wait-until gate BEFORE this step sends. When unset, this step
  // sends as soon as `nextSendAt` is reached.
  waitUntil?: WaitUntil
  // Multi-channel support. Defaults to 'email' when omitted (every step that
  // existed before SMS was added is implicitly email). When set to 'sms',
  // the cron sends via lib/sms/send.sendSmsToContact() using `smsBody` and
  // skips the email subject/body/template rendering entirely.
  channel?: 'email' | 'sms'
  // SMS body — used only when channel === 'sms'. Plain text with the same
  // `{{var}}` interpolation as bodyHtml/bodyText.
  smsBody?: string
}

export type SequenceStatus = 'draft' | 'active' | 'paused'

export interface SequenceReentryPolicy {
  /** active_only preserves legacy behaviour; never prevents any second enrollment. */
  mode: 'active_only' | 'never' | 'after_exit' | 'after_days'
  afterDays?: number
}

export interface Sequence {
  id: string
  orgId: string            // required after Phase 1 backfill
  name: string
  description: string
  status: SequenceStatus
  steps: SequenceStep[]
  // Preference topic for every step in this sequence. Defaults to
  // 'newsletter'. The cron passes this to `shouldSendToContact` so
  // contacts opted-out of the topic are skipped automatically.
  topicId?: string
  // Sequence-level exit goals — checked before every step advance.
  goals?: SequenceGoal[]
  // Explicit lifecycle re-entry behavior. Existing sequences default to active_only.
  reentryPolicy?: SequenceReentryPolicy
  // Operational guardrail for simultaneous enrollments in this sequence.
  maxActiveEnrollments?: number
  quietHours?: SequenceQuietHours
  activeWorkflowVersion?: number
  activeWorkflowVersionId?: string
  activeWorkflowSnapshot?: SequenceWorkflowSnapshot
  approvalState?: {
    status: 'pending' | 'approved' | 'rejected' | 'revoked'
    approvedBy?: string | null
    approvedByType?: 'user' | 'agent' | 'system' | null
    approvedAt?: Timestamp | null
    approvalTaskId?: string | null
    approvedSnapshotHash?: string | null
  }
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export type SequenceInput = Omit<Sequence, 'id' | 'createdAt' | 'updatedAt'>

export type EnrollmentStatus = 'active' | 'completed' | 'paused' | 'exited' | 'dead_letter'
export type ExitReason =
  | 'replied'
  | 'unsubscribed'
  | 'manual'
  | 'completed'
  | 'bounced'
  | 'goal-hit'
  | 'branch-exit'
  | 'cycle-detected'
  | 'wait-timeout'
  | 'delivery-failed'
  | 'sender-unavailable'

/**
 * One entry on the path an enrollment has taken through a branching sequence.
 * Appended after each successful send and after each branch evaluation.
 */
export interface EnrollmentPathEntry {
  stepNumber: number
  sentAt?: Timestamp | null
  branchTaken?: {
    matchedRuleIndex: number   // -1 means default
    condition?: BranchCondition
    nextStepNumber: number
  }
  goalHit?: {
    goalId: string
    label: string
    outcome?: 'complete' | 'exit'
  }
  at: Timestamp | null
}

export interface SequenceEnrollment {
  id: string
  orgId: string            // required after Phase 1 backfill
  campaignId: string       // "" if direct sequence enrollment, populated when triggered by a Campaign
  sequenceId: string
  contactId: string
  status: EnrollmentStatus
  currentStep: number        // 0-based index into sequence.steps
  enrolledAt: Timestamp | null
  nextSendAt: Timestamp | null
  exitReason?: ExitReason
  completedAt?: Timestamp | null
  deleted?: boolean
  // Set after a step with `branch` has sent. While set, the cron is waiting
  // to evaluate branch rules at this instant rather than sending.
  pendingBranchEvalAt?: Timestamp | null
  // Set when a step with `waitUntil` is gated. Used to enforce maxWaitDays.
  waitingSince?: Timestamp | null
  // Step-numbers visited (in order) — used to detect cycles in branch graphs.
  visitedSteps?: number[]
  // Full traversal record for the admin UI / debugging.
  path?: EnrollmentPathEntry[]
  // Short lease used by the sequence worker to prevent overlapping cron runs
  // from dispatching the same step more than once.
  processingLeaseToken?: string
  processingLeaseUntil?: Timestamp | null
  deliveryAttempts?: number
  lastDeliveryError?: string
  lastDeliveryAttemptAt?: Timestamp | null
  workflowVersionId?: string
  workflowVersion?: number
  workflowContentHash?: string
  workflowSnapshot?: SequenceWorkflowSnapshot
  completedGoalId?: string
  completedGoalLabel?: string
  goalOutcome?: 'complete' | 'exit'
  deadLetter?: {
    stepNumber: number
    attempts: number
    reason: string
    channel: 'email' | 'sms'
    replayable: boolean
    failedAt: Timestamp | null
  }
  deadLetterHistory?: Array<NonNullable<SequenceEnrollment['deadLetter']> & {
    replayKey: string
    replayedAt: Timestamp | null
    replayedByRef: MemberRef
  }>
  replayKey?: string
  replayedAt?: Timestamp | null
  replayedByRef?: MemberRef
  lastScheduleDecision?: {
    reason: 'quiet-hours'
    timezone: string
    evaluatedAt: Timestamp | null
    nextAllowedAt: Timestamp | null
  }
  pausedReason?: string
  workflowValidationError?: string
  workflowValidationFailedAt?: Timestamp | null
}

export type EnrollmentInput = Omit<SequenceEnrollment, 'id' | 'enrolledAt'>
