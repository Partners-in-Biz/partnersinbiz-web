export type AgentTaskStatus = 'pending' | 'picked-up' | 'in-progress' | 'awaiting-input' | 'done' | 'blocked'

export function columnForAgentStatus(status: AgentTaskStatus, options?: { hasReviewer?: boolean }): string {
  switch (status) {
    case 'pending':
      return 'todo'
    case 'picked-up':
    case 'in-progress':
      return 'in_progress'
    case 'awaiting-input':
    case 'blocked':
      return 'blocked'
    case 'done':
      // Without a reviewer, agent completion is the final handoff — land in Done so
      // dependents and Messages can advance immediately.
      return options?.hasReviewer === false ? 'done' : 'review'
  }
}

export function agentStatusUpdate(
  status: AgentTaskStatus,
  options?: { hasReviewer?: boolean },
): { agentStatus: AgentTaskStatus; columnId: string; reviewStatus?: 'pending' | 'approved' } {
  if (status === 'done' && options?.hasReviewer === false) {
    return {
      agentStatus: status,
      columnId: 'done',
      reviewStatus: 'approved',
    }
  }
  return {
    agentStatus: status,
    columnId: columnForAgentStatus(status, options),
    ...(status === 'done' ? { reviewStatus: 'pending' as const } : {}),
  }
}
