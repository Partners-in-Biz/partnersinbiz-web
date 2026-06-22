// lib/tasks/types.ts
// Types for the standalone tasks module (personal + cross-project tasks).

import type { ContextReference } from '@/lib/context-references/types'
import type { AgentEffort, AgentModel } from '@/lib/agents/runRouting'

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface TaskAssignee {
  type: 'user' | 'agent'
  id: string
}

export type AgentId = string

export type AgentStatus =
  | 'pending'
  | 'picked-up'
  | 'in-progress'
  | 'awaiting-input'
  | 'done'
  | 'blocked'

export type ReviewStatus = 'pending' | 'in-progress' | 'approved' | 'changes-requested'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'denied'
export type ApprovalGate =
  | 'none'
  | 'human-review'
  | 'client-visible'
  | 'public-publishing'
  | 'paid-spend'
  | 'production-deploy'
  | 'finance'
  | 'destructive'
  | 'secret-config'
  | 'none-until-production-or-client-visible'

export interface AgentArtifact {
  type: 'url' | 'file' | 'commit' | 'message-thread' | 'doc'
  ref: string
  label?: string
}

export interface AgentInput {
  spec: string
  context?: Record<string, unknown>
  constraints?: string[]
}

export interface AgentOutput {
  summary: string
  artifacts?: AgentArtifact[]
  completedAt?: unknown
}

export interface Task {
  id: string
  orgId: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null // ISO
  assignedTo: TaskAssignee | null
  projectId: string | null
  contactId: string | null
  dealId: string | null
  companyId?: string | null
  clientOrgId?: string | null
  projectIds?: string[]
  contactIds?: string[]
  dealIds?: string[]
  companyIds?: string[]
  clientOrgIds?: string[]
  researchItemIds?: string[]
  socialPostIds?: string[]
  emailThreadIds?: string[]
  supportTicketIds?: string[]
  tags: string[]
  columnId?: string | null
  createdBy: string
  createdByType: 'user' | 'agent' | 'system'
  createdAt: unknown
  updatedAt: unknown
  completedAt: unknown | null
  deleted: boolean

  // Agent dispatch fields (mirror project-nested tasks for the multi-agent orchestrator)
  assigneeAgentId?: AgentId | null
  agentStatus?: AgentStatus
  agentInput?: AgentInput
  agentOutput?: AgentOutput
  agentConversationId?: string | null
  agentHeartbeatAt?: unknown
  dependsOn?: string[]
  reviewerIds?: string[]
  reviewerAgentId?: AgentId | null
  reviewStatus?: ReviewStatus | null
  approvalStatus?: ApprovalStatus | null
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  approvalGate?: ApprovalGate | null
  agentEffort?: AgentEffort | null
  agentModel?: AgentModel | null
  requiredCapability?: string | null
  requestedByAgentId?: AgentId | null
  approvalGateTaskId?: string | null
  sourceDocumentId?: string | null
  sourceDocumentSectionId?: string | null
  sourceSpecVersion?: string | null
  sourceResearchItemId?: string | null
  expectedArtifacts?: string[]
  verifierChecklist?: string[]
  contextRefs?: ContextReference[]
}

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: string
  assignedTo?: TaskAssignee
  projectId?: string
  contactId?: string
  dealId?: string
  companyId?: string
  clientOrgId?: string
  projectIds?: string[]
  contactIds?: string[]
  dealIds?: string[]
  companyIds?: string[]
  clientOrgIds?: string[]
  researchItemIds?: string[]
  socialPostIds?: string[]
  emailThreadIds?: string[]
  supportTicketIds?: string[]
  tags?: string[]
  columnId?: string | null
  assigneeAgentId?: AgentId | null
  agentStatus?: AgentStatus
  agentInput?: AgentInput
  agentOutput?: AgentOutput
  agentConversationId?: string | null
  dependsOn?: string[]
  reviewerIds?: string[]
  reviewerAgentId?: AgentId | null
  reviewStatus?: ReviewStatus | null
  approvalStatus?: ApprovalStatus | null
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  approvalGate?: ApprovalGate | null
  agentEffort?: AgentEffort | null
  agentModel?: AgentModel | null
  requiredCapability?: string | null
  requestedByAgentId?: AgentId | null
  approvalGateTaskId?: string | null
  sourceDocumentId?: string | null
  sourceDocumentSectionId?: string | null
  sourceSpecVersion?: string | null
  sourceResearchItemId?: string | null
  expectedArtifacts?: string[]
  verifierChecklist?: string[]
  contextRefs?: ContextReference[]
}

export const VALID_TASK_STATUSES: TaskStatus[] = [
  'todo',
  'in_progress',
  'done',
  'cancelled',
]

export const VALID_TASK_PRIORITIES: TaskPriority[] = [
  'low',
  'normal',
  'high',
  'urgent',
]

export const VALID_ASSIGNEE_TYPES: TaskAssignee['type'][] = ['user', 'agent']

export const VALID_AGENT_IDS: AgentId[] = ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo', 'sales']

export const VALID_AGENT_STATUSES: AgentStatus[] = [
  'pending',
  'picked-up',
  'in-progress',
  'awaiting-input',
  'done',
  'blocked',
]
