import { evaluateSequenceReentry } from '@/lib/email-marketing/automation-policy'
import type { SequenceEnrollment } from '@/lib/sequences/types'

function enrollment(overrides: Partial<SequenceEnrollment>): SequenceEnrollment {
  return {
    id: 'enrollment-1',
    orgId: 'org-1',
    sequenceId: 'sequence-1',
    contactId: 'contact-1',
    campaignId: '',
    status: 'completed',
    currentStep: 2,
    enrolledAt: new Date('2026-01-01T00:00:00Z') as never,
    nextSendAt: null,
    completedAt: new Date('2026-01-03T00:00:00Z') as never,
    ...overrides,
  }
}

describe('evaluateSequenceReentry', () => {
  it('returns the active enrollment instead of creating a duplicate', () => {
    const result = evaluateSequenceReentry([enrollment({ status: 'active' })], { mode: 'after_exit' })
    expect(result).toMatchObject({ allowed: false, existingEnrollmentId: 'enrollment-1', reason: 'already_active' })
  })

  it('blocks every repeat enrollment when re-entry is disabled', () => {
    expect(evaluateSequenceReentry([enrollment({})], { mode: 'never' })).toMatchObject({
      allowed: false,
      reason: 'reentry_disabled',
    })
  })

  it('enforces a cooldown from the latest terminal enrollment', () => {
    const result = evaluateSequenceReentry(
      [enrollment({})],
      { mode: 'after_days', afterDays: 14 },
      new Date('2026-01-10T00:00:00Z'),
    )
    expect(result.reason).toBe('cooldown_active')
    expect(result.eligibleAt?.toISOString()).toBe('2026-01-17T00:00:00.000Z')
  })

  it('allows re-entry after the configured cooldown', () => {
    expect(evaluateSequenceReentry(
      [enrollment({})],
      { mode: 'after_days', afterDays: 14 },
      new Date('2026-01-18T00:00:00Z'),
    )).toMatchObject({ allowed: true, reason: 'allowed' })
  })
})
