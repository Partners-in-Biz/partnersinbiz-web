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
import type { SlashCommandPayload } from '@/lib/chat/slash-commands'
import type { AgentEffort } from '@/lib/agents/runRouting'
import type { RichMessagePart } from '@/lib/hermes/types'
import type { ConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'
import type { ApprovalMode } from '@/lib/messages/approval-mode'
import type { MessageThinkingTrace } from './thinking-trace'
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

export type ConversationScope = 'general' | 'project' | 'workspace' | 'task' | 'campaign' | 'company' | 'contact'

export interface ConversationAttachment {
  id: string
  name: string
  url: string
  contentType: string
  sizeBytes: number
  storagePath?: string
}

export interface ConversationReadState {
  lastReadMessageId?: string
  lastReadMessageCount?: number
  lastReadAt?: Timestamp
}

export interface Conversation {
  id: string
  orgId: string
  participants: Participant[]
  participantUids: string[]
  participantAgentIds: AgentId[]
  /** Monotonic version used to prevent stale access-management writes. */
  accessVersion?: number
  orchestration?: {
    mode: 'pip-orchestrator'
    dispatcherAgentId: AgentId
    requestedAgentIds: AgentId[]
  }
  /** Immutable ancestry for sessions intentionally continued on another computer. */
  lineage?: {
    kind: 'runtime_continuation'
    parentConversationId: string
    rootConversationId: string
  }
  startedBy: string
  title: string
  scope?: ConversationScope
  scopeRefId?: string
  workspaceContext?: ConversationWorkspaceContext
  contextRefs?: ContextReference[]
  agentEffort?: AgentEffort | null
  lastMessageId?: string
  lastMessagePreview?: string
  lastMessageRole?: 'user' | 'agent' | 'system' | 'tool'
  lastMessageAt?: Timestamp
  messageCount: number
  /** Server-only per-member counters. Public serializers expose only the caller's count. */
  unreadCounts?: Record<string, number>
  /** Server-only per-member read markers. Public serializers expose only the caller's marker. */
  readStateByUser?: Record<string, ConversationReadState>
  /** Caller-specific value added by the public serializer; never persisted as a shared field. */
  unreadCount?: number
  /** Caller-specific value added by the public serializer; never persisted as a shared field. */
  lastReadMessageId?: string
  /** Caller-specific count used for org-visible conversations without explicit participation. */
  lastReadMessageCount?: number
  /** Caller-specific value added by the public serializer; never persisted as a shared field. */
  lastReadAt?: Timestamp
  archived: boolean
  migratedFromHermes?: boolean
  /** When set, this conversation is the command room for that project. */
  commandSessionProjectId?: string
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
  slashCommand?: SlashCommandPayload
  agentEffort?: AgentEffort | null
  /** Hermes-aligned dangerous-command approval mode for this turn. */
  approvalMode?: ApprovalMode
  model?: string
  provider?: string
  /** Exact web-app connected account selected for this turn. */
  llmConnectionId?: string
  /** Exact machine/profile credential readiness proof used for dispatch. */
  llmCredentialBindingId?: string
  runId?: string
  runDocId?: string
  status?: 'queued' | 'pending' | 'streaming' | 'completed' | 'failed' | 'waiting_approval'
  queuedReason?: 'runtime_capacity' | 'agent_capacity' | 'gateway_draining' | 'runtime_restarting'
  error?: string
  events?: unknown[]
  /** Browser-safe thinking trail (no tool I/O). Prefer this over raw events. */
  thinking?: MessageThinkingTrace
  richParts?: RichMessagePart[]
  rich_parts?: RichMessagePart[]
  toolName?: string
  authorKind: 'user' | 'agent' | 'system'
  authorId: string
  authorDisplayName: string
  dispatchAgentId?: AgentId
  /** Runtime target id used when this assistant turn was dispatched. */
  dispatchRuntimeTargetId?: string
  /** Resolved runtime kind for the dispatch (vps / local / linked-computer / …). */
  dispatchRuntimeKind?: string
  /** Human machine label at dispatch time, e.g. "Partners VPS" or "Peet's Mac". */
  dispatchRuntimeLabel?: string
  acceptedDevice?: { machineLabel: string; runtimeVersion: string; acceptedAt: string }
  /** Structured project command-session lifecycle event (system messages). */
  projectCommandEvent?: Record<string, unknown>
  createdAt?: Timestamp
}
