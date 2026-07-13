import { goalCompletionState } from '@/lib/sequences/goals'

describe('goalCompletionState', () => {
  it('marks completion goals completed with an explicit outcome', () => {
    expect(goalCompletionState({ id: 'converted', label: 'Converted', condition: { kind: 'replied' }, outcome: 'complete' })).toEqual({
      status: 'completed',
      exitReason: 'goal-hit',
      goalOutcome: 'complete',
    })
  })

  it('preserves legacy goals as explicit exits', () => {
    expect(goalCompletionState({ id: 'reply', label: 'Reply', condition: { kind: 'replied' } })).toEqual({
      status: 'exited',
      exitReason: 'goal-hit',
      goalOutcome: 'exit',
    })
  })
})
