import type { ContextReference } from '@/lib/context-references/types'
import type { AgentEffort, AgentModel } from '@/lib/agents/runRouting'

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface KanbanColumn {
  id: string
  name: string
  color: string
  order: number
  wipLimit?: number | null
}

export interface ProjectDocument {
  id?: string
  title: string
  content: string           // markdown content
  type: 'brief' | 'requirements' | 'notes' | 'reference'
  createdBy: string
  updatedBy?: string
  createdAt?: unknown
  updatedAt?: unknown
}

export interface Project {
  id?: string
  orgId: string
  sourceOrgId?: string
  issuerOrgId?: string
  recipientOrgId?: string
  recipientOrgIds?: string[]
  recipientUserId?: string
  targetOrgId?: string
  targetUserId?: string
  clientOrgId?: string | null
  clientOrgIds?: string[]
  clientId?: string
  sourceCompanyId?: string
  sourceCompanyIds?: string[]
  sourceContactId?: string
  sourceContactIds?: string[]
  companyId?: string
  companyIds?: string[]
  contactId?: string
  contactIds?: string[]
  recipientEmail?: string
  recipientName?: string
  recipientCompanyName?: string
  claimableRelationshipId?: string
  claimToken?: string
  claimStatus?: 'pending' | 'claimed' | 'revoked'
  name: string
  description: string
  status: ProjectStatus
  columns: KanbanColumn[]
  dueDate?: unknown | null
  tags: string[]
  createdBy: string
  brief?: string              // Quick project brief (1-2 paragraphs, stored on project doc)
  createdAt?: unknown
  updatedAt?: unknown
}

export type ProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>

export interface Attachment {
  url: string
  name: string
  size: number
  type: string
}

export type AgentId = string

export type AgentStatus =
  | 'pending'           // waiting for an agent to claim it
  | 'picked-up'         // claimed; agent is preparing to run
  | 'in-progress'       // agent is actively working
  | 'awaiting-input'    // blocked on a question to the human
  | 'done'              // completed; output written
  | 'blocked'           // can't proceed; reason in agentOutput

export interface AgentArtifact {
  type: 'url' | 'file' | 'commit' | 'message-thread' | 'doc'
  ref: string
  label?: string
}

export interface AgentInput {
  spec: string                     // human-readable task spec
  context?: Record<string, unknown>
  constraints?: string[]
}

export interface AgentOutput {
  summary: string
  artifacts?: AgentArtifact[]
  completedAt?: unknown
}

export interface Task {
  id?: string
  orgId: string
  projectId: string
  columnId: string
  title: string
  description: string
  priority: TaskPriority
  assigneeId: string | null
  reporterId: string
  labels: string[]
  attachments?: Attachment[]
  dueDate?: unknown | null
  order: number

  // Agent dispatch fields (Step 2 of multi-agent orchestrator)
  // Tasks without these fields behave exactly as before — pure human work.
  assigneeAgentId?: AgentId | null
  agentStatus?: AgentStatus
  agentInput?: AgentInput
  agentOutput?: AgentOutput
  agentConversationId?: string | null  // Hermes run/conversation ID written at pickup; used to embed live session
  agentHeartbeatAt?: unknown   // last time the claiming agent reported alive; lets us reclaim stale picks
  agentReleaseAt?: unknown     // scheduled backlog release date/time; watcher moves due scheduled cards to todo
  agentReleaseStatus?: 'scheduled' | 'released' | 'cancelled' | null
  agentReleasedAt?: unknown
  dependsOn?: string[]         // task IDs that must reach columnId='done' first
  reviewerIds?: string[]       // human reviewers selected for review column
  reviewerAgentId?: AgentId | null
  reviewStatus?: 'pending' | 'in-progress' | 'approved' | 'changes-requested' | null
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
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
  contextRefs?: ContextReference[]

  createdAt?: unknown
  updatedAt?: unknown
}

export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>

export interface TaskComment {
  id?: string
  taskId: string
  userId: string
  userName: string
  text: string
  createdAt?: unknown
}
