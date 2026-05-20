export type AgentTaskStatus = 'pending' | 'picked-up' | 'in-progress' | 'awaiting-input' | 'done' | 'blocked'

export function columnForAgentStatus(status: AgentTaskStatus): string {
  switch (status) {
    case 'pending':
      return 'backlog'
    case 'picked-up':
    case 'in-progress':
      return 'in_progress'
    case 'awaiting-input':
    case 'blocked':
      return 'blocked'
    case 'done':
      return 'done'
  }
}

export function agentStatusUpdate(status: AgentTaskStatus): { agentStatus: AgentTaskStatus; columnId: string } {
  return {
    agentStatus: status,
    columnId: columnForAgentStatus(status),
  }
}
