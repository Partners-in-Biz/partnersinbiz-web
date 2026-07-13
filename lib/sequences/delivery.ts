import type { EnrollmentStatus, ExitReason } from './types'

const HOUR_MS = 60 * 60 * 1000
const MAX_DELIVERY_ATTEMPTS = 5

export interface DeliveryFailureState {
  status: EnrollmentStatus
  exitReason?: ExitReason
  deliveryAttempts: number
  lastDeliveryError: string
  lastDeliveryAttemptAtMs: number
  retryAtMs: number | null
  deadLetter?: {
    stepNumber: number
    attempts: number
    reason: string
    channel: 'email' | 'sms'
    replayable: true
    failedAtMs: number
  }
}

export function deliveryFailureState(args: {
  attemptsBefore: number
  error: string
  stepNumber: number
  channel: 'email' | 'sms'
  nowMs: number
}): DeliveryFailureState {
  const attempts = Math.max(0, Math.floor(args.attemptsBefore)) + 1
  const terminal = attempts >= MAX_DELIVERY_ATTEMPTS
  const state: DeliveryFailureState = {
    status: terminal ? 'dead_letter' : 'active',
    exitReason: terminal ? 'delivery-failed' : undefined,
    deliveryAttempts: attempts,
    lastDeliveryError: args.error,
    lastDeliveryAttemptAtMs: args.nowMs,
    retryAtMs: terminal ? null : args.nowMs + Math.min(24 * HOUR_MS, 2 ** attempts * 15 * 60 * 1000),
  }
  if (terminal) {
    state.deadLetter = {
      stepNumber: args.stepNumber,
      attempts,
      reason: args.error,
      channel: args.channel,
      replayable: true,
      failedAtMs: args.nowMs,
    }
  }
  return state
}
