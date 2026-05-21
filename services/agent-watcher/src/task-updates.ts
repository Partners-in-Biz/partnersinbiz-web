export type AgentTaskStatus = 'pending' | 'picked-up' | 'in-progress' | 'awaiting-input' | 'done' | 'blocked'

export function columnForAgentStatus(status: AgentTaskStatus): string {
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
      return 'review'
  }
}

export function agentStatusUpdate(status: AgentTaskStatus): { agentStatus: AgentTaskStatus; columnId: string; reviewStatus?: 'pending' } {
  return {
    agentStatus: status,
    columnId: columnForAgentStatus(status),
    ...(status === 'done' ? { reviewStatus: 'pending' as const } : {}),
  }
}
