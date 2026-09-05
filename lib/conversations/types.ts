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
import type { ConversationContextCompression, ContextCompressionPlan } from '@/lib/chat/context-compression'
import type { HermesGoalState } from '@/lib/chat/hermes-goal'
import type { AgentEffort } from '@/lib/agents/runRouting'
import type { ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import type { ConversationWorkspaceContext } from '@/lib/client-provisioning/workspace-context'
import type { BotChannelKind, BotInboxMeta } from '@/lib/messages/bot-channel'
import type { ApprovalMode } from '@/lib/messages/approval-mode'
import type { MessageThinkingTrace } from './thinking-trace'
import type { Mention } from '@/lib/comments/types'
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

export interface CrossOrgConversationParticipant {
  /** Stable audience key, e.g. `user:uid` or `agent:agent-id:org-id`. */
  principalId: string
  kind: 'user' | 'agent'
  orgId: string
  role: 'owner' | 'member' | 'agent'
  status: 'active' | 'removed'
  uid?: string
  agentId?: AgentId
  /** Active human membership that authorises an agent's cross-org policy check. */
  memberUid?: string
  addedByUid?: string
  addedAt?: Timestamp
  removedByUid?: string
  removedAt?: Timestamp
}

export interface CrossOrgConversationBinding {
  /** Canonical bilateral relationship authority; legacy CRM pointers never grant access. */
  partnerLinkId: string
  ownerOrgId: string
  /** Exactly the owner and one reciprocal partner organisation. */
  participantOrgIds: [string, string]
  thread: {
    kind: 'relationship' | 'project' | 'resource'
    resourceType: 'relationship' | 'project' | string
    resourceId: string
  }
  status: 'active' | 'frozen' | 'revoked'
  /** Incremented on revocation/narrowing to fence context caches and queued runs. */
  accessEpoch: number
  retention: {
    foreignParticipantRetentionDays: number
    purgeAfter?: Timestamp
  }
  participants: CrossOrgConversationParticipant[]
}

export interface ConversationVisibility {
  /** Explicit audience; omitted is legacy owner-org-only behavior. */
  principalIds: string[]
}

export interface ConversationAttachment {
  id: string
  name: string
  url: string
  contentType: string
  sizeBytes: number
  storagePath?: string
  visibility?: ConversationVisibility
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
  /**
   * Deliberate two-organisation binding for a normal Conversation. When set,
   * foreign access must pass lib/conversations/cross-org.ts on every request.
   */
  crossOrg?: CrossOrgConversationBinding
  /** Monotonic version used to prevent stale access-management writes. */
  accessVersion?: number
  /** Server-only per-conversation event sequence for the realtime outbox. */
  realtimeSequence?: number
  /** Server-only deletion tombstone retained long enough to notify recipients. */
  realtimeDeletedAt?: Timestamp
  orchestration?: {
    mode: 'pip-orchestrator'
    dispatcherAgentId: AgentId
    requestedAgentIds: AgentId[]
  }
  /** Set when this conversation is the Messages mirror of an AgentRoom. */
  agentRoom?: { roomId: string }
  /**
   * Room mirror escalation: a bot wrote `@user` (text mention, not a Hermes WS event).
   * Unread for humanTeamIds is applied via read-state when this flips on.
   */
  needsYou?: boolean
  /** Immutable ancestry for sessions intentionally continued on another computer. */
  lineage?: {
    kind: 'runtime_continuation'
    parentConversationId: string
    rootConversationId: string
  }
  startedBy: string
  title: string
  /** messages = ordinary chat; bot = human↔Bot channel; bot_inbox = Bot↔Bot. */
  channelKind?: BotChannelKind
  botInbox?: BotInboxMeta
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
  /**
   * Standing Hermes Persistent Goal (Ralph loop) for this conversation.
   * Driven by `/goal` and `/subgoal` slash commands in Messages.
   */
  goalState?: HermesGoalState | null
  /**
   * Durable context compression produced by `/compress`. When present, message
   * dispatch injects the summary + the most recent turns instead of the raw
   * history tail.
   */
  contextCompression?: ConversationContextCompression | null
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** Explicit per-message audience for cross-org Conversations. */
  visibility?: ConversationVisibility
  mentions?: Mention[]
  mentionIds?: string[]
  attachments?: ConversationAttachment[]
  contextRefs?: ContextReference[]
  slashCommand?: SlashCommandPayload
  /** Set on the pending assistant message of a /compress run so the finalizer
   * stores the run reply as durable conversation context compression. */
  contextCompressionPlan?: ContextCompressionPlan
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
  /** Structured message actions (open_context email/invoice, approve, …). */
  uiActions?: ChatUiAction[]
  /** Snake_case alias persisted by some writers; public serializers mirror both. */
  ui_actions?: ChatUiAction[]
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
  /** Sanitized dispatch failure code when the run could not be created on the runtime. */
  workspaceDispatchFailureCode?: string
  /** Runtime-target selection failure code when no dispatch target could be resolved. */
  runtimeDispatchFailureCode?: string
  /** Linked-computer badge for a room-turn that landed from a specific machine. */
  deviceBadge?: { deviceId: string; label: string }
  acceptedDevice?: { machineLabel: string; runtimeVersion: string; acceptedAt: string }
  /** Structured project command-session lifecycle event (system messages). */
  projectCommandEvent?: Record<string, unknown>
  createdAt?: Timestamp
}
