import type { SequenceEnrollment, SequenceReentryPolicy } from '@/lib/sequences/types'

export interface ReentryDecision {
  allowed: boolean
  existingEnrollmentId: string | null
  reason: 'allowed' | 'already_active' | 'reentry_disabled' | 'cooldown_active'
  eligibleAt: Date | null
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value && typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; toMillis?: () => number }
    if (typeof candidate.toDate === 'function') return candidate.toDate()
    if (typeof candidate.toMillis === 'function') return new Date(candidate.toMillis())
  }
  return typeof value === 'string' || typeof value === 'number' ? new Date(value) : null
}

function enrollmentTime(enrollment: SequenceEnrollment): Date {
  return asDate(enrollment.completedAt) ?? asDate(enrollment.enrolledAt) ?? new Date(0)
}

export function evaluateSequenceReentry(
  history: SequenceEnrollment[],
  policy: SequenceReentryPolicy | null | undefined,
  now = new Date(),
): ReentryDecision {
  const active = history.find((item) => item.status === 'active' || item.status === 'paused')
  if (active) {
    return { allowed: false, existingEnrollmentId: active.id, reason: 'already_active', eligibleAt: null }
  }

  const mode = policy?.mode ?? 'active_only'
  if (history.length === 0 || mode === 'active_only' || mode === 'after_exit') {
    return { allowed: true, existingEnrollmentId: null, reason: 'allowed', eligibleAt: null }
  }
  if (mode === 'never') {
    return { allowed: false, existingEnrollmentId: null, reason: 'reentry_disabled', eligibleAt: null }
  }

  const latest = [...history].sort((a, b) => enrollmentTime(b).getTime() - enrollmentTime(a).getTime())[0]
  const cooldownDays = Math.max(1, Math.min(3650, Math.floor(policy?.afterDays ?? 1)))
  const eligibleAt = new Date(enrollmentTime(latest).getTime() + cooldownDays * 86_400_000)
  if (eligibleAt.getTime() > now.getTime()) {
    return { allowed: false, existingEnrollmentId: null, reason: 'cooldown_active', eligibleAt }
  }
  return { allowed: true, existingEnrollmentId: null, reason: 'allowed', eligibleAt }
}
