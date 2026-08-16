/** Firestore + API types for org-owned Twilio calls. */

export type CallDirection = 'outbound' | 'inbound'
export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled'

export interface TwilioCallRecord {
  id: string
  orgId: string
  contactId?: string | null
  dealId?: string | null
  userId?: string | null
  direction: CallDirection
  status: CallStatus | string
  from: string
  to: string
  callSid?: string | null
  parentCallSid?: string | null
  durationSeconds?: number | null
  recordingSid?: string | null
  recordingUrl?: string | null
  recordingStatus?: string | null
  transcript?: string | null
  transcriptStatus?: string | null
  summary?: string | null
  activityId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
  createdAt?: unknown
  updatedAt?: unknown
  endedAt?: unknown
  deleted?: boolean
}

export const TWILIO_COLLECTIONS = {
  calls: 'twilio_calls',
  verifyChallenges: 'twilio_verify_challenges',
} as const
