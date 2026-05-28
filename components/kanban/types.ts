import type { ContextReference } from '@/lib/context-references/types'

export interface Attachment {
  id?: string
  uploadId?: string
  url: string
  name: string
  size?: number
  type?: string
  mimeType?: string
  storagePath?: string
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface TeamMember {
  userId: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  displayName?: string
  email?: string
  photoURL?: string
}

export type AgentId = string

export type AgentStatus =
  | 'pending'
  | 'picked-up'
  | 'in-progress'
  | 'awaiting-input'
  | 'done'
  | 'blocked'

export interface AgentMember {
  agentId: AgentId
  name: string
  role?: string
  iconKey?: string
  colorKey?: string
  enabled?: boolean
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
}

export interface Task {
  id: string
  title: string
  description?: string
  priority?: string
  columnId: string
  labels?: string[]
  assigneeId?: string | null
  assigneeIds?: string[]
  assigneeAgentId?: AgentId | null
  agentStatus?: AgentStatus | null
  agentInput?: {
    spec?: string
    context?: Record<string, unknown>
    constraints?: string[]
  } | null
  agentOutput?: {
    summary?: string
    artifacts?: Array<{ type: string; ref: string; label?: string }>
    completedAt?: unknown
  } | null
  agentConversationId?: string | null
  agentHeartbeatAt?: unknown
  agentReleaseAt?: unknown
  agentReleaseStatus?: 'scheduled' | 'released' | 'cancelled' | null
  agentReleasedAt?: unknown
  dependsOn?: string[]
  reviewerIds?: string[]
  reviewerAgentId?: AgentId | null
  reviewStatus?: 'pending' | 'in-progress' | 'approved' | 'changes-requested' | null
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  requiredCapability?: string | null
  requestedByAgentId?: AgentId | null
  approvalGateTaskId?: string | null
  sourceDocumentId?: string | null
  sourceDocumentSectionId?: string | null
  sourceSpecVersion?: string | null
  sourceResearchItemId?: string | null
  expectedArtifacts?: string[]
  mentionIds?: string[]
  contextRefs?: ContextReference[]
  internalOnly?: boolean
  attachments?: Attachment[]
  checklist?: ChecklistItem[]
  dueDate?: unknown
  startDate?: unknown
  endDate?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: unknown
  estimateMinutes?: number | null
  order: number
}

export interface Column {
  id: string
  name: string
  color: string
  order: number
  wipLimit?: number | null
}
