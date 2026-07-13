import { buildDeadLetterReplayDecision } from '@/lib/sequences/dead-letter-replay'

const enrollment = {
  id: 'enr-1', orgId: 'org-1', sequenceId: 'seq-1', contactId: 'contact-1', campaignId: '',
  status: 'dead_letter' as const, currentStep: 2, enrolledAt: null, nextSendAt: null,
  deadLetter: { stepNumber: 2, attempts: 5, reason: 'provider failed', channel: 'sms' as const, replayable: true, failedAt: null },
}

describe('buildDeadLetterReplayDecision', () => {
  it('builds a safe requeue patch that preserves dead-letter history', () => {
    const result = buildDeadLetterReplayDecision(enrollment, 'retry-1', { uid: 'u-1', displayName: 'Peet', kind: 'human' }, 'NOW' as never)
    expect(result.idempotent).toBe(false)
    expect(result.patch).toEqual(expect.objectContaining({ status: 'active', deliveryAttempts: 0, nextSendAt: 'NOW', replayKey: 'retry-1' }))
    expect(result.patch.deadLetterHistory).toEqual([expect.objectContaining({ reason: 'provider failed', replayKey: 'retry-1' })])
  })

  it('returns an idempotent no-op for the same replay key', () => {
    expect(buildDeadLetterReplayDecision({ ...enrollment, status: 'active', replayKey: 'retry-1' } as never, 'retry-1', { uid: 'u-1', displayName: 'Peet', kind: 'human' }, 'NOW' as never)).toEqual({ idempotent: true, patch: null })
  })

  it('rejects non-dead-letter enrollments for a new key', () => {
    expect(() => buildDeadLetterReplayDecision({ ...enrollment, status: 'active' } as never, 'retry-2', { uid: 'u-1', displayName: 'Peet', kind: 'human' }, 'NOW' as never)).toThrow(/not replayable/i)
  })
})
