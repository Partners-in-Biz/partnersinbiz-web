import type { AgentId } from '@/lib/agents/types'
import type { AgentCapability } from '@/lib/agents/capabilities'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

interface ApprovalGatedTaskInput {
  title: string
  assigneeAgentId: AgentId
  reviewerAgentId?: AgentId
  requiredCapability: AgentCapability
  riskLevel: RiskLevel
  expectedArtifacts?: string[]
  spec: string
  sourceDocumentSectionId?: string
  sourceResearchItemId?: string
}

interface ApprovalGatedGroupInput {
  orgId: string
  projectId: string
  requestedByAgentId: AgentId
  sourceDocumentId?: string
  sourceSpecVersion?: string
  approval: {
    title: string
    description: string
    approverId?: string
  }
  tasks: ApprovalGatedTaskInput[]
}

interface BuiltTask {
  id: string
  orgId: string
  projectId: string
  columnId: string
  title: string
  description: string
  assigneeAgentId: AgentId
  agentStatus: string
  requiresApproval?: boolean
  approvalStatus?: string
  approvalGateTaskId?: string
  sourceDocumentId?: string
  sourceDocumentSectionId?: string
  sourceSpecVersion?: string
  sourceResearchItemId?: string
  requestedByAgentId: AgentId
  reviewerAgentId?: AgentId
  requiredCapability?: AgentCapability
  riskLevel?: RiskLevel
  expectedArtifacts?: string[]
  dependsOn?: string[]
  labels: string[]
  agentInput: {
    spec: string
    context: Record<string, unknown>
  }
}

function stableId(prefix: string, index = 0): string {
  return `${prefix}-${Date.now()}-${index}`
}

export function buildApprovalGatedTaskGroup(input: ApprovalGatedGroupInput): {
  approvalTask: BuiltTask
  specialistTasks: BuiltTask[]
} {
  const approvalTaskId = stableId('approval-gate')
  const baseContext = {
    sourceDocumentId: input.sourceDocumentId,
    sourceSpecVersion: input.sourceSpecVersion,
    requestedByAgentId: input.requestedByAgentId,
  }

  const approvalTask: BuiltTask = {
    id: approvalTaskId,
    orgId: input.orgId,
    projectId: input.projectId,
    columnId: 'blocked',
    title: input.approval.title,
    description: input.approval.description,
    assigneeAgentId: 'pip',
    agentStatus: 'awaiting-input',
    requiresApproval: true,
    approvalStatus: 'pending',
    sourceDocumentId: input.sourceDocumentId,
    sourceSpecVersion: input.sourceSpecVersion,
    requestedByAgentId: input.requestedByAgentId,
    labels: ['approval-gate', 'human-required'],
    agentInput: {
      spec: input.approval.description,
      context: {
        ...baseContext,
        approverId: input.approval.approverId ?? null,
      },
    },
  }

  const specialistTasks = input.tasks.map((task, index): BuiltTask => ({
    id: stableId('specialist-task', index),
    orgId: input.orgId,
    projectId: input.projectId,
    columnId: 'blocked',
    title: task.title,
    description: task.spec,
    assigneeAgentId: task.assigneeAgentId,
    reviewerAgentId: task.reviewerAgentId,
    agentStatus: 'awaiting-input',
    approvalGateTaskId: approvalTaskId,
    dependsOn: [approvalTaskId],
    sourceDocumentId: input.sourceDocumentId,
    sourceDocumentSectionId: task.sourceDocumentSectionId,
    sourceSpecVersion: input.sourceSpecVersion,
    sourceResearchItemId: task.sourceResearchItemId,
    requestedByAgentId: input.requestedByAgentId,
    requiredCapability: task.requiredCapability,
    riskLevel: task.riskLevel,
    expectedArtifacts: task.expectedArtifacts ?? [],
    labels: ['approval-gated', `agent:${task.assigneeAgentId}`, `capability:${task.requiredCapability}`],
    agentInput: {
      spec: task.spec,
      context: {
        ...baseContext,
        sourceDocumentSectionId: task.sourceDocumentSectionId,
        sourceResearchItemId: task.sourceResearchItemId,
        approvalGateTaskId: approvalTaskId,
        reviewerAgentId: task.reviewerAgentId,
        requiredCapability: task.requiredCapability,
        riskLevel: task.riskLevel,
        expectedArtifacts: task.expectedArtifacts ?? [],
      },
    },
  }))

  return { approvalTask, specialistTasks }
}
