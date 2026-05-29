/**
 * Types for the Phase 1 agent-team chat system.
 *
 * Conversations live in the `conversations` top-level collection.
 * Messages live in `conversations/{convId}/messages`.
 * Per-org chat visibility config lives in `org_chat_config/{orgId}`.
 */
import type { Timestamp } from 'firebase-admin/firestore'

import { AGENT_IDS, type AgentId } from '@/lib/agents/types'
import type { ContextReference } from '@/lib/context-references/types'
export type { AgentId }

export interface OrgChatConfig {
  orgId: string
  visibleAgents: {
    admin: AgentId[]  // default: all policy agents
    client: AgentId[] // default: ['pip']
  }
  enableClientToAdminChat: boolean    // default: true
  enableClientToPiBTeamChat: boolean  // default: false
  updatedAt?: Timestamp
  updatedBy?: string
}

export const DEFAULT_CHAT_CONFIG: Omit<OrgChatConfig, 'orgId' | 'updatedAt' | 'updatedBy'> = {
  visibleAgents: {
    admin: [...AGENT_IDS],
    client: ['pip'],
  },
  enableClientToAdminChat: true,
  enableClientToPiBTeamChat: false,
}

export interface HumanParticipant {
  kind: 'user'
  uid: string
  role: 'admin' | 'client'
  displayName?: string
  email?: string
}

export interface AgentParticipant {
  kind: 'agent'
  agentId: AgentId
  name: string
}

export type Participant = HumanParticipant | AgentParticipant

export type ConversationScope = 'general' | 'project' | 'task' | 'campaign'

export interface ConversationAttachment {
  id: string
  name: string
  url: string
  contentType: string
  sizeBytes: number
  storagePath?: string
}

export interface Conversation {
  id: string
  orgId: string
  participants: Participant[]
  participantUids: string[]
  participantAgentIds: AgentId[]
  orchestration?: {
    mode: 'pip-orchestrator'
    dispatcherAgentId: AgentId
    requestedAgentIds: AgentId[]
  }
  startedBy: string
  title: string
  scope?: ConversationScope
  scopeRefId?: string
  contextRefs?: ContextReference[]
  lastMessagePreview?: string
  lastMessageRole?: 'user' | 'agent' | 'system' | 'tool'
  lastMessageAt?: Timestamp
  messageCount: number
  archived: boolean
  migratedFromHermes?: boolean
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  attachments?: ConversationAttachment[]
  contextRefs?: ContextReference[]
  runId?: string
  runDocId?: string
  status?: 'pending' | 'streaming' | 'completed' | 'failed' | 'waiting_approval'
  error?: string
  events?: unknown[]
  toolName?: string
  authorKind: 'user' | 'agent' | 'system'
  authorId: string
  authorDisplayName: string
  dispatchAgentId?: AgentId
  createdAt?: Timestamp
}
