import { deliveryFailureState } from '@/lib/sequences/delivery'

describe('deliveryFailureState', () => {
  it('returns auditable retry state before the attempt limit', () => {
    const state = deliveryFailureState({ attemptsBefore: 1, error: 'provider timeout', stepNumber: 2, channel: 'email', nowMs: 1_000 })
    expect(state.status).toBe('active')
    expect(state.deliveryAttempts).toBe(2)
    expect(state.retryAtMs).toBe(1_000 + 60 * 60 * 1000)
    expect(state.deadLetter).toBeUndefined()
  })

  it('moves the fifth failure into a structured replayable dead letter', () => {
    const state = deliveryFailureState({ attemptsBefore: 4, error: 'provider rejected', stepNumber: 2, channel: 'email', nowMs: 1_000 })
    expect(state).toEqual(expect.objectContaining({
      status: 'dead_letter',
      exitReason: 'delivery-failed',
      deliveryAttempts: 5,
      retryAtMs: null,
      deadLetter: expect.objectContaining({ attempts: 5, reason: 'provider rejected', stepNumber: 2, replayable: true }),
    }))
  })
})
