import type { EnrollmentStatus, ExitReason, SequenceGoal } from './types'

export function goalCompletionState(goal: SequenceGoal): {
  status: EnrollmentStatus
  exitReason: ExitReason
  goalOutcome: 'complete' | 'exit'
} {
  const goalOutcome = goal.outcome === 'complete' ? 'complete' : 'exit'
  return {
    status: goalOutcome === 'complete' ? 'completed' : 'exited',
    exitReason: 'goal-hit',
    goalOutcome,
  }
}
