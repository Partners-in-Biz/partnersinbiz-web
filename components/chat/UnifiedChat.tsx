'use client'

import { DragEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ChatEvent, ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import {
  createProposedTasksFromMessage,
  extractProjectTaskProposal,
  isCreateTasksUiAction,
} from '@/lib/projects/chatTaskProposal'
import { applyAssistantTextDelta } from '@/lib/chat/applyAssistantTextDelta'
import { buildThinkingTrace } from '@/lib/conversations/thinking-trace'
import {
  formatClientNetworkError,
  formatCreateConversationNetworkError,
  isNetworkFetchFailure,
  matchReconciledCreatedConversation,
  newConversationCreateIdempotencyKey,
} from '@/lib/conversations/create-resilience'
import { exportChatAsMarkdown } from '@/lib/conversations/export-chat'
import { postConversationMessage } from '@/lib/conversations/message-submit'
import {
  formatConversationPresenceLine,
  type ConversationPresence,
} from '@/lib/conversations/presence-shared'
import {
  planConversationRealtimeRefresh,
  shouldUseConversationLiveFallback,
  type ConversationRealtimeInvalidation,
} from '@/lib/conversations/realtime-invalidation'
import {
  WORKSPACE_CATALOGUE_HEALTHY_REFRESH_MS,
  WORKSPACE_CATALOGUE_RECOVERY_REFRESH_MS,
  shouldPollWorkspaceCatalogue,
} from '@/lib/workspaces/catalogue-refresh'
import { AGENT_IDS, type AgentSkillPolicyState } from '@/lib/agents/types'
import { AGENT_EFFORT_OPTIONS, type AgentEffort } from '@/lib/agents/runRouting'
import { WORKFORCE_BLUEPRINT_OPTIONS } from '@/lib/agents/role-blueprints'
import {
  APPROVAL_MODE_OPTIONS,
  cleanApprovalMode,
  shouldAutoApproveDangerousCommands,
  type ApprovalMode,
} from '@/lib/messages/approval-mode'
import {
  completeAgentMentionToken,
  extractCurrentPageContextCommand,
  filterContextReferenceMentionOptions,
  findActiveContextMention,
  findActiveContextTypePrompt,
  isAgentMentionNamespace,
  removeMentionToken,
  removeMentionTokenFromLatest,
  replaceTypePromptToken,
  type ActiveContextMention,
  type ActiveContextTypePrompt,
  type ContextReferenceMentionOption,
} from '@/lib/context-references/composer'
import {
  contextReferenceKey,
  contextReferenceTypeFrom,
  MAX_CONTEXT_REFS,
  type ContextReference,
  type ContextReferenceSeed,
} from '@/lib/context-references/types'
import {
  buildSlashCommandPayload,
  findActiveSlashCommandPrompt,
  listSlashCommandsForAccess,
  parseLeadingSlashCommand,
  replaceSlashCommandToken,
  evaluateSlashCommandAccess,
  type ActiveSlashCommandPrompt,
  type SlashCommandDefinition,
  type SlashCommandPayload,
} from '@/lib/chat/slash-commands'
import { DESIGN_COMMANDS, type DesignCommandDefinition } from '@/lib/chat/design-commands'
import MessageBubble, { type ConversationAttachment, type ConversationMessage } from './MessageBubble'
import ParticipantBar from './ParticipantBar'
import ParticipantPicker, { type SelectedParticipant } from './ParticipantPicker'
import {
  filterAgentsByGate,
  resolveNewConversationAgentGate,
} from '@/lib/conversations/new-conversation-agent-gate'
import ConversationListItem, { type Conversation } from './ConversationListItem'
import { HoverTip } from '@/components/ui/HoverTip'
import ConversationAccessDialog from './ConversationAccessDialog'
import VoiceInputButton from './VoiceInputButton'
import ModelProviderPicker, { type MessageModelCatalog, type ModelRuntimeSelection } from '@/components/messages/hermes/ModelProviderPicker'
import { LivingTaskBundle } from '@/components/chat/project/ProjectChatExperience'
import { useProjectChatProgress } from '@/components/chat/project/useProjectChatProgress'
import { useChatContexts } from '@/components/chat/context/useChatContexts'
import { ChatContextExperience } from '@/components/chat/context/ChatContextExperience'
import { ContextArtifactBundle } from '@/components/chat/context/ContextArtifactBundle'
import type { ProjectChatTaskItem } from '@/lib/projects/chatProgress'
import type { RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'
import { folderAccentStyle } from '@/lib/messages/folder-accent'
import { pickPreferredWorkspaceRuntime } from '@/lib/messages/preferred-workspace-runtime'
import { buildConnectionWhere, type ConnectionWhere } from '@/lib/chat/connection-where'
import {
  computeConversationMenuPosition,
  type ConversationMenuPosition,
} from '@/lib/chat/conversationMenuPosition'
import { ProjectPeopleAccessPanel } from '@/components/projects/ProjectPeopleAccessPanel'
import { AccessibleDialog } from '@/components/linked-computers/AccessibleOverlay'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import AgentWorkbenchRail from '@/components/messages/workbench/AgentWorkbenchRail'
import {
  buildWorkbenchBrowserTargets,
  buildWorkbenchChanges,
  buildWorkbenchFileTree,
  buildWorkbenchTerminalEntries,
} from '@/lib/messages/workbench/from-events'
import { attachWorkbenchDiffs, mergeWorkbenchDirectory, runConversationWorkbenchJob, WORKBENCH_ROOT_PATH, workbenchEntriesToTree, workbenchJobResult, workbenchStatusToChanges } from '@/lib/messages/workbench/client'
import { formatWorkbenchOperationResult, formatWorkbenchProgressBody, pollWorkbenchJob } from '@/lib/messages/workbench/browser-client'
import { auth } from '@/lib/firebase/config'
import {
  appendWorkbenchSessionOutput,
  approveWorkbenchSession as approveWorkbenchSessionApi,
  createWorkbenchSession,
  killWorkbenchSession as killWorkbenchSessionApi,
  pollWorkbenchSession,
  resizeWorkbenchSession as resizeWorkbenchSessionApi,
  writeWorkbenchSessionStdin,
  WORKBENCH_SESSION_TERMINAL_STATUSES,
  type PublicWorkbenchSession,
  type WorkbenchSessionTranscriptState,
} from '@/lib/messages/workbench/session-client'
import {
  approveTunnelSession,
  createTunnelSession,
  killTunnelSession,
  pollTunnelSession,
  WORKBENCH_TUNNEL_TERMINAL_STATUSES,
  type PublicWorkbenchTunnelSession,
} from '@/lib/messages/workbench/tunnel-client'
import {
  appendWorkbenchBrowserSessionProgress,
  approveWorkbenchBrowserSession as approveWorkbenchBrowserSessionApi,
  captureWorkbenchBrowserSession as captureWorkbenchBrowserSessionApi,
  clickWorkbenchBrowserSession as clickWorkbenchBrowserSessionApi,
  createWorkbenchBrowserSession,
  followWorkbenchBrowserSession as followWorkbenchBrowserSessionApi,
  getWorkbenchBrowserConsole,
  getWorkbenchBrowserSession,
  getWorkbenchBrowserSnapshot,
  killWorkbenchBrowserSession as killWorkbenchBrowserSessionApi,
  latestWorkbenchBrowserSessionFrameUrl,
  navigateWorkbenchBrowserSession as navigateWorkbenchBrowserSessionApi,
  pollWorkbenchBrowserSession,
  requestWorkbenchBrowserConsole as requestWorkbenchBrowserConsoleApi,
  requestWorkbenchBrowserSnapshot as requestWorkbenchBrowserSnapshotApi,
  setWorkbenchBrowserSessionAllowPrivate as setWorkbenchBrowserSessionAllowPrivateApi,
  setWorkbenchBrowserSessionDriver as setWorkbenchBrowserSessionDriverApi,
  typeWorkbenchBrowserSession as typeWorkbenchBrowserSessionApi,
  EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS,
  type PublicWorkbenchBrowserSession,
  type WorkbenchBrowserSessionProgressState,
} from '@/lib/messages/workbench/browser-session-client'
import type {
  WorkbenchBrowserSessionViewState,
  WorkbenchChangeFile,
  WorkbenchFileNode,
  WorkbenchFilePreview,
  WorkbenchFilesSource,
  WorkbenchRuntimeSummary,
  WorkbenchSessionViewState,
  WorkbenchTab,
  WorkbenchTerminalEntry,
  WorkbenchTerminalMode,
  WorkbenchTunnelViewState,
} from '@/lib/messages/workbench/types'

/** Matches the server's default browser viewport — used only when a session snapshot hasn't reported one yet. */
const WORKBENCH_BROWSER_FALLBACK_VIEWPORT = { width: 1280, height: 720 } as const
/** Device-side capture cadence, and the frame poll cadence, while following the agent browser. */
const WORKBENCH_BROWSER_FOLLOW_INTERVAL_MS = 800
/** Frame poll cadence when the Browser tab is open but not following. */
const WORKBENCH_BROWSER_IDLE_POLL_INTERVAL_MS = 2_500
const CONVERSATION_REALTIME_GATEWAY_URL = process.env.NEXT_PUBLIC_CONVERSATION_REALTIME_GATEWAY_URL?.trim() ?? ''
const CONVERSATION_REALTIME_TRANSPORT = process.env.NEXT_PUBLIC_CONVERSATION_REALTIME_TRANSPORT?.trim().toLowerCase() ?? 'off'
const CONVERSATION_REALTIME_WEBSOCKET_URL = CONVERSATION_REALTIME_GATEWAY_URL
  .replace(/^https:/i, 'wss:')
  .replace(/^http:/i, 'ws:')

type AgentId = string

interface AgentTeamDoc {
  agentId: AgentId
  name: string
  role: string
  persona: string
  iconKey: string
  colorKey: string
  enabled: boolean
  baseUrl: string
  apiKey?: string
  defaultModel: string
  skills?: string[]
  skillPolicy?: AgentSkillPolicyState
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
  ownerUserId?: string
  accessScope?: 'personal' | 'organization' | string
  provisioningMode?: string
  scopeOrgId?: string
  agentHandle?: string
}

export interface UnifiedChatProps {
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  userRole?: string
  orgName?: string
  projectId?: string
  scope?: ConversationScope
  scopeRefId?: string
  includeAllScopes?: boolean
  initialConvId?: string
  initialAgentId?: AgentId
  autoCreateScopedConversation?: boolean
  autoCreateTitle?: string
  allowDeleteConversations?: boolean
  /** Stop in-flight agent runs. Defaults on so any chat participant can cancel a stuck agent. */
  allowStopRuns?: boolean
  allowManageConversationAccess?: boolean
  allowAgentParticipants?: boolean
  allowStartConversations?: boolean
  allowSendMessages?: boolean
  allowArchiveConversations?: boolean
  currentPageContext?: ContextReferenceSeed | null
  preferCurrentPageContext?: boolean
  onContextActionResolved?: () => void
  compact?: boolean
  layoutVariant?: 'classic' | 'hermes'
  /** Controlled session selection used by the Hermes multi-pane workspace. */
  activeConversationId?: string | null
  onActiveConversationChange?: (conversationId: string | null) => void
  onConversationsChange?: (conversations: Conversation[]) => void
  /**
   * Hermes workspace tab activity: report agent-run lifecycle so background
   * tabs can pulse while running and show an unread underline when complete.
   */
  onConversationLifecycle?: (event: {
    conversationId: string
    phase: 'running' | 'completed' | 'idle'
  }) => void
  /** Reports whether one chat surface is connected to the optional GCP invalidation gateway. */
  onRealtimeGatewayConnectionChange?: (clientId: string, ready: boolean) => void
  /** Lets the Hermes tab shell refresh a running background tab only on an actual invalidation. */
  onConversationRealtimeInvalidation?: (invalidation: ConversationRealtimeInvalidation) => void
  /** Title map from the Hermes tab strip so shell renames stay in sync with chat. */
  syncedConversationTitles?: Record<string, string>
  /** A secondary pane reuses the chat surface without duplicating the session rail. */
  showConversationList?: boolean
  /** Backward-compatible presentation control for the Hermes session catalogue. */
  conversationRailMode?: 'expanded' | 'collapsed'
  onConversationRailModeChange?: (mode: 'expanded' | 'collapsed') => void
  onContextCanvasPresentationChange?: (state: { open: boolean; mode: 'single' | 'dual'; width: number }) => void
  /** Enables the observer-only Files / Terminal / Browser / Changes rail in Messages. */
  showAgentWorkbench?: boolean
}

const POLL_INTERVAL = 1500
const MAX_RUN_POLL_ATTEMPTS = Math.ceil((90 * 60 * 1000) / POLL_INTERVAL)
/** Every N finalize polls, reload messages so a completed run still surfaces if SSE died. */
const FINALIZE_MESSAGE_RECOVERY_EVERY = 10
const FINALIZE_LOAD_RETRIES = 3
const HUMAN_CHAT_REFRESH_INTERVAL = 3000
const PROJECT_SYNC_STATUS_REFRESH_INTERVAL = 5_000
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_PENDING_ATTACHMENTS = 5
const MAX_COMPOSER_HISTORY_ENTRIES = 30
const MAX_QUEUED_COMPOSER_DRAFTS = 8
const COMPOSER_HISTORY_STORAGE_PREFIX = 'pib.messages.composerHistory.v1'
const PINNED_CONVERSATIONS_STORAGE_PREFIX = 'pib.messages.pinnedConversations.v1'
const EXPANDED_SESSION_GROUPS_STORAGE_PREFIX = 'pib.messages.expandedSessionGroups.v1'
const APPROVAL_MODE_STORAGE_PREFIX = 'pib.messages.approvalMode.v1'
const PROJECT_SETUP_IDEMPOTENCY_PREFIX = 'pib-project-setup'
const ALLOWED_ATTACHMENT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

interface QueuedComposerDraft {
  id: string
  conversationId: string
  text: string
  attachments: File[]
  queuedAt: number
}

interface OrgWorkspaceSummary {
  workspaceId: string
  orgId: string
  orgSlug: string
  orgName: string
  agentDomain: string
  sourceOfTruth: 'vps'
  syncMode: string
  defaultRuntimeTarget: string
  folderVersion: number
  /** Set for company Cowork trees — those belong under Cowork folders, not Workspaces. */
  companyId?: string | null
}

interface WorkspaceProjectSummary {
  id: string
  name: string
  locations?: WorkspaceProjectLocationSummary[]
}

interface WorkspaceProjectLocationSummary {
  replicaId?: string
  locationId: string
  workspaceId?: string
  label: string
  availability: 'online' | 'unavailable'
  syncStatus?: string
  visibility?: 'private' | 'organization'
  kind?: 'vps' | 'computer'
  platform?: string
  canonical?: boolean
  authenticatedRuntime?: boolean
}

interface WorkspaceRuntimePresence {
  id: string
  legacyRuntimeTargetIds?: string[]
  label: string
  hostId?: string
  deviceId?: string
  mappingId?: string
  mappingLabel?: string
  workspaceId?: string
  locationId?: string
  locationLabel?: string
  location?: { id?: string; label?: string }
  platform?: string
  kind?: string
  deviceKind?: 'vps' | 'computer'
  ownerType?: 'user' | 'organization'
  visibility?: 'private' | 'organization'
  unavailableReason?: string
  enabled: boolean
  isLocal: boolean
  isFresh: boolean
  isHealthy: boolean
  selectable: boolean
  lastSeenAt: string | null
  ageSeconds: number | null
  lastHealthStatus: string | null
  /** Healthy Hermes agent ids on this linked computer (when known). */
  availableAgentIds?: string[]
}

interface WorkspaceCatalogueSnapshot {
  workspaces: OrgWorkspaceSummary[]
  projects: WorkspaceProjectSummary[]
  runtimeTargetsByWorkspace: Record<string, WorkspaceRuntimePresence[]>
}

interface RegisteredWorkspaceFolder {
  id: string
  name: string
  syncStatus?: string
}

type ProjectSetupMode = 'existing_folder' | 'standard' | 'full_client'

interface ProjectSetupPlanView {
  state: string
  completed?: boolean
  syncCompleted?: boolean
  actions?: Array<{ type?: string; status?: string; [key: string]: unknown }>
}

interface ProjectSetupResultView {
  mode: ProjectSetupMode
  projectId: string
  projectName: string
  plan: ProjectSetupPlanView
  linkedLocationIds: string[]
  organizationId?: string
  organizationSlug?: string
}

interface ProjectLocationOption {
  key: string
  runtimeTargetId: string
  locationId: string
  mappingId?: string
  workspaceId: string
  workspaceLabel: string
  label: string
  kind?: 'vps' | 'computer'
  ownerType?: 'user' | 'organization'
  selectable: boolean
  unavailableReason?: string
}

interface ProjectLocationManagementCandidate {
  key: string
  runtimeTargetId: string
  locationId: string
  mappingId?: string
  workspaceId: string
  workspaceLabel: string
  label: string
  selectable: boolean
}

interface ManagedProjectLocation {
  replicaId: string
  locationId: string
  label: string
  availability: 'online' | 'unavailable'
  syncStatus?: string
  visibility?: 'private' | 'organization'
  kind?: 'vps' | 'computer'
  platform?: string
  canonical?: boolean
  authenticatedRuntime: boolean
}

interface ManagedProjectSyncState {
  projectId: string
  status: string | null
  conflictKind: string | null
  blocker: string | null
  notice: string | null
  noticeTone: 'neutral' | 'success' | 'blocker' | 'error'
}

function managedProjectCanSync(locations: ManagedProjectLocation[]): boolean {
  if (locations.length < 2) return false
  return locations.every((location) => location.authenticatedRuntime)
    && locations.some((location) => location.kind === 'vps' && location.visibility === 'organization')
}

function projectSyncStatusLabel(status: string | null): string {
  if (!status) return 'Not started'
  return humanizeProjectSetupValue(status)
}

function projectSyncBlockerMessage(blocker: string): string {
  if (blocker === 'project_sync_storage_lifecycle_unverified') {
    return 'disabled until the project-sync retention controls are verified: all five Firestore TTL policies and the Storage lifecycle rule must be read back live.'
  }
  if (blocker === 'native_sync_worker_unavailable') {
    return 'waiting for every linked computer and VPS to install and authenticate its sync worker.'
  }
  if (blocker === 'native_sync_replica_offline') {
    return 'waiting for an unavailable computer to reconnect.'
  }
  return `blocked by ${humanizeProjectSetupValue(blocker).toLowerCase()}.`
}

function projectSyncConflictMessage(kind: string | null): string {
  if (kind === 'target_drift') return 'Files changed on a destination after the transfer was planned.'
  if (kind === 'non_destructive_apply_required') return 'A deletion or file/folder type change needs manual reconciliation.'
  if (kind === 'competing_revisions') return 'Different linked machines contain competing edits.'
  if (kind === 'unsupported_scale') return 'This project exceeds the safe v1 sync limits.'
  if (kind === 'unsupported_path') return 'A project path is not portable across the linked machines.'
  return 'The linked machines contain versions that cannot be reconciled automatically.'
}

function humanizeProjectSetupValue(value: string): string {
  const normalized = value.replace(/[_-]+/g, ' ').trim()
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Pending'
}

function projectSetupStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase()
  if (normalized === 'ready' || normalized === 'completed') return 'Ready'
  if (normalized.includes('conflict')) return 'Conflict'
  if (normalized.includes('offline') || normalized.includes('computer_unavailable')) return 'Computer unavailable'
  if (normalized.includes('mapping')) return 'Pending mapping'
  if (normalized.includes('sync') || normalized.includes('standard_provision')) return 'Pending sync'
  if (normalized.includes('client') || normalized.includes('provision')) return 'Pending client provisioning'
  return humanizeProjectSetupValue(normalized)
}

function projectRuntimeLocationId(runtime: WorkspaceRuntimePresence): string {
  return runtime.locationId || runtime.location?.id || runtime.id
}

function projectRuntimeLabel(runtime: WorkspaceRuntimePresence): string {
  return runtime.locationLabel || runtime.location?.label || runtime.label
}

function workspaceRuntimeSelectionKey(runtime: WorkspaceRuntimePresence): string {
  const mappingId = runtime.mappingId?.trim()
  return mappingId ? `${runtime.id}::${mappingId}` : runtime.id
}

function parseWorkspaceRuntimeSelection(value: string): { runtimeTargetId: string; mappingId?: string } {
  const separator = value.indexOf('::')
  if (separator <= 0) return { runtimeTargetId: value }
  const mappingId = value.slice(separator + 2).trim()
  return {
    runtimeTargetId: value.slice(0, separator),
    ...(mappingId ? { mappingId } : {}),
  }
}

/** Organisation root needs per-mapping choices; company/project only need the machine. */
function workspaceRuntimeShowsMappedFolders(scope: ConversationScope): boolean {
  return scope === 'workspace'
}

function preferWorkspaceRuntime(
  a: WorkspaceRuntimePresence,
  b: WorkspaceRuntimePresence,
  preferredMappingLabel?: string,
): number {
  if (a.selectable !== b.selectable) return a.selectable ? -1 : 1
  if (a.isHealthy !== b.isHealthy) return a.isHealthy ? -1 : 1
  if (a.isFresh !== b.isFresh) return a.isFresh ? -1 : 1
  const preferred = preferredMappingLabel?.trim()
  if (preferred) {
    const aMatch = a.mappingLabel?.trim() === preferred
    const bMatch = b.mappingLabel?.trim() === preferred
    if (aMatch !== bMatch) return aMatch ? -1 : 1
  }
  return (a.mappingId || '').localeCompare(b.mappingId || '')
}

/** One catalogue row per computer — keeps a preferred mapping for dispatch auth. */
function collapseWorkspaceRuntimesByComputer(
  runtimes: WorkspaceRuntimePresence[],
  options?: { preferredMappingLabel?: string },
): WorkspaceRuntimePresence[] {
  const preferredMappingLabel = options?.preferredMappingLabel
  const chosen = new Map<string, WorkspaceRuntimePresence>()
  for (const runtime of [...runtimes].sort((a, b) => preferWorkspaceRuntime(a, b, preferredMappingLabel))) {
    if (!chosen.has(runtime.id)) chosen.set(runtime.id, runtime)
  }
  const order: string[] = []
  for (const runtime of runtimes) {
    if (!order.includes(runtime.id)) order.push(runtime.id)
  }
  return order.flatMap((id) => {
    const runtime = chosen.get(id)
    return runtime ? [runtime] : []
  })
}

function workspaceRuntimeOptionLabel(
  runtime: WorkspaceRuntimePresence,
  options?: { includeMapping?: boolean },
): string {
  const mappingLabel = options?.includeMapping === false ? '' : runtime.mappingLabel?.trim()
  if (mappingLabel) return `${runtime.label} · ${mappingLabel}`
  return runtime.label
}

function newProjectSetupIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${PROJECT_SETUP_IDEMPOTENCY_PREFIX}:${globalThis.crypto.randomUUID()}`
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return `${PROJECT_SETUP_IDEMPOTENCY_PREFIX}:${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return `${PROJECT_SETUP_IDEMPOTENCY_PREFIX}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}

function normalizeWorkspaceProjectLocations(value: unknown): WorkspaceProjectLocationSummary[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    if (row.active === false) return []
    const locationId = typeof row.locationId === 'string' ? row.locationId.trim() : ''
    const label = typeof row.label === 'string' && row.label.trim()
      ? row.label.trim()
      : typeof row.locationLabel === 'string' ? row.locationLabel.trim() : ''
    if (!locationId || !label) return []
    const rawAvailability = typeof row.availability === 'string' ? row.availability.toLowerCase() : ''
    // A live catalogue result is more current than the replica's persisted
    // availability snapshot. In particular, `selectable: false` must make an
    // otherwise-online computer visibly unavailable.
    const availability = row.selectable === false
      ? 'unavailable'
      : row.selectable === true || rawAvailability === 'online'
        ? 'online'
        : 'unavailable'
    const visibility = row.visibility === 'private' || row.locationVisibility === 'private'
      ? 'private' as const
      : row.visibility === 'organization' || row.locationVisibility === 'organization'
        ? 'organization' as const
        : undefined
    const kind = row.kind === 'vps' || row.locationKind === 'vps'
      ? 'vps' as const
      : row.kind === 'computer' || row.locationKind === 'computer'
        ? 'computer' as const
        : undefined
    return [{
      ...(typeof row.replicaId === 'string' && row.replicaId.trim() ? { replicaId: row.replicaId.trim() } : {}),
      locationId,
      ...(typeof row.workspaceId === 'string' && row.workspaceId.trim() ? { workspaceId: row.workspaceId.trim() } : {}),
      label,
      availability,
      ...(typeof row.syncStatus === 'string' && row.syncStatus.trim() ? { syncStatus: row.syncStatus.trim() } : {}),
      ...(visibility ? { visibility } : {}),
      ...(kind ? { kind } : {}),
      ...(typeof row.platform === 'string' && row.platform.trim() ? { platform: row.platform.trim() } : {}),
      ...(row.canonical === true || row.isCanonical === true ? { canonical: true } : {}),
      authenticatedRuntime: row.authenticatedRuntime === true,
    }]
  })
}

function normalizeWorkspaceProjectSummaries(value: unknown): WorkspaceProjectSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!id || !name) return []
    const locations = normalizeWorkspaceProjectLocations(row.locations)
    return [{ id, name, ...(locations ? { locations } : {}) }]
  })
}

function normalizeManagedProjectLocations(value: unknown): ManagedProjectLocation[] {
  const locations = normalizeWorkspaceProjectLocations(value) ?? []
  return locations.flatMap((location) => location.replicaId ? [{
    replicaId: location.replicaId,
    locationId: location.locationId,
    label: location.label,
    availability: location.availability,
    ...(location.syncStatus ? { syncStatus: location.syncStatus } : {}),
    ...(location.visibility ? { visibility: location.visibility } : {}),
    ...(location.kind ? { kind: location.kind } : {}),
    ...(location.platform ? { platform: location.platform } : {}),
    ...(location.canonical ? { canonical: true } : {}),
    authenticatedRuntime: location.authenticatedRuntime === true,
  }] : [])
}

type ConversationScope = 'general' | 'project' | 'workspace' | 'task' | 'campaign' | 'company' | 'contact'

function composerHistoryStorageKey(orgId: string, conversationId: string): string {
  return `${COMPOSER_HISTORY_STORAGE_PREFIX}:${orgId}:${conversationId}`
}

function readComposerHistory(orgId: string, conversationId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(composerHistoryStorageKey(orgId, conversationId))
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .slice(-MAX_COMPOSER_HISTORY_ENTRIES)
  } catch {
    return []
  }
}

function writeComposerHistory(orgId: string, conversationId: string, entries: string[]): void {
  if (typeof window === 'undefined') return
  try {
    const key = composerHistoryStorageKey(orgId, conversationId)
    if (entries.length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(entries.slice(-MAX_COMPOSER_HISTORY_ENTRIES)))
  } catch (err) {
    void err
    // Best effort only: private browsing/storage failures should not break chat.
  }
}

function pinnedConversationsStorageKey(orgId: string): string {
  return `${PINNED_CONVERSATIONS_STORAGE_PREFIX}:${orgId}`
}

function readPinnedConversationIds(orgId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(pinnedConversationsStorageKey(orgId))
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  } catch {
    return []
  }
}

function writePinnedConversationIds(orgId: string, ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.trim().length > 0)))
    const key = pinnedConversationsStorageKey(orgId)
    if (uniqueIds.length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(uniqueIds))
  } catch (err) {
    void err
    // Best effort only: pinning is a local UI preference.
  }
}

function expandedSessionGroupsStorageKey(orgId: string): string {
  return `${EXPANDED_SESSION_GROUPS_STORAGE_PREFIX}:${orgId}`
}

function readExpandedSessionGroupKeys(orgId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(expandedSessionGroupsStorageKey(orgId))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function writeExpandedSessionGroupKeys(orgId: string, keys: string[]): void {
  if (typeof window === 'undefined') return
  try {
    const uniqueKeys = Array.from(new Set(keys.filter((key) => key.trim().length > 0)))
    const storageKey = expandedSessionGroupsStorageKey(orgId)
    if (uniqueKeys.length === 0) window.localStorage.removeItem(storageKey)
    else window.localStorage.setItem(storageKey, JSON.stringify(uniqueKeys))
  } catch (err) {
    void err
    // Best effort only: a storage failure must not block the session rail.
  }
}

function isProjectConversation(conversation: Conversation): boolean {
  return Boolean(conversationProjectIdentity(conversation))
}

function conversationProjectIdentity(conversation: Conversation): { id: string; name: string } | null {
  const workspaceProjectId = conversation.workspaceContext?.projectId?.trim()
  const scopeProjectId = conversation.scope === 'project' ? conversation.scopeRefId?.trim() : ''
  const contextProject = conversation.contextRefs?.find((ref) => ref.type === 'project')
  const id = workspaceProjectId || scopeProjectId || contextProject?.id?.trim()
  if (!id) return null
  return {
    id,
    name: conversation.workspaceContext?.projectName?.trim() || contextProject?.label?.trim() || 'Project',
  }
}

function conversationCompanyIdentity(conversation: Conversation): { id: string; name: string } | null {
  if (isProjectConversation(conversation)) return null
  const workspaceCompanyId = conversation.workspaceContext?.companyId?.trim()
  const scopeCompanyId = conversation.scope === 'company' ? conversation.scopeRefId?.trim() : ''
  const contextCompany = conversation.contextRefs?.find((ref) => ref.type === 'company')
  const id = workspaceCompanyId || scopeCompanyId || contextCompany?.id?.trim()
  if (!id) return null
  return {
    id,
    name: conversation.workspaceContext?.companyName?.trim() || contextCompany?.label?.trim() || 'Company Cowork',
  }
}

function isCompanyConversation(conversation: Conversation): boolean {
  return Boolean(conversationCompanyIdentity(conversation))
}

function isAgentConversation(conversation: Conversation): boolean {
  return conversation.orchestration?.mode === 'pip-orchestrator' || conversation.participantAgentIds.length > 0
}

function conversationWorkspaceIdentity(conversation: Conversation): { id: string; name: string } | null {
  if (isProjectConversation(conversation) || isCompanyConversation(conversation)) return null
  if (conversation.scope !== 'workspace') return null
  // ConversationListItem's client Conversation type only exposes a subset of
  // workspaceContext fields — stick to workspaceId / orgName / scopeRefId.
  const id = conversation.workspaceContext?.workspaceId?.trim()
    || conversation.scopeRefId?.trim()
    || conversation.orgId?.trim()
  if (!id) return null
  return {
    id,
    name: conversation.workspaceContext?.orgName?.trim() || 'Workspace',
  }
}

function conversationAgentIdentity(conversation: Conversation): { id: string; name: string } | null {
  if (isProjectConversation(conversation) || isCompanyConversation(conversation)) return null
  if (conversationWorkspaceIdentity(conversation)) return null
  if (!isAgentConversation(conversation)) return null
  const id = conversation.orchestration?.dispatcherAgentId
    || conversation.orchestration?.requestedAgentIds?.[0]
    || conversation.participantAgentIds[0]
  if (!id) return null
  const named = conversation.participants?.find(
    (participant) => participant.kind === 'agent' && participant.agentId === id,
  )
  return {
    id,
    name: (named && 'name' in named && typeof named.name === 'string' && named.name.trim())
      ? named.name.trim()
      : id,
  }
}

type ScopedConversationShareMode = 'private' | 'shared' | 'org'

function isScopedConversation(scope: ConversationScope): scope is 'workspace' | 'company' | 'project' {
  return scope === 'workspace' || scope === 'company' || scope === 'project'
}

function isWorkspaceSharedRuntime(target: WorkspaceRuntimePresence | null | undefined): boolean {
  return target?.visibility === 'organization' || target?.ownerType === 'organization'
}

function defaultScopedConversationShareMode(
  scope: ConversationScope,
  runtimeTarget: WorkspaceRuntimePresence | null,
): ScopedConversationShareMode {
  if (!isScopedConversation(scope)) return 'private'
  return isWorkspaceSharedRuntime(runtimeTarget) ? 'org' : 'private'
}

function normalizedScopedConversationShareMode(
  scope: ConversationScope,
  runtimeTarget: WorkspaceRuntimePresence | null,
  selectedShareMode: ScopedConversationShareMode,
): ScopedConversationShareMode {
  if (!isScopedConversation(scope)) return 'private'
  if (selectedShareMode === 'org' && !isWorkspaceSharedRuntime(runtimeTarget)) return 'private'
  return selectedShareMode
}

function buildHermesSessionSections(conversations: Conversation[], pinnedIds: string[]) {
  const pinnedSet = new Set(pinnedIds)
  // Same pool as before: everything except project/company folders.
  // Pinned wins over workspace/agent folders so favourites stay at the top.
  const core = conversations.filter((conversation) =>
    !conversation.archived
    && !isProjectConversation(conversation)
    && !isCompanyConversation(conversation))
  const pinned = core.filter((conversation) => pinnedSet.has(conversation.id))
  const unpinned = core.filter((conversation) => !pinnedSet.has(conversation.id))
  const recent = unpinned.filter((conversation) =>
    !conversationWorkspaceIdentity(conversation)
    && !conversationAgentIdentity(conversation))

  return [
    { id: 'pinned', label: 'Pinned', conversations: pinned },
    { id: 'recent', label: 'Recent', conversations: recent },
  ].filter((section) => section.conversations.length > 0)
}

function isOrganisationWorkspace(workspace: OrgWorkspaceSummary): boolean {
  // Company Cowork provision writes org_workspaces rows with companyId + client
  // orgName (e.g. "Scholtz Inc"). Those sessions belong under Cowork folders only.
  return !workspace.companyId?.trim()
}

function buildHermesWorkspaceGroups(
  conversations: Conversation[],
  workspaces: OrgWorkspaceSummary[],
  filter: string,
  pinnedIds: string[] = [],
) {
  const pinnedSet = new Set(pinnedIds)
  // Only organisation-root Workspaces. Company-linked trees are not Workspaces
  // in the Messages rail — they surface under Cowork folders via company scope.
  const organisationWorkspaces = workspaces.filter(isOrganisationWorkspace)
  const companyWorkspaceIds = new Set(
    workspaces
      .filter((workspace) => !isOrganisationWorkspace(workspace))
      .map((workspace) => workspace.workspaceId),
  )
  const groups = new Map<string, { id: string; name: string; conversations: Conversation[] }>()
  for (const workspace of organisationWorkspaces) {
    groups.set(workspace.workspaceId, {
      id: workspace.workspaceId,
      name: workspace.orgName || workspace.orgSlug || 'Workspace',
      conversations: [],
    })
  }
  for (const conversation of conversations) {
    if (conversation.archived || pinnedSet.has(conversation.id)) continue
    const workspace = conversationWorkspaceIdentity(conversation)
    if (!workspace) continue
    // Never promote a company Cowork workspace into the Workspaces rail, even
    // if a conversation only has workspace scope metadata without companyId.
    if (companyWorkspaceIds.has(workspace.id)) continue
    const group = groups.get(workspace.id) ?? { ...workspace, conversations: [] }
    if (!groups.has(workspace.id)) group.name = workspace.name
    group.conversations.push(conversation)
    groups.set(workspace.id, group)
  }

  const query = filter.trim().toLocaleLowerCase()
  if (!query) {
    return Array.from(groups.values()).filter((group) =>
      group.conversations.length > 0
      || organisationWorkspaces.some((w) => w.workspaceId === group.id))
  }
  return Array.from(groups.values()).flatMap((group) => {
    if (group.name.toLocaleLowerCase().includes(query)) return [group]
    const matches = group.conversations.filter((conversation) => [
      conversation.title,
      conversation.lastMessagePreview,
      conversation.workspaceContext?.runtimeLabel,
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
    return matches.length > 0 ? [{ ...group, conversations: matches }] : []
  })
}

function buildHermesAgentGroups(
  conversations: Conversation[],
  visibleAgents: AgentTeamDoc[],
  filter: string,
  pinnedIds: string[] = [],
) {
  const pinnedSet = new Set(pinnedIds)
  const groups = new Map<string, { id: string; name: string; conversations: Conversation[] }>()
  for (const agent of visibleAgents) {
    if (agent.enabled === false) continue
    groups.set(agent.agentId, { id: agent.agentId, name: agent.name || agent.agentId, conversations: [] })
  }
  for (const conversation of conversations) {
    if (conversation.archived || pinnedSet.has(conversation.id)) continue
    const agent = conversationAgentIdentity(conversation)
    if (!agent) continue
    const group = groups.get(agent.id) ?? { ...agent, conversations: [] }
    if (!group.name || group.name === agent.id) group.name = agent.name
    group.conversations.push(conversation)
    groups.set(agent.id, group)
  }

  const query = filter.trim().toLocaleLowerCase()
  if (!query) return Array.from(groups.values())
  return Array.from(groups.values()).flatMap((group) => {
    if (group.name.toLocaleLowerCase().includes(query) || group.id.toLocaleLowerCase().includes(query)) {
      return [group]
    }
    const matches = group.conversations.filter((conversation) => [
      conversation.title,
      conversation.lastMessagePreview,
      conversation.workspaceContext?.runtimeLabel,
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
    return matches.length > 0 ? [{ ...group, conversations: matches }] : []
  })
}

function buildHermesCompanyGroups(
  conversations: Conversation[],
  workspaces: OrgWorkspaceSummary[],
  filter: string,
) {
  const groups = new Map<string, { id: string; name: string; conversations: Conversation[] }>()

  // Seed from company-linked Workspace catalogue so Cowork folders remain
  // visible even when no company-scope chat is in the current conversation page.
  for (const workspace of workspaces) {
    const companyId = workspace.companyId?.trim()
    if (!companyId) continue
    groups.set(companyId, {
      id: companyId,
      name: workspace.orgName?.trim() || workspace.orgSlug || 'Company Cowork',
      conversations: [],
    })
  }

  for (const conversation of conversations) {
    if (conversation.archived) continue
    const company = conversationCompanyIdentity(conversation)
      || conversationCompanyIdentityFromProject(conversation)
    if (!company) continue
    const group = groups.get(company.id) ?? { ...company, conversations: [] }
    // Prefer a concrete companyName from live chat context over catalogue labels.
    if (company.name && company.name !== 'Company Cowork') group.name = company.name
    if (conversationCompanyIdentity(conversation)) {
      group.conversations.push(conversation)
    }
    groups.set(company.id, group)
  }

  const values = Array.from(groups.values()).sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))

  const query = filter.trim().toLocaleLowerCase()
  if (!query) return values
  return values.flatMap((group) => {
    if (group.name.toLocaleLowerCase().includes(query)) return [group]
    const matches = group.conversations.filter((conversation) => [
      conversation.title,
      conversation.lastMessagePreview,
      conversation.workspaceContext?.runtimeLabel,
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
    return matches.length > 0 ? [{ ...group, conversations: matches }] : []
  })
}

/** Project sessions still belong to a company Cowork root — surface the folder even when only project chats exist. */
function conversationCompanyIdentityFromProject(conversation: Conversation): { id: string; name: string } | null {
  if (!isProjectConversation(conversation)) return null
  const id = conversation.workspaceContext?.companyId?.trim()
    || conversation.contextRefs?.find((ref) => ref.type === 'company')?.id?.trim()
  if (!id) return null
  return {
    id,
    name: conversation.workspaceContext?.companyName?.trim()
      || conversation.contextRefs?.find((ref) => ref.type === 'company')?.label?.trim()
      || 'Company Cowork',
  }
}

function buildHermesProjectGroups(
  conversations: Conversation[],
  projects: WorkspaceProjectSummary[],
  filter: string,
) {
  const groups = new Map<string, {
    id: string
    name: string
    companyId: string | null
    locations?: WorkspaceProjectLocationSummary[]
    conversations: Conversation[]
  }>()
  for (const project of projects) {
    groups.set(project.id, {
      id: project.id,
      name: project.name,
      companyId: null,
      ...(project.locations ? { locations: project.locations } : {}),
      conversations: [],
    })
  }
  for (const conversation of conversations) {
    if (conversation.archived) continue
    const project = conversationProjectIdentity(conversation)
    if (!project) continue
    const group = groups.get(project.id)
    if (!group) continue
    group.conversations.push(conversation)
    if (!group.companyId) {
      const companyId = conversation.workspaceContext?.companyId?.trim() || null
      if (companyId) group.companyId = companyId
    }
  }

  const query = filter.trim().toLocaleLowerCase()
  if (!query) return Array.from(groups.values())
  return Array.from(groups.values()).flatMap((group) => {
    if (group.name.toLocaleLowerCase().includes(query)
      || group.locations?.some((location) => location.label.toLocaleLowerCase().includes(query))) return [group]
    const conversations = group.conversations.filter((conversation) => [
      conversation.title,
      conversation.lastMessagePreview,
      conversation.workspaceContext?.runtimeLabel,
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
    return conversations.length > 0 ? [{ ...group, conversations }] : []
  })
}

function validateConversationAttachment(file: File): string | null {
  const type = (file.type || 'application/octet-stream').toLowerCase()
  if (!ALLOWED_ATTACHMENT_MIME.has(type)) return `Unsupported file type: ${file.name}`
  if (file.size > MAX_ATTACHMENT_BYTES) return `File too large: ${file.name} (max 10MB)`
  return null
}

function splitValidConversationAttachments(files: File[]): { validFiles: File[]; errors: string[] } {
  const validFiles: File[] = []
  const errors: string[] = []
  for (const file of files) {
    const error = validateConversationAttachment(file)
    if (error) errors.push(error)
    else validFiles.push(file)
  }
  return { validFiles, errors }
}

export function formatConversationAttachmentUploadError(error: unknown, fileName: string): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  const lower = raw.toLowerCase()
  const host = typeof window !== 'undefined' ? window.location.host : ''
  const onVercelPreview = /\.vercel\.app$/i.test(host) || /vercel\.app/i.test(host)
  const onProductionHost = /(^|\.)partnersinbiz\.online$/i.test(host)

  if (
    lower.includes('authentication required') ||
    lower.includes('deployment protection') ||
    lower.includes('vercel authentication')
  ) {
    return onProductionHost
      ? `Could not upload ${fileName}: session was rejected (${raw.slice(0, 120)}). Sign out and sign back into https://partnersinbiz.online, then try again.`
      : `Upload blocked for ${fileName}: this deployment is SSO/protected (${host || 'unknown host'}). Open https://partnersinbiz.online while logged in, or open the preview with Vercel protection bypass, then try again.`
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('err_access_denied')
  ) {
    if (onVercelPreview) {
      return `Upload blocked before the app could receive ${fileName}. You are on a Vercel preview (${host}), which is often SSO-protected and cannot accept uploads without a bypass cookie. Open https://partnersinbiz.online (production) while logged in and send from there.`
    }
    if (onProductionHost) {
      return `Could not upload ${fileName}: the browser lost the network/session mid-request. Hard-refresh https://partnersinbiz.online, confirm you are still signed in, and try again (or send the message without the attachment first).`
    }
    return `Upload blocked before the app could receive ${fileName}. Network/session failure on ${host || 'this host'}. Prefer https://partnersinbiz.online while logged in.`
  }

  if (lower === 'unauthorized' || lower.includes('unauthorized') || lower.includes('(401')) {
    return `Could not upload ${fileName}: you are not authenticated for this session. Sign in again on https://partnersinbiz.online and retry.`
  }

  return raw || `Upload failed: ${fileName}`
}

export function shouldStopFinalizePollingForStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404
}

/** True when the server message is already terminal — stop waiting on SSE/finalize UI. */
export function shouldAdoptServerMessageDuringFinalizePoll(
  serverMessage: { status?: string } | null | undefined,
): boolean {
  const status = serverMessage?.status
  if (!status) return false
  return status !== 'queued' && status !== 'pending' && status !== 'streaming' && status !== 'waiting_approval'
}

export function formatLiveMessageRefreshError(error: unknown): string | null {
  // Intentional abort (conversation switch / superseded poll) — do not toast.
  const aborted = formatClientNetworkError(error, '')
  if (aborted === null) return null
  if (isNetworkFetchFailure(error) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return formatClientNetworkError(
      error,
      'Live message refresh failed. The agent may still be working — this view will keep retrying.',
    )
  }
  const raw = error instanceof Error ? error.message : String(error || '')
  const lower = raw.toLowerCase()
  if (lower.includes('load messages')) {
    return 'Live message refresh failed. The agent may still be working — this view will keep retrying.'
  }
  return raw || 'Failed to load messages'
}

async function readApiResponse(res: Response): Promise<Record<string, unknown>> {
  if (typeof res.text === 'function') {
    const text = await res.text().catch(() => '')
    if (!text) return {}
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return { error: text.slice(0, 240) }
    }
  }
  if (typeof res.json === 'function') {
    return await res.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  }
  return {}
}

export async function uploadConversationAttachment(convId: string, file: File): Promise<ConversationAttachment> {
  const form = new FormData()
  form.append('file', file)

  try {
    const res = await fetch(`/api/v1/conversations/${convId}/attachments`, {
      method: 'POST',
      body: form,
    })
    const body = await readApiResponse(res)
    const data = body.data as Partial<ConversationAttachment & { storagePath?: string }> | undefined
    if (!res.ok || !data?.url) {
      const statusCopy = res.status ? ` (${res.status}${res.statusText ? ` ${res.statusText}` : ''})` : ''
      const bodyError = typeof body.error === 'string' ? body.error : ''
      throw new Error(formatConversationAttachmentUploadError(bodyError || `Upload failed${statusCopy}: ${file.name}`, file.name))
    }

    return {
      id: data.id as string,
      name: data.name ?? file.name,
      url: data.url,
      contentType: data.contentType ?? file.type,
      sizeBytes: data.sizeBytes ?? file.size,
      ...(data.storagePath ? { storagePath: data.storagePath } : {}),
    }
  } catch (err) {
    throw new Error(formatConversationAttachmentUploadError(err, file.name))
  }
}

function tsSeconds(ts: ConversationMessage['createdAt']): number {
  if (!ts) return 0
  if (typeof ts === 'string') return Date.parse(ts) / 1000
  return (ts as { seconds?: number; _seconds?: number }).seconds ??
    (ts as { seconds?: number; _seconds?: number })._seconds ?? 0
}

function hasSameAttachments(a: ConversationMessage, b: ConversationMessage): boolean {
  const aAttachments = a.attachments ?? []
  const bAttachments = b.attachments ?? []
  if (aAttachments.length !== bAttachments.length) return false
  if (aAttachments.length === 0) return true
  return aAttachments.every((item, index) =>
    item.id === bAttachments[index]?.id &&
    item.name === bAttachments[index]?.name &&
    item.contentType === bAttachments[index]?.contentType,
  )
}

function isServerRowForOptimisticMessage(
  serverMessage: ConversationMessage,
  optimisticMessage: ConversationMessage,
): boolean {
  if (serverMessage.id.startsWith('tmp-')) return false
  if (serverMessage.role !== optimisticMessage.role) return false
  if (serverMessage.authorKind !== optimisticMessage.authorKind) return false
  if (serverMessage.content !== optimisticMessage.content) return false
  if (!hasSameAttachments(serverMessage, optimisticMessage)) return false

  if (optimisticMessage.authorKind === 'user' && serverMessage.authorId !== optimisticMessage.authorId) {
    return false
  }
  const serverTs = tsSeconds(serverMessage.createdAt)
  const optimisticTs = tsSeconds(optimisticMessage.createdAt)
  if (serverTs > 0 && optimisticTs > 0) {
    if (Math.abs(serverTs - optimisticTs) > 10) return false
  }

  if (optimisticMessage.role === 'assistant' && optimisticMessage.authorId === 'pending') {
    return serverMessage.content === optimisticMessage.content
  }

  return true
}

function mergeSnapshotMessages(
  snapshotMessages: ConversationMessage[],
  currentMessages: ConversationMessage[],
): ConversationMessage[] {
  const optimisticMessages = currentMessages.filter((message) => message.id.startsWith('tmp-'))
  const keptOptimistic = optimisticMessages.filter((optimisticMessage) =>
    !snapshotMessages.some((snapshotMessage) =>
      isServerRowForOptimisticMessage(snapshotMessage, optimisticMessage),
    ),
  )
  return [...snapshotMessages, ...keptOptimistic]
}

function appendRichItems<T>(current: T[] | undefined, incoming: T[] | undefined): T[] | undefined {
  if (!incoming?.length) return current
  const merged = [...(current ?? []), ...incoming]
  const seen = new Set<string>()
  return merged.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function contextChipLabel(ref: ContextReference | ContextReferenceSeed): string {
  return ref.label?.trim() || `${ref.type}:${ref.id}`
}

function mergeContextRefs(existing: ContextReference[], incoming: ContextReference[]): ContextReference[] {
  const refs = new Map<string, ContextReference>()
  for (const ref of [...existing, ...incoming]) refs.set(contextReferenceKey(ref), ref)
  return Array.from(refs.values()).slice(0, MAX_CONTEXT_REFS)
}

export function findRelatedConversationId(
  conversations: Array<Pick<Conversation, 'id' | 'contextRefs'>>,
  context: Pick<ContextReferenceSeed, 'type' | 'id'>,
): string | null {
  return conversations.find((conversation) =>
    conversation.contextRefs?.some((ref) => ref.type === context.type && ref.id === context.id),
  )?.id ?? null
}

export default function UnifiedChat({
  orgId,
  currentUserUid,
  currentUserDisplayName,
  userRole,
  orgName,
  projectId,
  scope,
  scopeRefId,
  initialConvId,
  initialAgentId,
  autoCreateScopedConversation = false,
  autoCreateTitle,
  allowDeleteConversations = false,
  allowStopRuns = true,
  allowManageConversationAccess = false,
  allowAgentParticipants = true,
  allowStartConversations = true,
  allowSendMessages = true,
  allowArchiveConversations = true,
  currentPageContext,
  preferCurrentPageContext = false,
  includeAllScopes = false,
  onContextActionResolved,
  compact = false,
  layoutVariant = 'classic',
  activeConversationId,
  onActiveConversationChange,
  onConversationsChange,
  onConversationLifecycle,
  onRealtimeGatewayConnectionChange,
  onConversationRealtimeInvalidation,
  syncedConversationTitles,
  showConversationList = true,
  conversationRailMode = 'expanded',
  onConversationRailModeChange,
  onContextCanvasPresentationChange,
  showAgentWorkbench = false,
}: UnifiedChatProps) {
  // ── State ─────────────────────────────────────────────────────────────────
  const realtimeGatewayClientId = useId()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationsHydrated, setConversationsHydrated] = useState(false)
  const [uncontrolledActiveId, setUncontrolledActiveId] = useState<string | null>(null)
  const activeId = activeConversationId === undefined ? uncontrolledActiveId : activeConversationId
  const activeConversationIdRef = useRef(activeId)
  activeConversationIdRef.current = activeId
  // Tracks which conversation owns the live composer fields so switches cannot
  // carry an unsent draft/attachment/picker into the next chat.
  const composerStateConversationIdRef = useRef(activeId)
  const composerDraftsByConversationRef = useRef(new Map<string, { text: string; attachments: File[] }>())
  const setActiveId = useCallback((value: string | null) => {
    if (activeConversationId === undefined) setUncontrolledActiveId(value)
    onActiveConversationChange?.(value)
  }, [activeConversationId, onActiveConversationChange])
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [contextCanvasPresentation, setContextCanvasPresentation] = useState<{ open: boolean; mode: 'single' | 'dual'; width: number }>({ open: false, mode: 'single', width: 520 })
  const contextCanvasOpen = contextCanvasPresentation.open
  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('files')
  const [workbenchWidth, setWorkbenchWidth] = useState(480)
  const [workbenchStateConversationId, setWorkbenchStateConversationId] = useState<string | null>(null)
  const [workbenchLiveFiles, setWorkbenchLiveFiles] = useState<{ source: WorkbenchFilesSource; tree: WorkbenchFileNode[] }>({
    source: 'none',
    tree: [],
  })
  const [workbenchFilesLoading, setWorkbenchFilesLoading] = useState(false)
  const [workbenchFilesMessage, setWorkbenchFilesMessage] = useState<string | null>(null)
  const [workbenchSelectedFilePath, setWorkbenchSelectedFilePath] = useState<string | null>(null)
  const [workbenchFilePreview, setWorkbenchFilePreview] = useState<WorkbenchFilePreview | null>(null)
  const [workbenchLiveChanges, setWorkbenchLiveChanges] = useState<WorkbenchChangeFile[] | null>(null)
  const [workbenchChangesMessage, setWorkbenchChangesMessage] = useState<string | null>(null)
  const [workbenchChangesLoading, setWorkbenchChangesLoading] = useState(false)
  const [workbenchLocalTerminalEntries, setWorkbenchLocalTerminalEntries] = useState<WorkbenchTerminalEntry[]>([])
  const [workbenchTerminalRunning, setWorkbenchTerminalRunning] = useState(false)
  const [workbenchTerminalMode, setWorkbenchTerminalMode] = useState<WorkbenchTerminalMode>('jobs')
  const [workbenchSession, setWorkbenchSession] = useState<WorkbenchSessionViewState | null>(null)
  const [workbenchSessionHistory, setWorkbenchSessionHistory] = useState<WorkbenchSessionViewState[]>([])
  const workbenchSessionTranscriptRef = useRef<WorkbenchSessionTranscriptState>({ text: '', lastSeq: -1 })
  const workbenchSessionAbortRef = useRef<AbortController | null>(null)
  const [workbenchTunnel, setWorkbenchTunnel] = useState<WorkbenchTunnelViewState | null>(null)
  const workbenchTunnelAbortRef = useRef<AbortController | null>(null)
  const [workbenchBrowserSession, setWorkbenchBrowserSession] = useState<WorkbenchBrowserSessionViewState | null>(null)
  const workbenchBrowserSessionProgressRef = useRef<WorkbenchBrowserSessionProgressState>(EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS)
  const workbenchBrowserSessionAbortRef = useRef<AbortController | null>(null)
  // Device-side frame following, driven by the Browser panel's Follow toggle.
  const [workbenchBrowserFollowing, setWorkbenchBrowserFollowing] = useState(false)
  /** Ref mirror of `workbenchBrowserFollowing` so the stable `applyWorkbenchBrowserSessionUpdate` callback can stamp the view state. */
  const workbenchBrowserFollowingRef = useRef(false)
  const [workbenchBrowserSnapshotText, setWorkbenchBrowserSnapshotText] = useState<string | null>(null)
  const [workbenchBrowserSnapshotLoading, setWorkbenchBrowserSnapshotLoading] = useState(false)
  /** Session ids whose agent-preview tab was already opened — auto-open exactly once per session ("offer, don't hijack"). */
  const workbenchBrowserAutoOpenedRef = useRef<Set<string>>(new Set())
  const [contextCanvasCloseRequest, setContextCanvasCloseRequest] = useState(0)
  // Icon strip stays visible whenever the workbench is enabled; expand margin when a dock opens.
  const rightDockOpen = contextCanvasOpen || workbenchOpen || showAgentWorkbench
  const rightDockWidth = workbenchOpen
    ? workbenchWidth + 40
    : contextCanvasOpen
      ? contextCanvasPresentation.width
      : showAgentWorkbench
        ? 40
        : contextCanvasPresentation.width
  const contextCanvasReservedStyle = {
    '--context-canvas-width': `${rightDockWidth}px`,
  } as CSSProperties
  const handleContextCanvasPresentationChange = useCallback((state: { open: boolean; mode: 'single' | 'dual'; width: number }) => {
    setContextCanvasPresentation(state)
    if (state.open) setWorkbenchOpen(false)
    onContextCanvasPresentationChange?.(state)
  }, [onContextCanvasPresentationChange])
  const handleWorkbenchOpenChange = useCallback((open: boolean) => {
    setWorkbenchOpen(open)
    if (open) setContextCanvasCloseRequest((revision) => revision + 1)
  }, [])
  const openWorkbenchTab = useCallback((tab: WorkbenchTab) => {
    setWorkbenchTab(tab)
    handleWorkbenchOpenChange(true)
  }, [handleWorkbenchOpenChange])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [contextRefs, setContextRefs] = useState<ContextReference[]>([])
  const [contextMention, setContextMention] = useState<ActiveContextMention | null>(null)
  const [contextTypePrompt, setContextTypePrompt] = useState<ActiveContextTypePrompt | null>(null)
  const [slashPrompt, setSlashPrompt] = useState<ActiveSlashCommandPrompt | null>(null)
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<SlashCommandDefinition | null>(null)
  const [designMenuOpen, setDesignMenuOpen] = useState(false)
  const [contextSearchResults, setContextSearchResults] = useState<ContextReference[]>([])
  const [agentMentionResults, setAgentMentionResults] = useState<Array<{ agentId: string; label: string; summary?: string }>>([])
  const [contextSearchLoading, setContextSearchLoading] = useState(false)
  const [contextSearchMessage, setContextSearchMessage] = useState<string | null>(null)
  const [contextPickerActiveIndex, setContextPickerActiveIndex] = useState(0)
  const [agentEffort, setAgentEffort] = useState<AgentEffort | ''>('')
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('ask')
  const approvalModeRef = useRef<ApprovalMode>('ask')
  useEffect(() => { approvalModeRef.current = approvalMode }, [approvalMode])
  useEffect(() => {
    try {
      const stored = cleanApprovalMode(window.localStorage.getItem(`${APPROVAL_MODE_STORAGE_PREFIX}:${orgId}`))
      if (stored) setApprovalMode(stored)
    } catch {
      // Ignore localStorage read failures.
      return
    }
  }, [orgId])
  useEffect(() => {
    try {
      window.localStorage.setItem(`${APPROVAL_MODE_STORAGE_PREFIX}:${orgId}`, approvalMode)
    } catch {
      // Ignore localStorage write failures.
      return
    }
  }, [approvalMode, orgId])
  const [modelCatalog, setModelCatalog] = useState<MessageModelCatalog | null>(null)
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false)
  const [selectedRuntime, setSelectedRuntime] = useState<ModelRuntimeSelection | null>(null)
  const [composerHistory, setComposerHistory] = useState<string[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [queuedDraftsByConversation, setQueuedDraftsByConversation] = useState<Record<string, QueuedComposerDraft[]>>({})
  const [executionDockRequest, setExecutionDockRequest] = useState(0)
  const [contextArtifactRequest, setContextArtifactRequest] = useState<{ id: string; nonce: number }>()
  const [contextFocusRequest, setContextFocusRequest] = useState<{ kind: ContextReference['type']; id: string; projectId?: string; nonce: number }>()
  // Fingerprint recent messages so Context Dock previews soft-reload when agents update records.
  const contextPreviewRefreshSignal = useMemo(() => {
    if (messages.length === 0) return 0
    let hash = messages.length * 17
    for (const message of messages.slice(-8)) {
      const record = message as ConversationMessage & {
        updatedAt?: string
        ui_actions?: unknown[]
      }
      hash = (hash * 31 + String(message.id ?? '').length) | 0
      hash = (hash * 31 + String(message.content ?? '').length) | 0
      hash = (hash * 31 + String(message.status ?? '').length) | 0
      hash = (hash * 31 + String(record.updatedAt ?? message.createdAt ?? '').length) | 0
      const refs = Array.isArray(message.contextRefs) ? message.contextRefs.length : 0
      const actions = Array.isArray(message.uiActions)
        ? message.uiActions.length
        : Array.isArray(record.ui_actions)
          ? record.ui_actions.length
          : 0
      hash = (hash * 31 + refs * 13 + actions * 19) | 0
    }
    return Math.abs(hash)
  }, [messages])
  const handledOpenContextActionsRef = useRef(new Set<string>())
  const previousContextCanvasOpenRef = useRef(contextCanvasOpen)
  useEffect(() => {
    // Drop sticky open_context/artifact focus once the human closes the dock so a later
    // remount or setActiveContext churn cannot auto-reopen the same preview.
    if (previousContextCanvasOpenRef.current && !contextCanvasOpen) {
      setContextFocusRequest(undefined)
      setContextArtifactRequest(undefined)
    }
    previousContextCanvasOpenRef.current = contextCanvasOpen
  }, [contextCanvasOpen])
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>(() => readPinnedConversationIds(orgId))
  const [expandedSessionGroupKeys, setExpandedSessionGroupKeys] = useState<string[]>(() => readExpandedSessionGroupKeys(orgId))

  useEffect(() => {
    onConversationsChange?.(conversations)
  }, [conversations, onConversationsChange])

  useEffect(() => {
    setWorkbenchOpen(false)
    setWorkbenchTab('files')
    setWorkbenchWidth(480)
    setWorkbenchLiveFiles({ source: 'none', tree: [] })
    setWorkbenchFilesMessage(null)
    setWorkbenchSelectedFilePath(null)
    setWorkbenchFilePreview(null)
    setWorkbenchLiveChanges(null)
    setWorkbenchChangesMessage(null)
    setWorkbenchLocalTerminalEntries([])
    setWorkbenchTerminalRunning(false)
    if (!activeId) {
      setWorkbenchStateConversationId(null)
      return
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(`pib-messages-workbench:${orgId}:${activeId}`) ?? '{}') as { tab?: unknown; width?: unknown }
      if (stored.tab === 'files' || stored.tab === 'terminal' || stored.tab === 'browser' || stored.tab === 'changes') setWorkbenchTab(stored.tab)
      if (typeof stored.width === 'number' && Number.isFinite(stored.width)) setWorkbenchWidth(Math.min(720, Math.max(420, stored.width)))
    } catch {
      // Ignore corrupt or unavailable browser storage.
      return
    }
    setWorkbenchStateConversationId(activeId)
  }, [activeId, orgId])

  useEffect(() => {
    if (!activeId || workbenchStateConversationId !== activeId) return
    try {
      window.localStorage.setItem(`pib-messages-workbench:${orgId}:${activeId}`, JSON.stringify({ tab: workbenchTab, width: workbenchWidth }))
    } catch {
      // Ignore browser storage failures.
      return
    }
  }, [activeId, orgId, workbenchStateConversationId, workbenchTab, workbenchWidth])

  useEffect(() => {
    if (!syncedConversationTitles) return
    setConversations((prev) => {
      let changed = false
      const next = prev.map((conversation) => {
        const title = syncedConversationTitles[conversation.id]
        if (!title || title === conversation.title) return conversation
        changed = true
        return { ...conversation, title }
      })
      return changed ? next : prev
    })
  }, [syncedConversationTitles])

  // Agent map for looking up colorKey / iconKey for bubbles (org catalogue).
  const [agentMap, setAgentMap] = useState<Record<AgentId, AgentTeamDoc>>({} as Record<AgentId, AgentTeamDoc>)
  // @agent: picker candidates for the *active chat's* bound computer — not a global roster.
  const [mentionAgents, setMentionAgents] = useState<AgentTeamDoc[]>([])
  const [mentionAgentsStatus, setMentionAgentsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [mentionAgentsEmptyReason, setMentionAgentsEmptyReason] = useState<string | null>(null)
  const [conversationLiveConnected, setConversationLiveConnected] = useState(false)
  const [conversationRealtimeGatewayReady, setConversationRealtimeGatewayReady] = useState(false)
  const [conversationPageVisible, setConversationPageVisible] = useState(true)
  const [threadPresence, setThreadPresence] = useState<ConversationPresence[]>([])
  const presenceTypingRef = useRef(false)

  // Live events keyed by assistant message id
  const [liveEvents, setLiveEvents] = useState<Record<string, ChatEvent[]>>({})
  const liveEventsRef = useRef<Record<string, ChatEvent[]>>({})
  useEffect(() => { liveEventsRef.current = liveEvents }, [liveEvents])

  // Approval state keyed by message id
  const [approvalPending, setApprovalPending] = useState<
    Record<string, { runId: string; agentId: AgentId; toolName?: string }>
  >({})

  // Conversation context menu
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<ConversationMenuPosition | null>(null)
  const [accessConversation, setAccessConversation] = useState<Conversation | null>(null)

  const openConversationRowMenu = useCallback((conversationId: string, anchor: HTMLElement) => {
    if (menuOpenId === conversationId) {
      setMenuOpenId(null)
      setMenuPosition(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    setMenuPosition(computeConversationMenuPosition(rect))
    setMenuOpenId(conversationId)
  }, [menuOpenId])

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameCancelledRef = useRef(false)

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newParticipants, setNewParticipants] = useState<SelectedParticipant[]>([])
  const [newInitialAgentIds, setNewInitialAgentIds] = useState<string[]>([])
  const [newScope, setNewScope] = useState<ConversationScope>(
    scope ?? (projectId ? 'project' : 'general'),
  )
  const [workspaces, setWorkspaces] = useState<OrgWorkspaceSummary[]>([])
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectSummary[]>([])
  const [workspaceRuntimeTargetsByWorkspace, setWorkspaceRuntimeTargetsByWorkspace] = useState<Record<string, WorkspaceRuntimePresence[]>>({})
  const [workspaceRuntimeTargetsByAgent, setWorkspaceRuntimeTargetsByAgent] = useState<Partial<Record<AgentId, Record<string, WorkspaceRuntimePresence[]>>>>({})
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [workspaceCatalogueLoaded, setWorkspaceCatalogueLoaded] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '')
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    scope === 'company' && scopeRefId ? scopeRefId : '',
  )
  const [selectedCompanyName, setSelectedCompanyName] = useState(
    scope === 'company' && orgName?.trim() ? orgName.trim() : '',
  )
  const [selectedWorkspaceRuntime, setSelectedWorkspaceRuntime] = useState<string>('')
  const workspaceRuntimeExplicitRef = useRef(false)
  const selectedWorkspaceShareModeTouchedRef = useRef(false)
  const [selectedWorkspaceShareMode, setSelectedWorkspaceShareMode] = useState<'private' | 'shared' | 'org'>('private')
  const [newConversationWorkforceBlueprintId, setNewConversationWorkforceBlueprintId] = useState('')
  const companyCoworkLocked = scope === 'company' && Boolean(scopeRefId)
  const [showProjectSetupWizard, setShowProjectSetupWizard] = useState(false)
  const [projectSetupMode, setProjectSetupMode] = useState<ProjectSetupMode>('existing_folder')
  const [projectSetupCompanyId, setProjectSetupCompanyId] = useState('')
  const [projectSetupCompanyName, setProjectSetupCompanyName] = useState('')
  const [projectSetupExistingProjects, setProjectSetupExistingProjects] = useState<Array<{ id: string; name: string; added: boolean }>>([])
  const [projectSetupLibraryLoading, setProjectSetupLibraryLoading] = useState(false)
  const [projectSetupAddingProjectId, setProjectSetupAddingProjectId] = useState('')
  const [projectSetupName, setProjectSetupName] = useState('')
  const [projectSetupWorkspaceId, setProjectSetupWorkspaceId] = useState('')
  const [projectSetupWorkspaceFolderId, setProjectSetupWorkspaceFolderId] = useState('')
  const [projectSetupLocationIds, setProjectSetupLocationIds] = useState<string[]>([])
  const [projectSetupClientName, setProjectSetupClientName] = useState('')
  const [projectSetupDomainSlug, setProjectSetupDomainSlug] = useState('')
  const [projectSetupAgentName, setProjectSetupAgentName] = useState('Pip')
  const [registeredWorkspaceFolders, setRegisteredWorkspaceFolders] = useState<RegisteredWorkspaceFolder[]>([])
  const [registeredWorkspaceFoldersLoading, setRegisteredWorkspaceFoldersLoading] = useState(false)
  const [projectSetupSubmitting, setProjectSetupSubmitting] = useState(false)
  const [projectSetupError, setProjectSetupError] = useState<string | null>(null)
  const [projectSetupResult, setProjectSetupResult] = useState<ProjectSetupResultView | null>(null)
  const projectSetupIdempotencyKeyRef = useRef('')
  const refreshWorkspaceCatalogueRef = useRef<() => Promise<WorkspaceCatalogueSnapshot | null>>(async () => null)
  const [managedProject, setManagedProject] = useState<{ id: string; name: string } | null>(null)
  const [accessProject, setAccessProject] = useState<{ id: string; name: string } | null>(null)
  const [projectActionsOpenId, setProjectActionsOpenId] = useState<string | null>(null)
  const [folderActionsOpenKey, setFolderActionsOpenKey] = useState<string | null>(null)
  const [hiddenFolderKeys, setHiddenFolderKeys] = useState<string[]>([])
  const [hiddenFolderPreferencesLoaded, setHiddenFolderPreferencesLoaded] = useState(false)
  const [hiddenFolderPreferencesSaving, setHiddenFolderPreferencesSaving] = useState(false)
  const [showHiddenFolders, setShowHiddenFolders] = useState(false)
  const hiddenFolderMutationInFlightRef = useRef(false)
  const activeHiddenFolderOrgIdRef = useRef(orgId)
  activeHiddenFolderOrgIdRef.current = orgId
  const [managedProjectLocations, setManagedProjectLocations] = useState<ManagedProjectLocation[]>([])
  const [selectedManagedProjectLocationKeys, setSelectedManagedProjectLocationKeys] = useState<string[]>([])
  const [projectLocationsLoading, setProjectLocationsLoading] = useState(false)
  const [projectLocationsMutating, setProjectLocationsMutating] = useState(false)
  const [projectLocationsError, setProjectLocationsError] = useState<string | null>(null)
  const [projectSyncLoading, setProjectSyncLoading] = useState(false)
  const [projectSyncSubmitting, setProjectSyncSubmitting] = useState(false)
  const [projectSyncResetting, setProjectSyncResetting] = useState(false)
  const [managedProjectSync, setManagedProjectSync] = useState<ManagedProjectSyncState | null>(null)
  const projectSyncInFlightRef = useRef(false)
  const projectSyncRefreshInFlightRef = useRef(false)
  const [creatingConv, setCreatingConv] = useState(false)
  const newConversationRuntimeAgentId = useMemo<AgentId>(() => {
    const agentIds = newParticipants.flatMap((participant) => participant.kind === 'agent' ? [participant.agentId] : [])
    if (agentIds.length === 0 || agentIds.includes('pip')) return 'pip'
    return agentIds[0]
  }, [newParticipants])

  // Attachment state
  const [attachments, setAttachments] = useState<File[]>([])
  const inputRef = useRef(input)
  const attachmentsRef = useRef(attachments)
  inputRef.current = input
  attachmentsRef.current = attachments
  const [draggingAttachments, setDraggingAttachments] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentInputId = useId()
  const contextPickerPanelId = useId()

  // Mobile pane navigation: which pane is visible on small screens
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation'>(initialConvId ? 'conversation' : 'list')
  const [sessionsOverlayViewport, setSessionsOverlayViewport] = useState(false)
  const [tabletSessionsDrawer, setTabletSessionsDrawer] = useState(false)

  // Header "…" menu (rename / export / archive)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [exportingChat, setExportingChat] = useState(false)
  const [conversationFilter, setConversationFilter] = useState('')

  // Refs
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollFailuresRef = useRef<Record<string, number>>({})
  const pollFinalizeRef = useRef<((
    convId: string,
    msgId: string,
    runId: string,
    agentId: AgentId,
    attempts?: number
  ) => void) | null>(null)
  const eventSourcesRef = useRef<Record<string, EventSource>>({})
  const sendingRef = useRef(false)
  const markedReadRef = useRef('')
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  // Stick-to-bottom only while the human is already near latest (or just entered).
  // Reading history must not be yanked back down on poll/stream/message updates.
  const stickMessagesToBottomRef = useRef(true)
  const pendingEnterMessagesScrollRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const COMPOSER_MAX_HEIGHT_PX = 160
  const resizeComposer = useCallback(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(Math.max(el.scrollHeight, 40), COMPOSER_MAX_HEIGHT_PX)
    el.style.height = `${next}px`
  }, [])
  useEffect(() => {
    resizeComposer()
  }, [input, resizeComposer])
  useEffect(() => {
    sendingRef.current = sending
  }, [sending])
  // User edit generation guards delayed context attachment cleanup. Comparing
  // text alone is insufficient because a user can edit and then restore the
  // exact same bytes while the PATCH is in flight.
  const composerEditRevisionRef = useRef(0)
  // undefined means a manually typed mention; null means Add context reused existing whitespace.
  const contextPickerInsertedSeparatorRef = useRef<number | null | undefined>(undefined)
  const suppressContextPickerKeyUpRef = useRef(false)
  const mobileSessionsRef = useRef<HTMLElement | null>(null)
  const mobileSessionsCloseRef = useRef<HTMLButtonElement | null>(null)
  const mobileSessionsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const conversationFilterRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const overlayMedia = window.matchMedia('(max-width: 1279px)')
    const tabletMedia = window.matchMedia('(min-width: 1024px) and (max-width: 1279px)')
    const update = () => {
      setSessionsOverlayViewport(overlayMedia.matches)
      setTabletSessionsDrawer(tabletMedia.matches)
    }
    update()
    overlayMedia.addEventListener?.('change', update)
    tabletMedia.addEventListener?.('change', update)
    return () => {
      overlayMedia.removeEventListener?.('change', update)
      tabletMedia.removeEventListener?.('change', update)
    }
  }, [])
  const historyDraftRef = useRef('')
  // Tracks which assistant message IDs we've already started polling for (prevents duplicates)
  const resumedRunsRef = useRef<Set<string>>(new Set())
  const autoCreateRef = useRef(false)

  // ── Derived ───────────────────────────────────────────────────────────────
  const linkedProjectIds = useMemo(() => new Set(workspaceProjects.map((project) => project.id)), [workspaceProjects])
  const activeConversation = useMemo(
    // The session rail may deliberately hide an unlinked project, but an
    // authorised saved tab still needs its complete conversation surface. The
    // conversation endpoint and context APIs enforce access; rail visibility
    // must not suppress the active context strip or its controls.
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  )
  useEffect(() => {
    if (!preferCurrentPageContext || !currentPageContext) return
    const relatedId = findRelatedConversationId(conversations, currentPageContext)
    if (activeId !== relatedId) setActiveId(relatedId)
  }, [activeId, conversations, currentPageContext, preferCurrentPageContext, setActiveId])
  const hasDockContext = Boolean(activeConversation && (
    (activeConversation.scope === 'project' && activeConversation.scopeRefId) ||
    (activeConversation.contextRefs ?? []).length > 0
  ))
  const chatContexts = useChatContexts(orgId, activeConversation, hasDockContext)
  const projectChat = useProjectChatProgress(
    orgId,
    activeConversation,
    // Poll board progress for project chats and command sessions so task
    // lifecycle updates appear without reopening the conversation.
    Boolean(
      activeConversation
      && (
        activeConversation.scope === 'project'
        || Boolean((activeConversation as { commandSessionProjectId?: string }).commandSessionProjectId)
      ),
    ),
  )
  const [commandSessionBusy, setCommandSessionBusy] = useState(false)
  const commandSessionProjectId = activeConversation?.commandSessionProjectId
  const isCommandSession = Boolean(
    activeConversation
    && activeConversation.scope === 'project'
    && activeConversation.scopeRefId
    && commandSessionProjectId === activeConversation.scopeRefId,
  )
  const bindCommandSession = useCallback(async () => {
    if (!activeConversation || activeConversation.scope !== 'project' || !activeConversation.scopeRefId) return
    setCommandSessionBusy(true)
    try {
      const res = await fetch(`/api/v1/projects/${encodeURIComponent(activeConversation.scopeRefId)}/command-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversation.id, autoWake: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Bind failed (${res.status})`)
      }
      setConversations((current) => current.map((conversation) => (
        conversation.id === activeConversation.id
          ? { ...conversation, commandSessionProjectId: activeConversation.scopeRefId }
          : conversation.commandSessionProjectId === activeConversation.scopeRefId
            ? { ...conversation, commandSessionProjectId: undefined }
            : conversation
      )))
      // Pull the system bind message into the open thread.
      if (activeId) {
        void fetch(`/api/v1/conversations/${encodeURIComponent(activeId)}/messages`)
          .then((response) => response.ok ? response.json() : null)
          .then((body) => {
            const next = body?.data
            if (Array.isArray(next)) setMessages(next)
          })
          .catch(() => {})
      }
    } catch (error) {
      console.error('[command-session] bind failed', error)
    } finally {
      setCommandSessionBusy(false)
    }
  }, [activeConversation, activeId])

  // Command sessions also need message polling so task lifecycle system events
  // and auto-wake replies appear without a manual refresh.
  useEffect(() => {
    if (!activeId || !isCommandSession) return
    let cancelled = false
    const poll = () => {
      if (cancelled || document.visibilityState === 'hidden') return
      void fetch(`/api/v1/conversations/${encodeURIComponent(activeId)}/messages`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (cancelled || !Array.isArray(body?.data)) return
          setMessages((prev) => {
            const next = body.data as ConversationMessage[]
            if (prev.length === next.length && prev[prev.length - 1]?.id === next[next.length - 1]?.id) return prev
            return next
          })
        })
        .catch(() => {})
    }
    const interval = window.setInterval(poll, 5_000)
    document.addEventListener('visibilitychange', poll)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [activeId, isCommandSession])

  const refreshProjectChat = projectChat.refresh
  const projectBundleRefreshRef = useRef<{ contextKey: string; refreshedAt: number; messageSignal: string }>({ contextKey: '', refreshedAt: 0, messageSignal: '' })
  useEffect(() => {
    if (chatContexts.activeContext?.kind !== 'project' || !chatContexts.model) return
    const contextKey = `${chatContexts.activeContext.kind}:${chatContexts.activeContext.id}`
    const now = Date.now()
    const previous = projectBundleRefreshRef.current
    if (previous.contextKey === contextKey && now - previous.refreshedAt < 30_000) return
    projectBundleRefreshRef.current = { ...previous, contextKey, refreshedAt: now }
    void refreshProjectChat().catch(() => undefined)
  }, [chatContexts.activeContext?.id, chatContexts.activeContext?.kind, chatContexts.model, refreshProjectChat])
  const projectBundleMessageSignal = useMemo(() => {
    const latest = messages[messages.length - 1]
    const eventCount = Object.values(liveEvents).reduce((total, events) => total + events.length, 0)
    return `${latest?.id ?? ''}:${latest?.status ?? ''}:${eventCount}`
  }, [liveEvents, messages])
  useEffect(() => {
    if (chatContexts.activeContext?.kind !== 'project' || !chatContexts.model) return
    const contextKey = `${chatContexts.activeContext.kind}:${chatContexts.activeContext.id}`
    const previous = projectBundleRefreshRef.current
    if (previous.contextKey !== contextKey || !previous.messageSignal) {
      projectBundleRefreshRef.current = { ...previous, contextKey, messageSignal: projectBundleMessageSignal }
      return
    }
    if (previous.messageSignal === projectBundleMessageSignal) return
    projectBundleRefreshRef.current = { contextKey, refreshedAt: Date.now(), messageSignal: projectBundleMessageSignal }
    void refreshProjectChat().catch(() => undefined)
  }, [chatContexts.activeContext?.id, chatContexts.activeContext?.kind, chatContexts.model, projectBundleMessageSignal, refreshProjectChat])
  const handleContextActionResolved = useCallback(() => {
    if (chatContexts.activeContext?.kind === 'project') {
      projectBundleRefreshRef.current = { ...projectBundleRefreshRef.current, refreshedAt: Date.now() }
      void refreshProjectChat().catch(() => undefined)
    }
    onContextActionResolved?.()
  }, [chatContexts.activeContext?.kind, onContextActionResolved, refreshProjectChat])
  const activeModelAgentId = useMemo<AgentId | null>(() => {
    const agentIds = activeConversation?.participantAgentIds ?? []
    if (agentIds.length === 0) return null
    return agentIds.includes('pip') ? 'pip' : agentIds[0]
  }, [activeConversation?.participantAgentIds])
  const workspaceCatalogueAgentId = showNewModal
    ? newConversationRuntimeAgentId
    : activeModelAgentId ?? 'pip'
  const activeRuntimeMessage = useMemo(() => {
    const sorted = messages.slice().sort((a, b) => tsSeconds(b.createdAt) - tsSeconds(a.createdAt))
    return sorted.find((message) =>
      message.role === 'assistant' && Boolean(message.runId) && (
        message.status === 'queued' ||
        message.status === 'pending' ||
        message.status === 'streaming' ||
        message.status === 'waiting_approval' ||
        message.status === 'completed' ||
        message.status === 'failed'
      ),
    ) ?? null
  }, [messages])
  const activeRuntimeEvents = activeRuntimeMessage
    ? (liveEvents[activeRuntimeMessage.id]?.length
        ? liveEvents[activeRuntimeMessage.id]
        : ((activeRuntimeMessage.events ?? []) as ChatEvent[]))
    : []
  const workbenchEvents = useMemo(() => messages.flatMap((message) => {
    const streamed = liveEvents[message.id]
    return streamed?.length ? streamed : ((message.events ?? []) as ChatEvent[])
  }), [liveEvents, messages])
  const workbenchRichParts = useMemo(() => messages.flatMap((message) => message.richParts ?? []), [messages])
  const workbenchTerminalEntries = useMemo(() => buildWorkbenchTerminalEntries(workbenchEvents), [workbenchEvents])
  const workbenchFileTree = useMemo(() => buildWorkbenchFileTree(workbenchEvents), [workbenchEvents])
  const workbenchEventChanges = useMemo(() => buildWorkbenchChanges(workbenchEvents), [workbenchEvents])
  const workbenchChanges = workbenchLiveChanges ?? workbenchEventChanges
  const workbenchBrowserTargets = useMemo(() => buildWorkbenchBrowserTargets(workbenchEvents, workbenchRichParts), [workbenchEvents, workbenchRichParts])
  const hasInFlightAgentRun = useMemo(
    () => messages.some((message) =>
      message.role === 'assistant' && Boolean(message.runId) && (
        message.status === 'queued' ||
        message.status === 'pending' ||
        message.status === 'streaming' ||
        message.status === 'waiting_approval'
      ),
    ),
    [messages],
  )
  // Report agent-run lifecycle to Hermes tab chrome (pulse / unread underline).
  const inFlightByConversationRef = useRef<Record<string, boolean>>({})
  const onConversationLifecycleRef = useRef(onConversationLifecycle)
  onConversationLifecycleRef.current = onConversationLifecycle
  const onRealtimeGatewayConnectionChangeRef = useRef(onRealtimeGatewayConnectionChange)
  onRealtimeGatewayConnectionChangeRef.current = onRealtimeGatewayConnectionChange
  const onConversationRealtimeInvalidationRef = useRef(onConversationRealtimeInvalidation)
  onConversationRealtimeInvalidationRef.current = onConversationRealtimeInvalidation
  useEffect(() => {
    if (!activeId) return
    const wasInFlight = inFlightByConversationRef.current[activeId] === true
    inFlightByConversationRef.current[activeId] = hasInFlightAgentRun
    const report = onConversationLifecycleRef.current
    if (!report) return
    if (hasInFlightAgentRun && !wasInFlight) {
      report({ conversationId: activeId, phase: 'running' })
      return
    }
    if (!hasInFlightAgentRun && wasInFlight) {
      report({ conversationId: activeId, phase: 'completed' })
    }
  }, [activeId, hasInFlightAgentRun])
  const activeQueuedDrafts = activeId ? (queuedDraftsByConversation[activeId] ?? []) : []
  const organisationWorkspaces = useMemo(
    () => workspaces.filter(isOrganisationWorkspace),
    [workspaces],
  )
  const selectedWorkspace = useMemo(
    () => organisationWorkspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId)
      ?? workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null,
    [organisationWorkspaces, workspaces, selectedWorkspaceId],
  )
  const selectedWorkspaceProject = useMemo(
    () => workspaceProjects.find((project) => project.id === selectedProjectId) ?? null,
    [selectedProjectId, workspaceProjects],
  )
  useEffect(() => {
    if (newScope !== 'project') return
    const linkedWorkspaceIds = Array.from(new Set((selectedWorkspaceProject?.locations ?? [])
      .map((location) => location.workspaceId)
      .filter((workspaceId): workspaceId is string => Boolean(workspaceId))))
    if (linkedWorkspaceIds.length === 0 || linkedWorkspaceIds.includes(selectedWorkspaceId)) return
    const nextWorkspaceId = linkedWorkspaceIds.find((workspaceId) => workspaces.some((workspace) => workspace.workspaceId === workspaceId))
    if (!nextWorkspaceId) return
    workspaceRuntimeExplicitRef.current = false
    setSelectedWorkspaceId(nextWorkspaceId)
    setSelectedWorkspaceRuntime('')
  }, [newScope, selectedWorkspaceId, selectedWorkspaceProject, workspaces])
  const workspaceRuntimeTargets = useMemo(
    () => {
      const catalogue = workspaceRuntimeTargetsByWorkspace[selectedWorkspaceId] ?? []
      const scoped = newScope !== 'project'
        ? catalogue
        : (() => {
          const linkedLocations = new Map((selectedWorkspaceProject?.locations ?? [])
            .filter((location) => !location.workspaceId || location.workspaceId === selectedWorkspaceId)
            .map((location) => [location.locationId, location]))
          return catalogue.flatMap((runtime) => {
            const location = linkedLocations.get(projectRuntimeLocationId(runtime))
            if (!location || !location.authenticatedRuntime) return []
            const selectable = runtime.selectable && location.availability === 'online'
            return [{
              ...runtime,
              selectable,
              ...(!selectable && !runtime.unavailableReason ? { unavailableReason: 'project_sync_pending' } : {}),
            }]
          })
        })()
      // Company/project: company or project folder is already chosen — only pick the machine.
      // Organisation root: keep one option per mapped folder on the same computer.
      if (workspaceRuntimeShowsMappedFolders(newScope)) return scoped
      return collapseWorkspaceRuntimesByComputer(scoped, {
        preferredMappingLabel: selectedWorkspace?.orgName,
      })
    },
    [newScope, selectedWorkspace, selectedWorkspaceId, selectedWorkspaceProject, workspaceRuntimeTargetsByWorkspace],
  )
  const showMappedFolderRuntimeChoices = workspaceRuntimeShowsMappedFolders(newScope)
  const selectedWorkspaceRuntimeIsValid = workspaceRuntimeTargets.some(runtime => (
    workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime && runtime.selectable
  ))
  const selectedWorkspaceRuntimeTarget = useMemo(
    () => {
      const exact = workspaceRuntimeTargets.find((runtime) => (
        workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime
      ))
      if (exact) return exact
      return workspaceRuntimeTargets.find((runtime) => runtime.id === selectedWorkspaceRuntime) ?? null
    },
    [selectedWorkspaceRuntime, workspaceRuntimeTargets],
  )
  const scopedConversationShareModeDefault = useMemo(
    () => defaultScopedConversationShareMode(newScope, selectedWorkspaceRuntimeTarget),
    [newScope, selectedWorkspaceRuntimeTarget],
  )
  const scopedConversationShareModeSupportsOrg = useMemo(
    () => isWorkspaceSharedRuntime(selectedWorkspaceRuntimeTarget),
    [selectedWorkspaceRuntimeTarget],
  )
  const runtimeRequiredForNewConversation = newScope === 'workspace' || newScope === 'company' || newScope === 'project'
  const newConversationAgentGate = useMemo(
    () => resolveNewConversationAgentGate({
      scope: newScope,
      runtimeRequired: runtimeRequiredForNewConversation,
      runtimeSelected: selectedWorkspaceRuntimeIsValid,
      runtimeAvailableAgentIds: selectedWorkspaceRuntimeTarget && 'availableAgentIds' in selectedWorkspaceRuntimeTarget
        ? selectedWorkspaceRuntimeTarget.availableAgentIds ?? null
        : null,
    }),
    [newScope, runtimeRequiredForNewConversation, selectedWorkspaceRuntimeIsValid, selectedWorkspaceRuntimeTarget],
  )
  useEffect(() => {
    if (!isScopedConversation(newScope)) return
    if (selectedWorkspaceShareModeTouchedRef.current) return
    setSelectedWorkspaceShareMode(scopedConversationShareModeDefault)
  }, [newScope, scopedConversationShareModeDefault])
  useEffect(() => {
    if (workspaceRuntimeTargets.length === 0) {
      if (newScope === 'project' && selectedWorkspaceRuntime) {
        workspaceRuntimeExplicitRef.current = false
        setSelectedWorkspaceRuntime('')
      }
      return
    }
    if (!workspaceRuntimeExplicitRef.current && !workspaceRuntimeTargets.some((runtime) => (
      workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime && runtime.selectable
    ))) {
      const preferred = pickPreferredWorkspaceRuntime(workspaceRuntimeTargets, {
        preferredTargetId: selectedWorkspace?.defaultRuntimeTarget,
      })
      setSelectedWorkspaceRuntime(preferred ? workspaceRuntimeSelectionKey(preferred) : '')
    }
  }, [newScope, selectedWorkspace?.defaultRuntimeTarget, selectedWorkspaceRuntime, workspaceRuntimeTargets])
  const projectLocationOptions = useMemo<ProjectLocationOption[]>(() => workspaces.flatMap((workspace) => (
    workspaceRuntimeTargetsByWorkspace[workspace.workspaceId] ?? []
  ).map((runtime) => ({
    key: `${workspace.workspaceId}:${workspaceRuntimeSelectionKey(runtime)}`,
    runtimeTargetId: runtime.id,
    locationId: projectRuntimeLocationId(runtime),
    ...(runtime.mappingId ? { mappingId: runtime.mappingId } : {}),
    workspaceId: workspace.workspaceId,
    workspaceLabel: workspace.orgName,
    label: runtime.mappingLabel
      ? `${projectRuntimeLabel(runtime)} · ${runtime.mappingLabel}`
      : projectRuntimeLabel(runtime),
    ...(runtime.kind === 'vps' || runtime.deviceKind === 'vps'
      ? { kind: 'vps' as const }
      : { kind: 'computer' as const }),
    ...(runtime.ownerType ? { ownerType: runtime.ownerType } : {}),
    selectable: runtime.selectable,
    ...(runtime.unavailableReason ? { unavailableReason: runtime.unavailableReason } : {}),
  }))), [workspaces, workspaceRuntimeTargetsByWorkspace])
  const projectLocationManagementCandidates = useMemo<ProjectLocationManagementCandidate[]>(() => {
    const candidates = workspaces.flatMap((workspace) => (
      workspaceRuntimeTargetsByWorkspace[workspace.workspaceId] ?? []
    ).flatMap((runtime) => {
      const locationId = runtime.locationId?.trim() ?? ''
      const runtimeWorkspaceId = runtime.workspaceId?.trim() ?? ''
      if (!locationId || !runtimeWorkspaceId || runtimeWorkspaceId !== workspace.workspaceId) return []
      return [{
        key: `${runtimeWorkspaceId}:${workspaceRuntimeSelectionKey(runtime)}`,
        runtimeTargetId: runtime.id,
        locationId,
        ...(runtime.mappingId ? { mappingId: runtime.mappingId } : {}),
        workspaceId: runtimeWorkspaceId,
        workspaceLabel: workspace.orgName,
        label: runtime.mappingLabel
          ? `${projectRuntimeLabel(runtime)} · ${runtime.mappingLabel}`
          : projectRuntimeLabel(runtime),
        selectable: runtime.selectable,
      }]
    }))
    return Array.from(new Map(candidates.map((candidate) => [candidate.key, candidate])).values())
  }, [workspaces, workspaceRuntimeTargetsByWorkspace])
  const managedLinkedLocationIds = useMemo(
    () => new Set(managedProjectLocations.map((location) => location.locationId)),
    [managedProjectLocations],
  )
  const managedUnlinkedLocationCandidates = useMemo(
    () => projectLocationManagementCandidates.filter((candidate) => !managedLinkedLocationIds.has(candidate.locationId)),
    [managedLinkedLocationIds, projectLocationManagementCandidates],
  )
  const managedProjectHasLegacyLocations = useMemo(
    () => managedProjectLocations.some((location) => !location.authenticatedRuntime),
    [managedProjectLocations],
  )
  const managedProjectSyncHardBlocked = managedProjectSync?.projectId === managedProject?.id
    && Boolean(managedProjectSync?.blocker && managedProjectSync.blocker !== 'native_sync_replica_offline')
  const managedProjectSyncEligible = useMemo(
    () => managedProjectCanSync(managedProjectLocations) && !managedProjectSyncHardBlocked,
    [managedProjectLocations, managedProjectSyncHardBlocked],
  )
  const projectSetupLocationOptions = useMemo(
    () => projectLocationOptions.filter((location) => location.workspaceId === projectSetupWorkspaceId),
    [projectLocationOptions, projectSetupWorkspaceId],
  )
  const projectSetupCanonicalVps = useMemo(
    () => projectSetupLocationOptions.find((location) => (
      location.kind === 'vps'
      && location.ownerType === 'organization'
      && location.selectable
    )),
    [projectSetupLocationOptions],
  )
  const projectSetupHasAvailableLocation = Boolean(projectSetupResult && workspaceProjects
    .find((project) => project.id === projectSetupResult.projectId)
    ?.locations?.some((location) => (
      projectSetupResult.linkedLocationIds.includes(location.locationId)
      && location.availability === 'online'
      && location.authenticatedRuntime
    )))
  const projectSetupBlocksSession = Boolean(
    projectSetupResult
    && selectedProjectId === projectSetupResult.projectId
    && !projectSetupHasAvailableLocation,
  )
  const projectSetupDuplicateName = Boolean(projectSetupName.trim() && projectSetupExistingProjects.some((project) => (
    project.name.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
      === projectSetupName.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
  )))
  const projectSetupCanSubmit = Boolean(
    projectSetupName.trim()
    && projectSetupCompanyId
    && !projectSetupLibraryLoading
    && !projectSetupSubmitting
    && (projectSetupMode === 'existing_folder'
      ? projectSetupExistingProjects.length === 0
        && projectSetupWorkspaceId
        && projectSetupWorkspaceFolderId
        && projectSetupLocationIds.length > 0
        && projectSetupLocationIds.every((locationId) => projectSetupLocationOptions.some((location) => (
          location.locationId === locationId && location.selectable
        )))
      : projectSetupMode === 'standard'
        ? !projectSetupDuplicateName
          && projectSetupWorkspaceId
          && projectSetupCanonicalVps
          && projectSetupLocationIds.includes(projectSetupCanonicalVps.locationId)
          && projectSetupLocationIds.length > 0
          && projectSetupLocationIds.every((locationId) => projectSetupLocationOptions.some((location) => (
            location.locationId === locationId && location.selectable
          )))
        : projectSetupClientName.trim() && projectSetupDomainSlug.trim() && projectSetupAgentName.trim()),
  )
  useEffect(() => {
    if (!showProjectSetupWizard || !projectSetupCompanyId) {
      setProjectSetupExistingProjects([])
      setProjectSetupLibraryLoading(false)
      return
    }
    let cancelled = false
    setProjectSetupLibraryLoading(true)
    const query = new URLSearchParams({ orgId, companyId: projectSetupCompanyId }).toString()
    fetch(`/api/v1/project-library?${query}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error ?? `Project lookup: ${response.status}`)
        if (cancelled) return
        const projects = Array.isArray(body?.data?.projects) ? body.data.projects : []
        setProjectSetupExistingProjects(projects.flatMap((project: unknown) => {
          if (!project || typeof project !== 'object') return []
          const candidate = project as Record<string, unknown>
          const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
          const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
          return id ? [{ id, name: name || 'Company Cowork', added: candidate.added === true }] : []
        }))
      })
      .catch((lookupError) => {
        if (!cancelled) setProjectSetupError(lookupError instanceof Error ? lookupError.message : 'Project lookup failed')
      })
      .finally(() => {
        if (!cancelled) setProjectSetupLibraryLoading(false)
      })
    return () => { cancelled = true }
  }, [orgId, projectSetupCompanyId, showProjectSetupWizard])
  useEffect(() => {
    if (!showProjectSetupWizard || projectSetupWorkspaceId) return
    setProjectSetupWorkspaceId(selectedWorkspaceId || workspaces[0]?.workspaceId || '')
  }, [projectSetupWorkspaceId, selectedWorkspaceId, showProjectSetupWizard, workspaces])
  useEffect(() => {
    if (!showProjectSetupWizard || projectSetupMode !== 'existing_folder') return
    if (!projectSetupWorkspaceFolderId && registeredWorkspaceFolders[0]) {
      setProjectSetupWorkspaceFolderId(registeredWorkspaceFolders[0].id)
    }
    setProjectSetupLocationIds((current) => {
      const available = current.filter((locationId) => projectSetupLocationOptions.some((location) => (
        location.locationId === locationId && location.selectable
      )))
      if (available.length > 0) return available
      const first = projectSetupLocationOptions.find((location) => location.selectable)?.locationId
      return first ? [first] : []
    })
  }, [projectSetupLocationOptions, projectSetupMode, projectSetupWorkspaceFolderId, registeredWorkspaceFolders, showProjectSetupWizard])
  useEffect(() => {
    if (!showProjectSetupWizard || projectSetupMode !== 'standard' || !projectSetupCanonicalVps) return
    setProjectSetupLocationIds((current) => current.includes(projectSetupCanonicalVps.locationId)
      ? current
      : [projectSetupCanonicalVps.locationId, ...current])
  }, [projectSetupCanonicalVps, projectSetupMode, showProjectSetupWizard])
  const activeWorkspaceContext = activeConversation?.workspaceContext
  const activeRuntimeLabel = (() => {
    const machine = activeWorkspaceContext?.runtimeLabel
      ?? (activeWorkspaceContext?.runtimeTarget === 'local'
        ? 'Local'
        : activeWorkspaceContext?.runtimeTarget === 'vps'
          ? 'VPS'
          : activeWorkspaceContext?.runtimeTarget)
    const mapping = activeWorkspaceContext?.mappingLabel?.trim()
    if (machine && mapping) return `${machine} · ${mapping}`
    return machine
  })()
  const activeRuntimeCatalogueAgentId = activeModelAgentId ?? 'pip'
  const activeRuntimeCatalogue = workspaceRuntimeTargetsByAgent[activeRuntimeCatalogueAgentId]
    ?? (workspaceCatalogueAgentId === activeRuntimeCatalogueAgentId ? workspaceRuntimeTargetsByWorkspace : {})
  const activeRuntimeCatalogueLoaded = Boolean(workspaceRuntimeTargetsByAgent[activeRuntimeCatalogueAgentId])
    || (workspaceCatalogueAgentId === activeRuntimeCatalogueAgentId && workspaceCatalogueLoaded)
  const activeRuntimePresence = activeWorkspaceContext
    ? (activeRuntimeCatalogue[activeWorkspaceContext.workspaceId] ?? []).find(
        runtime => (
          (runtime.id === activeWorkspaceContext.runtimeTarget
            || runtime.legacyRuntimeTargetIds?.includes(activeWorkspaceContext.runtimeTarget))
          && (!activeWorkspaceContext.mappingId
            || !runtime.mappingId
            || runtime.mappingId === activeWorkspaceContext.mappingId)
        ),
      )
    : undefined
  // Company/project chats use the organisation-root mapping as their dispatch
  // authorization boundary, while the scoped context selects the actual folder
  // beneath it. Keep both truths visible without presenting the root mapping as
  // though it were the selected company/project folder.
  const activeRootMappingLabel = activeWorkspaceContext?.mappingLabel ?? activeRuntimePresence?.mappingLabel
  const activeConnectionFolderLabel = activeWorkspaceContext?.folderScope === 'company'
    ? [activeWorkspaceContext.companyName, activeRootMappingLabel]
        .filter(Boolean)
        .join(' via ')
    : activeWorkspaceContext?.folderScope === 'project'
      ? [activeWorkspaceContext.projectName, activeRootMappingLabel]
          .filter(Boolean)
          .join(' via ')
      : activeRootMappingLabel
  const lastDispatchMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const row = messages[index]
      if (row.authorKind !== 'agent' && row.role !== 'assistant') continue
      if (
        row.dispatchRuntimeLabel
        || row.dispatchRuntimeKind
        || row.dispatchRuntimeTargetId
        || row.acceptedDevice?.machineLabel
      ) {
        return row
      }
    }
    return null
  }, [messages])
  const activeConnectionWhere = useMemo<ConnectionWhere | null>(() => {
    const fromPresence = buildConnectionWhere({
      runtimeKind: activeRuntimePresence?.kind
        ?? (activeRuntimePresence?.deviceKind === 'vps'
          ? 'vps'
          : activeRuntimePresence?.deviceKind === 'computer'
            ? 'linked-computer'
            : activeRuntimePresence?.isLocal
              ? 'local'
              : null),
      machineLabel: activeRuntimePresence?.label || activeRuntimePresence?.locationLabel,
      locationLabel: activeRuntimePresence?.locationLabel,
      runtimeTarget: activeWorkspaceContext?.runtimeTarget ?? activeRuntimePresence?.id,
      runtimeLabel: activeWorkspaceContext?.runtimeLabel ?? activeRuntimePresence?.label,
      mappingLabel: activeConnectionFolderLabel ?? (
        activeWorkspaceContext?.folderScope ? undefined : activeRuntimePresence?.mappingLabel
      ),
      deviceKind: activeRuntimePresence?.deviceKind,
      isLocal: activeRuntimePresence?.isLocal,
      online: activeRuntimePresence
        ? Boolean(activeRuntimePresence.isFresh && activeRuntimePresence.isHealthy)
        : null,
    })
    if (fromPresence) return fromPresence

    const fromContext = buildConnectionWhere({
      runtimeTarget: activeWorkspaceContext?.runtimeTarget,
      runtimeLabel: activeWorkspaceContext?.runtimeLabel,
      mappingLabel: activeConnectionFolderLabel,
      online: null,
    })
    if (fromContext) return fromContext

    return buildConnectionWhere({
      runtimeKind: lastDispatchMessage?.dispatchRuntimeKind,
      machineLabel: lastDispatchMessage?.dispatchRuntimeLabel || lastDispatchMessage?.acceptedDevice?.machineLabel,
      runtimeTarget: lastDispatchMessage?.dispatchRuntimeTargetId,
      online: lastDispatchMessage?.acceptedDevice ? true : null,
    })
  }, [activeConnectionFolderLabel, activeRuntimePresence, activeWorkspaceContext, lastDispatchMessage])
  const workbenchRuntime = useMemo<WorkbenchRuntimeSummary>(() => ({
    label: activeConnectionWhere?.display
      || activeRuntimeLabel
      || activeWorkspaceContext?.runtimeLabel
      || activeWorkspaceContext?.runtimeTarget,
    mappingLabel: activeWorkspaceContext?.mappingLabel ?? activeConnectionWhere?.mappingLabel,
    folderScope: activeWorkspaceContext?.folderScope ?? null,
    projectName: activeWorkspaceContext?.projectName,
    runtimeTarget: activeWorkspaceContext?.runtimeTarget,
    hasMapping: Boolean(activeWorkspaceContext?.mappingId),
  }), [activeConnectionWhere, activeRuntimeLabel, activeWorkspaceContext])
  const unavailableActiveRuntime = useMemo(
    () => activeWorkspaceContext && activeRuntimeCatalogueLoaded && (!activeRuntimePresence || !activeRuntimePresence.selectable)
      ? {
          label: activeRuntimePresence?.label || activeRuntimeLabel || activeConnectionWhere?.label || 'This computer',
          offline: !activeRuntimePresence || !activeRuntimePresence.isFresh,
          // The server rechecks the exact device, mapping, credential and
          // membership before accepting this recovery queue. Never enable a
          // guessed/missing target; only a catalogue entry with temporary
          // liveness loss may take another message while it reconnects.
          queueable: Boolean(
            activeRuntimePresence
            && (activeRuntimePresence.unavailableReason === 'offline'
              || activeRuntimePresence.unavailableReason === 'stale'),
          ),
          recovering: Boolean(
            activeRuntimePresence?.isFresh
            && !activeRuntimePresence.isHealthy
            && activeRuntimePresence.unavailableReason === 'offline',
          ),
        }
      : undefined,
    [activeConnectionWhere?.label, activeRuntimeCatalogueLoaded, activeRuntimeLabel, activeRuntimePresence, activeWorkspaceContext],
  )
  const shouldRefreshUnavailableRuntime = Boolean(unavailableActiveRuntime)
  const runtimeBlocksComposer = Boolean(unavailableActiveRuntime && !unavailableActiveRuntime.queueable)
  const canUseComposer = allowSendMessages && (Boolean(activeConversation) || allowStartConversations) && !runtimeBlocksComposer
  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => {
      if (conversation.archived) return false
      // Entity embeds (CRM contact/company, tickets) lock the rail to one scope
      // ref. Never let a stale list/live snapshot leak unrelated threads in.
      if (!includeAllScopes && scope && scopeRefId) {
        const scoped = conversation.scope === scope && conversation.scopeRefId === scopeRefId
        const contextLinked = conversation.contextRefs?.some((ref) => ref.type === scope && ref.id === scopeRefId)
        if (!scoped && !contextLinked) return false
      }
      const project = conversationProjectIdentity(conversation)
      return layoutVariant !== 'hermes' || compact || !project || linkedProjectIds.has(project.id)
    }),
    [compact, conversations, includeAllScopes, layoutVariant, linkedProjectIds, scope, scopeRefId],
  )
  const filteredConversations = useMemo(() => {
    const query = conversationFilter.trim().toLocaleLowerCase()
    if (!query) return visibleConversations
    return visibleConversations.filter((conversation) => [
      conversation.title,
      conversation.lastMessagePreview,
      conversation.workspaceContext?.orgName,
      conversation.workspaceContext?.companyName,
      ...(conversation.contextRefs ?? []).map((ref) => ref.label),
    ].some((value) => value?.toLocaleLowerCase().includes(query)))
  }, [conversationFilter, visibleConversations])
  const pinnedConversationIdSet = useMemo(() => new Set(pinnedConversationIds), [pinnedConversationIds])
  const hermesSessionSections = useMemo(
    () => buildHermesSessionSections(filteredConversations, pinnedConversationIds),
    [filteredConversations, pinnedConversationIds],
  )
  const hermesCompanyGroups = useMemo(
    () => buildHermesCompanyGroups(visibleConversations, workspaces, conversationFilter),
    [conversationFilter, visibleConversations, workspaces],
  )
  const hermesProjectGroups = useMemo(
    () => buildHermesProjectGroups(visibleConversations, workspaceProjects, conversationFilter),
    [conversationFilter, visibleConversations, workspaceProjects],
  )
  const allHermesWorkspaceGroups = useMemo(
    () => buildHermesWorkspaceGroups(visibleConversations, workspaces, conversationFilter, pinnedConversationIds),
    [conversationFilter, pinnedConversationIds, visibleConversations, workspaces],
  )
  const allHermesAgentGroups = useMemo(
    () => buildHermesAgentGroups(visibleConversations, Object.values(agentMap), conversationFilter, pinnedConversationIds),
    [agentMap, conversationFilter, pinnedConversationIds, visibleConversations],
  )
  const hiddenFolderKeySet = useMemo(() => new Set(hiddenFolderKeys), [hiddenFolderKeys])
  const hermesWorkspaceGroups = useMemo(
    () => allHermesWorkspaceGroups.filter((group) => !hiddenFolderKeySet.has(`workspace:${group.id}`)),
    [allHermesWorkspaceGroups, hiddenFolderKeySet],
  )
  const hermesAgentGroups = useMemo(
    () => allHermesAgentGroups.filter((group) => !hiddenFolderKeySet.has(`agent:${group.id}`)),
    [allHermesAgentGroups, hiddenFolderKeySet],
  )
  const hiddenFolderOptions = useMemo(() => [
    ...allHermesWorkspaceGroups
      .filter((group) => hiddenFolderKeySet.has(`workspace:${group.id}`))
      .map((group) => ({ key: `workspace:${group.id}`, name: group.name, kind: 'Workspace' })),
    ...allHermesAgentGroups
      .filter((group) => hiddenFolderKeySet.has(`agent:${group.id}`))
      .map((group) => ({ key: `agent:${group.id}`, name: group.name, kind: 'Agent' })),
  ], [allHermesAgentGroups, allHermesWorkspaceGroups, hiddenFolderKeySet])
  useEffect(() => {
    if (hiddenFolderOptions.length === 0) setShowHiddenFolders(false)
  }, [hiddenFolderOptions.length])
  const hasHermesRailItems = hermesCompanyGroups.length > 0
    || hermesProjectGroups.length > 0
    || hermesWorkspaceGroups.length > 0
    || hermesAgentGroups.length > 0
    || hermesSessionSections.length > 0
  // Only auto-expand the folder that contains the active conversation.
  // Do NOT re-expand every project on catalogue/poll refreshes — that fights
  // the user's collapse preference a few seconds after they close a folder.
  useEffect(() => {
    if (!activeId || layoutVariant !== 'hermes') return
    const company = hermesCompanyGroups.find((group) => group.conversations.some((conversation) => conversation.id === activeId))
    const project = hermesProjectGroups.find((group) => group.conversations.some((conversation) => conversation.id === activeId))
    const workspace = hermesWorkspaceGroups.find((group) => group.conversations.some((conversation) => conversation.id === activeId))
    const agent = hermesAgentGroups.find((group) => group.conversations.some((conversation) => conversation.id === activeId))
    const groupKeys = [
      ...(company ? [`company:${company.id}`] : []),
      ...(project ? [`project:${project.id}`] : []),
      ...(workspace ? [`workspace:${workspace.id}`] : []),
      ...(agent ? [`agent:${agent.id}`] : []),
    ]
    if (groupKeys.length === 0) return
    setExpandedSessionGroupKeys((current) => {
      const missing = groupKeys.filter((key) => !current.includes(key))
      if (missing.length === 0) return current
      const next = [...current, ...missing]
      writeExpandedSessionGroupKeys(orgId, next)
      return next
    })
  }, [activeId, hermesAgentGroups, hermesCompanyGroups, hermesProjectGroups, hermesWorkspaceGroups, layoutVariant, orgId])
  const menuConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === menuOpenId) ?? null,
    [conversations, menuOpenId],
  )
  const contextTypeOptions = useMemo(
    () => (contextTypePrompt ? filterContextReferenceMentionOptions(
      contextTypePrompt.query,
      { includeWorkbenchPaths: Boolean(activeConversation?.workspaceContext) },
    ) : []),
    [activeConversation?.workspaceContext, contextTypePrompt],
  )
  const contextPickerOpen = Boolean(contextTypePrompt || contextMention)
  const isAgentComposerMention = Boolean(contextMention && (
    contextMention.kind === 'agent' || isAgentMentionNamespace(contextMention.namespace)
  ))
  const contextPickerOptionCount = contextTypePrompt
    ? contextTypeOptions.length
    : contextMention && !contextSearchLoading
      ? (isAgentComposerMention ? agentMentionResults.length : contextSearchResults.length)
      : 0
  const contextPickerActiveOptionId = contextPickerOpen && contextPickerOptionCount > 0
    ? `${contextPickerPanelId}-option-${Math.min(contextPickerActiveIndex, contextPickerOptionCount - 1)}`
    : undefined
  useEffect(() => {
    setContextPickerActiveIndex(0)
  }, [contextMention?.token, contextTypePrompt?.token])
  useEffect(() => {
    setContextPickerActiveIndex((current) => Math.max(0, Math.min(current, contextPickerOptionCount - 1)))
  }, [contextPickerOptionCount])
  const slashAccessAgent = useMemo(() => {
    const agentId = activeConversation?.participantAgentIds?.[0]
      || activeConversation?.orchestration?.dispatcherAgentId
      || initialAgentId
      || 'pip'
    const row = agentMap[agentId as AgentId]
    return {
      agentId: String(agentId),
      ownerUserId: row?.ownerUserId ?? null,
      accessScope: row?.accessScope ?? null,
      provisioningMode: row?.provisioningMode ?? null,
      scopeOrgId: row?.scopeOrgId ?? null,
    }
  }, [
    activeConversation?.participantAgentIds,
    activeConversation?.orchestration?.dispatcherAgentId,
    agentMap,
    initialAgentId,
  ])

  const slashAccessActor = useMemo(() => {
    const role = userRole || (allowManageConversationAccess ? 'admin' : 'client')
    // Admin Messages surface: platform staff manage client orgs. Super-admin
    // is approximated as admin surface + admin role (restricted admins still
    // get org-manager operator rights for linked/org agents).
    const isPlatformAdminSurface = allowManageConversationAccess || role === 'admin'
    return {
      uid: currentUserUid,
      role,
      isSuperAdmin: isPlatformAdminSurface && role === 'admin',
      isOrgManager: isPlatformAdminSurface || role === 'owner' || role === 'admin',
    }
  }, [allowManageConversationAccess, currentUserUid, userRole])

  const slashCommandOptions = useMemo(
    () => (slashPrompt
      ? listSlashCommandsForAccess({
          query: slashPrompt.query,
          actor: slashAccessActor,
          conversation: {
            startedBy: activeConversation?.startedBy ?? null,
            ownerUserId: activeConversation?.workspaceContext?.ownerUserId ?? null,
          },
          agent: slashAccessAgent,
        })
      : []),
    [slashPrompt, slashAccessActor, slashAccessAgent, activeConversation?.startedBy, activeConversation?.workspaceContext?.ownerUserId],
  )

  const coerceContextRef = useCallback((ref: ContextReference | ContextReferenceSeed): ContextReference => ({
    type: ref.type,
    id: ref.id,
    orgId: ref.orgId ?? orgId,
    label: contextChipLabel(ref),
    origin: ref.origin ?? 'manual',
    ...(ref.href ? { href: ref.href } : {}),
    ...(ref.summary ? { summary: ref.summary } : {}),
    ...(ref.metadata ? { metadata: ref.metadata } : {}),
    ...('resolvedAt' in ref && ref.resolvedAt ? { resolvedAt: ref.resolvedAt } : {}),
  }), [orgId])

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({ orgId })
    if (projectId) params.set('projectId', projectId)
    if (scope) params.set('scope', scope)
    if (scopeRefId) params.set('scopeRefId', scopeRefId)
    if (includeAllScopes) params.set('includeAllScopes', 'true')
    // Hermes/Messages rails derive Cowork folders from the conversation page.
    // Default API limit is 30; older company chats fall off the rail unless we
    // request the full allowed page (and keep live SSE on the same limit).
    if (includeAllScopes || layoutVariant === 'hermes') params.set('limit', '100')
    return params.toString()
  }, [includeAllScopes, layoutVariant, orgId, projectId, scope, scopeRefId])

  useEffect(() => {
    if (!companyCoworkLocked || !scopeRefId) return
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewScope('company')
    setSelectedCompanyId(scopeRefId)
    if (orgName?.trim()) setSelectedCompanyName(orgName.trim())
  }, [companyCoworkLocked, orgName, scopeRefId])

  // ── Load agents (for colorKey lookup and authorized Agent folders) ──────────
  useEffect(() => {
    let cancelled = false
    setAgentMap({} as Record<AgentId, AgentTeamDoc>)
    fetch(`/api/v1/orgs/${orgId}/visible-agents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.data) return
        const map = {} as Record<AgentId, AgentTeamDoc>
        for (const agent of body.data as AgentTeamDoc[]) {
          map[agent.agentId] = agent
        }
        setAgentMap(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [orgId])

  // Active chat machine for @agent mentions — same rule as New Conversation:
  // context → computer → agents available on that runtime (not a hard-coded roster).
  const mentionRuntimeTargetId = useMemo(() => {
    const fromContext = activeConversation?.workspaceContext?.runtimeTarget?.trim()
    if (fromContext) return fromContext
    const fromPresence = activeRuntimePresence?.id?.trim()
    return fromPresence || null
  }, [activeConversation?.workspaceContext?.runtimeTarget, activeRuntimePresence?.id])

  const mentionRuntimeLabel = activeConversation?.workspaceContext?.runtimeLabel
    ?? activeRuntimePresence?.label
    ?? null

  useEffect(() => {
    let cancelled = false
    setMentionAgentsStatus('loading')
    setMentionAgentsEmptyReason(null)
    const params = new URLSearchParams()
    if (mentionRuntimeTargetId) params.set('runtimeTarget', mentionRuntimeTargetId)
    const query = params.size > 0 ? `?${params.toString()}` : ''
    fetch(`/api/v1/orgs/${orgId}/visible-agents${query}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) return
        const rows = Array.isArray(body?.data) ? (body.data as AgentTeamDoc[]) : []
        // Live heartbeat inventory is authoritative when the bound machine reports it.
        const liveIds = activeRuntimePresence && Array.isArray(activeRuntimePresence.availableAgentIds)
          ? activeRuntimePresence.availableAgentIds
          : null
        const gated = filterAgentsByGate(
          rows.filter((agent) => agent.enabled !== false),
          liveIds,
        )
        setMentionAgents(gated)
        setMentionAgentsStatus('ready')
        if (gated.length === 0) {
          if (liveIds && liveIds.length === 0) {
            setMentionAgentsEmptyReason(
              mentionRuntimeLabel
                ? `No agents are running on ${mentionRuntimeLabel} yet`
                : 'No agents are running on this chat’s computer yet',
            )
          } else if (mentionRuntimeTargetId) {
            setMentionAgentsEmptyReason(
              mentionRuntimeLabel
                ? `No agents available on ${mentionRuntimeLabel} for your account`
                : 'No agents available on this chat’s computer for your account',
            )
          } else {
            setMentionAgentsEmptyReason('No agents loaded for this organisation yet')
          }
        } else {
          setMentionAgentsEmptyReason(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setMentionAgents([])
        setMentionAgentsStatus('error')
        setMentionAgentsEmptyReason('Could not load agents for this chat’s computer')
      })
    return () => { cancelled = true }
  }, [
    activeRuntimePresence,
    mentionRuntimeLabel,
    mentionRuntimeTargetId,
    orgId,
  ])

  useEffect(() => {
    let cancelled = false
    let hasLoaded = false
    let requestSequence = 0
    let activeRequestId = 0
    let activeController: AbortController | null = null
    setWorkspaceCatalogueLoaded(false)

    const loadWorkspaceCatalogue = async (showLoading: boolean): Promise<WorkspaceCatalogueSnapshot | null> => {
      const requestId = ++requestSequence
      activeRequestId = requestId
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      if (showLoading) setWorkspacesLoading(true)
      try {
        const response = await fetch(`/api/v1/workspaces?${new URLSearchParams({
          orgId,
          agentId: workspaceCatalogueAgentId,
        }).toString()}`, { signal: controller.signal })
        const body = response.ok ? await response.json() : null
        // A recovery refresh can overtake the normal healthy-catalogue poll.
        // Only its newest result may change the bound runtime or composer.
        if (cancelled || controller.signal.aborted || requestId !== activeRequestId || !body?.data) return null
        const next = Array.isArray(body.data.workspaces)
          ? (body.data.workspaces as OrgWorkspaceSummary[])
          : []
        const runtimes = Array.isArray(body.data.runtimeTargets)
          ? (body.data.runtimeTargets as WorkspaceRuntimePresence[])
          : []
        const runtimeTargetsByWorkspace = body.data.runtimeTargetsByWorkspace && typeof body.data.runtimeTargetsByWorkspace === 'object'
          ? body.data.runtimeTargetsByWorkspace as Record<string, WorkspaceRuntimePresence[]>
          : Object.fromEntries(next.map((workspace) => [workspace.workspaceId, runtimes]))
        const projects = normalizeWorkspaceProjectSummaries(body.data.projects)
        const snapshot = { workspaces: next, projects, runtimeTargetsByWorkspace }
        hasLoaded = true
        setWorkspaces(next)
        setWorkspaceProjects(projects)
        setWorkspaceRuntimeTargetsByWorkspace(runtimeTargetsByWorkspace)
        setWorkspaceRuntimeTargetsByAgent((current) => ({
          ...current,
          [workspaceCatalogueAgentId]: runtimeTargetsByWorkspace,
        }))
        setWorkspaceCatalogueLoaded(true)
        // Prefer organisation-root Workspaces; company Cowork trees are not valid
        // defaults for "Organisation root" / project runtime pickers.
        const organisationRoots = next.filter(isOrganisationWorkspace)
        const preferredRoots = organisationRoots.length > 0 ? organisationRoots : next
        const initialWorkspaceId = preferredRoots[0]?.workspaceId || ''
        const initialWorkspace = preferredRoots.find((workspace) => workspace.workspaceId === initialWorkspaceId) ?? preferredRoots[0]
        setSelectedWorkspaceId((current) => {
          if (current && preferredRoots.some((workspace) => workspace.workspaceId === current)) return current
          if (current && next.some((workspace) => workspace.workspaceId === current && isOrganisationWorkspace(workspace))) return current
          return initialWorkspaceId
        })
        setSelectedProjectId((current) => current || projectId || projects[0]?.id || '')
        setSelectedWorkspaceRuntime((current) => {
          if (workspaceRuntimeExplicitRef.current) return current
          const initialRuntimes = runtimeTargetsByWorkspace[initialWorkspaceId] ?? runtimes
          const currentTarget = initialRuntimes.find((runtime) => workspaceRuntimeSelectionKey(runtime) === current)
          if (currentTarget?.selectable) return current
          const preferred = pickPreferredWorkspaceRuntime(initialRuntimes, {
            preferredTargetId: initialWorkspace?.defaultRuntimeTarget,
          })
          return preferred ? workspaceRuntimeSelectionKey(preferred) : ''
        })
        return snapshot
      } catch {
        if (!cancelled && !controller.signal.aborted && requestId === activeRequestId && !hasLoaded) {
          setWorkspaces([])
          setWorkspaceProjects([])
          setWorkspaceRuntimeTargetsByWorkspace({})
        }
        return null
      } finally {
        if (requestId === activeRequestId) {
          activeController = null
          if (!cancelled) setWorkspacesLoading(false)
        }
      }
    }

    refreshWorkspaceCatalogueRef.current = () => loadWorkspaceCatalogue(false)
    void loadWorkspaceCatalogue(true)
    const interval = window.setInterval(() => {
      if (!shouldPollWorkspaceCatalogue(document.visibilityState)) return
      void loadWorkspaceCatalogue(false)
    }, WORKSPACE_CATALOGUE_HEALTHY_REFRESH_MS)
    return () => {
      cancelled = true
      activeController?.abort()
      refreshWorkspaceCatalogueRef.current = async () => null
      window.clearInterval(interval)
    }
  }, [orgId, projectId, workspaceCatalogueAgentId])

  useEffect(() => {
    setWorkspaceRuntimeTargetsByAgent({})
  }, [orgId])

  // A signed runtime retries its heartbeat promptly after a temporary outage.
  // Poll its catalogue a little faster while this exact bound computer is
  // recovering so the composer re-enables without a manual refresh. This never
  // selects or fails over to another machine.
  useEffect(() => {
    if (!shouldRefreshUnavailableRuntime) return
    if (shouldPollWorkspaceCatalogue(document.visibilityState)) {
      void refreshWorkspaceCatalogueRef.current()
    }
    const interval = window.setInterval(() => {
      if (!shouldPollWorkspaceCatalogue(document.visibilityState)) return
      void refreshWorkspaceCatalogueRef.current()
    }, WORKSPACE_CATALOGUE_RECOVERY_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [shouldRefreshUnavailableRuntime])

  useEffect(() => {
    if (!showProjectSetupWizard) return
    let cancelled = false
    setRegisteredWorkspaceFoldersLoading(true)
    fetch(`/api/v1/workspace-folders?${new URLSearchParams({ orgId }).toString()}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`workspace folders: ${response.status}`)))
      .then((body) => {
        if (cancelled) return
        const safeFolders = (Array.isArray(body?.data) ? body.data : []).flatMap((folder: unknown) => {
          if (!folder || typeof folder !== 'object') return []
          const row = folder as Record<string, unknown>
          const id = typeof row.id === 'string' ? row.id.trim() : ''
          const name = typeof row.name === 'string' ? row.name.trim() : ''
          if (!id || !name) return []
          const syncState = row.syncState && typeof row.syncState === 'object'
            ? row.syncState as Record<string, unknown>
            : undefined
          return [{
            id,
            name,
            ...(typeof syncState?.status === 'string' ? { syncStatus: syncState.status } : {}),
          }]
        })
        setRegisteredWorkspaceFolders(safeFolders)
        setProjectSetupWorkspaceFolderId(safeFolders[0]?.id ?? '')
      })
      .catch(() => {
        if (!cancelled) {
          setRegisteredWorkspaceFolders([])
          setProjectSetupWorkspaceFolderId('')
        }
      })
      .finally(() => {
        if (!cancelled) setRegisteredWorkspaceFoldersLoading(false)
      })
    return () => { cancelled = true }
  }, [orgId, showProjectSetupWizard])

  useEffect(() => {
    setPinnedConversationIds(readPinnedConversationIds(orgId))
    setExpandedSessionGroupKeys(readExpandedSessionGroupKeys(orgId))
  }, [orgId])

  useEffect(() => {
    const controller = new AbortController()
    activeHiddenFolderOrgIdRef.current = orgId
    hiddenFolderMutationInFlightRef.current = false
    setHiddenFolderKeys([])
    setHiddenFolderPreferencesLoaded(false)
    setHiddenFolderPreferencesSaving(false)
    setShowHiddenFolders(false)
    fetch(`/api/v1/account/messages-sidebar-preferences?${new URLSearchParams({ orgId }).toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error ?? `Load sidebar preferences: ${response.status}`)
        return Array.isArray(body?.data?.hiddenFolderKeys) ? body.data.hiddenFolderKeys as string[] : []
      })
      .then((keys) => {
        if (!controller.signal.aborted && activeHiddenFolderOrgIdRef.current === orgId) setHiddenFolderKeys(keys)
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        if (activeHiddenFolderOrgIdRef.current === orgId) setHiddenFolderKeys([])
      })
      .finally(() => {
        if (!controller.signal.aborted && activeHiddenFolderOrgIdRef.current === orgId) setHiddenFolderPreferencesLoaded(true)
      })
    return () => controller.abort()
  }, [orgId])

  const persistHiddenFolderKeys = useCallback(async (nextKeys: string[]) => {
    if (hiddenFolderMutationInFlightRef.current || !hiddenFolderPreferencesLoaded) return
    hiddenFolderMutationInFlightRef.current = true
    setHiddenFolderPreferencesSaving(true)
    const requestOrgId = orgId
    const previous = hiddenFolderKeys
    setHiddenFolderKeys(nextKeys)
    setFolderActionsOpenKey(null)
    try {
      const response = await fetch(`/api/v1/account/messages-sidebar-preferences?${new URLSearchParams({ orgId: requestOrgId }).toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenFolderKeys: nextKeys }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? `Save sidebar preferences: ${response.status}`)
      const saved = Array.isArray(body?.data?.hiddenFolderKeys) ? body.data.hiddenFolderKeys as string[] : nextKeys
      if (activeHiddenFolderOrgIdRef.current === requestOrgId) setHiddenFolderKeys(saved)
    } catch (preferenceError) {
      if (activeHiddenFolderOrgIdRef.current === requestOrgId) {
        setHiddenFolderKeys(previous)
        setError(preferenceError instanceof Error ? preferenceError.message : 'Could not save sidebar preferences')
      }
    } finally {
      if (activeHiddenFolderOrgIdRef.current === requestOrgId) {
        hiddenFolderMutationInFlightRef.current = false
        setHiddenFolderPreferencesSaving(false)
      }
    }
  }, [hiddenFolderKeys, hiddenFolderPreferencesLoaded, orgId])

  const hideFolderFromSidebar = useCallback((folderKey: string) => {
    if (!folderKey.startsWith('workspace:') && !folderKey.startsWith('agent:')) return
    void persistHiddenFolderKeys(Array.from(new Set([...hiddenFolderKeys, folderKey])))
  }, [hiddenFolderKeys, persistHiddenFolderKeys])

  const restoreFolderToSidebar = useCallback((folderKey: string) => {
    void persistHiddenFolderKeys(hiddenFolderKeys.filter((key) => key !== folderKey))
  }, [hiddenFolderKeys, persistHiddenFolderKeys])

  const togglePinnedConversation = useCallback((conversationId: string) => {
    setPinnedConversationIds((current) => {
      const next = current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [conversationId, ...current]
      writePinnedConversationIds(orgId, next)
      return next
    })
  }, [orgId])

  const toggleSessionGroup = useCallback((groupKey: string) => {
    setExpandedSessionGroupKeys((current) => {
      const next = current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
      writeExpandedSessionGroupKeys(orgId, next)
      return next
    })
  }, [orgId])

  const openNewConversation = useCallback((forProjectId?: string) => {
    if (!allowStartConversations) {
      setError('Starting new conversations is disabled for your organisation role.')
      return
    }
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewInitialAgentIds([])
    if (forProjectId) {
      setNewScope('project')
      setSelectedProjectId(forProjectId)
    } else if (scope === 'company' && scopeRefId) {
      setNewScope('company')
      setSelectedCompanyId(scopeRefId)
      if (orgName?.trim()) setSelectedCompanyName(orgName.trim())
    }
    setModalError(null)
    setShowNewModal(true)
  }, [allowStartConversations, orgName, scope, scopeRefId])

  const openNewCompanyConversation = useCallback((companyId: string, companyName: string) => {
    if (!allowStartConversations) {
      setError('Starting new conversations is disabled for your organisation role.')
      return
    }
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewScope('company')
    setNewInitialAgentIds([])
    setSelectedCompanyId(companyId)
    setSelectedCompanyName(companyName)
    setModalError(null)
    setShowNewModal(true)
  }, [allowStartConversations])

  const openNewWorkspaceConversation = useCallback((workspaceId: string) => {
    if (!allowStartConversations) {
      setError('Starting new conversations is disabled for your organisation role.')
      return
    }
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewScope('workspace')
    setSelectedWorkspaceId(workspaceId)
    setSelectedWorkspaceRuntime('')
    workspaceRuntimeExplicitRef.current = false
    setNewInitialAgentIds([])
    setModalError(null)
    setShowNewModal(true)
  }, [allowStartConversations])

  const openNewAgentConversation = useCallback((agentId: string) => {
    if (!allowStartConversations) {
      setError('Starting new conversations is disabled for your organisation role.')
      return
    }
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewScope('general')
    setNewParticipants([])
    setNewInitialAgentIds([agentId])
    setModalError(null)
    setShowNewModal(true)
  }, [allowStartConversations])

  const closeNewConversation = useCallback(() => {
    setShowNewModal(false)
    setShowProjectSetupWizard(false)
    setModalError(null)
    setNewInitialAgentIds([])
    setNewConversationWorkforceBlueprintId('')
  }, [])

  const openProjectSetupWizard = useCallback(() => {
    projectSetupIdempotencyKeyRef.current = newProjectSetupIdempotencyKey()
    setProjectSetupMode('existing_folder')
    setProjectSetupCompanyId('')
    setProjectSetupCompanyName('')
    setProjectSetupExistingProjects([])
    setProjectSetupLibraryLoading(false)
    setProjectSetupAddingProjectId('')
    setProjectSetupName('')
    setProjectSetupWorkspaceId(selectedWorkspaceId || workspaces[0]?.workspaceId || '')
    setProjectSetupWorkspaceFolderId('')
    setProjectSetupLocationIds([])
    setProjectSetupClientName('')
    setProjectSetupDomainSlug('')
    setProjectSetupAgentName('Pip')
    setRegisteredWorkspaceFolders([])
    setProjectSetupError(null)
    setProjectSetupResult(null)
    setShowProjectSetupWizard(true)
  }, [selectedWorkspaceId, workspaces])

  const openNewProject = useCallback(() => {
    if (!allowStartConversations) {
      setError('Creating projects is disabled for your organisation role.')
      return
    }
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewScope('project')
    setModalError(null)
    setShowNewModal(true)
    openProjectSetupWizard()
  }, [allowStartConversations, openProjectSetupWizard])

  const setNewConversationScope = useCallback((nextScope: ConversationScope) => {
    selectedWorkspaceShareModeTouchedRef.current = false
    setNewConversationWorkforceBlueprintId('')
    setNewScope(nextScope)
  }, [])

  const removeProjectFromSidebar = useCallback(async (projectIdToRemove: string) => {
    setError(null)
    try {
      const query = new URLSearchParams({ orgId, projectId: projectIdToRemove }).toString()
      const response = await fetch(`/api/v1/project-library?${query}`, { method: 'DELETE' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? `Remove project: ${response.status}`)
      if (selectedProjectId === projectIdToRemove) setSelectedProjectId('')
      if (managedProject?.id === projectIdToRemove) setManagedProject(null)
      await refreshWorkspaceCatalogueRef.current()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove project')
    }
  }, [managedProject?.id, orgId, selectedProjectId])

  const addExistingProjectToSidebar = useCallback(async (project: { id: string; name: string }) => {
    setProjectSetupAddingProjectId(project.id)
    setProjectSetupError(null)
    try {
      const response = await fetch('/api/v1/project-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, projectId: project.id }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? `Add project: ${response.status}`)
      await refreshWorkspaceCatalogueRef.current()
      setNewScope('project')
      setSelectedProjectId(project.id)
      setShowProjectSetupWizard(false)
    } catch (addError) {
      setProjectSetupError(addError instanceof Error ? addError.message : 'Could not add project')
    } finally {
      setProjectSetupAddingProjectId('')
    }
  }, [orgId])

  const loadManagedProjectLocations = useCallback(async (projectIdToLoad: string, showLoading = true): Promise<ManagedProjectLocation[]> => {
    if (showLoading) setProjectLocationsLoading(true)
    setProjectLocationsError(null)
    try {
      const query = new URLSearchParams({ orgId }).toString()
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectIdToLoad)}/locations?${query}`)
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Project locations: ${response.status}`)
      const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : null
      const locations = normalizeManagedProjectLocations(data?.locations)
      setManagedProjectLocations(locations)
      return locations
    } catch (locationError) {
      setManagedProjectLocations([])
      setProjectLocationsError(locationError instanceof Error ? locationError.message : 'Failed to load project locations')
      return []
    } finally {
      if (showLoading) setProjectLocationsLoading(false)
    }
  }, [orgId])

  const loadManagedProjectSync = useCallback(async (projectIdToLoad: string, showLoading = true) => {
    if (showLoading) setProjectSyncLoading(true)
    try {
      const query = new URLSearchParams({ orgId }).toString()
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectIdToLoad)}/sync?${query}`)
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Project sync: ${response.status}`)
      const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : null
      const request = data?.request && typeof data.request === 'object'
        ? data.request as Record<string, unknown>
        : null
      const conflict = request?.conflict && typeof request.conflict === 'object'
        ? request.conflict as Record<string, unknown>
        : null
      setManagedProjectSync({
        projectId: projectIdToLoad,
        status: typeof request?.status === 'string' ? request.status : null,
        conflictKind: typeof conflict?.kind === 'string' ? conflict.kind : null,
        blocker: typeof data?.blocker === 'string' ? data.blocker : null,
        notice: null,
        noticeTone: 'neutral',
      })
    } catch (syncError) {
      setManagedProjectSync({
        projectId: projectIdToLoad,
        status: null,
        conflictKind: null,
        blocker: null,
        notice: syncError instanceof Error ? syncError.message : 'Failed to load project sync status',
        noticeTone: 'error',
      })
    } finally {
      if (showLoading) setProjectSyncLoading(false)
    }
  }, [orgId])

  const openProjectLocationManager = useCallback((project: { id: string; name: string }) => {
    setManagedProject(project)
    setManagedProjectLocations([])
    setSelectedManagedProjectLocationKeys([])
    setProjectLocationsError(null)
    setManagedProjectSync(null)
    void Promise.all([
      loadManagedProjectLocations(project.id),
      loadManagedProjectSync(project.id),
    ])
  }, [loadManagedProjectLocations, loadManagedProjectSync])

  useEffect(() => {
    if (!managedProject) return
    const projectIdToRefresh = managedProject.id
    const interval = window.setInterval(() => {
      if (projectSyncInFlightRef.current || projectSyncRefreshInFlightRef.current || document.visibilityState === 'hidden') return
      projectSyncRefreshInFlightRef.current = true
      void Promise.all([
        loadManagedProjectLocations(projectIdToRefresh, false),
        loadManagedProjectSync(projectIdToRefresh, false),
      ]).finally(() => { projectSyncRefreshInFlightRef.current = false })
    }, PROJECT_SYNC_STATUS_REFRESH_INTERVAL)
    return () => window.clearInterval(interval)
  }, [loadManagedProjectLocations, loadManagedProjectSync, managedProject])

  const requestManagedProjectSync = useCallback(async (
    project: { id: string; name: string },
    locations: ManagedProjectLocation[],
  ) => {
    if (projectSyncInFlightRef.current || !managedProjectCanSync(locations)) return
    projectSyncInFlightRef.current = true
    setProjectSyncSubmitting(true)
    setManagedProjectSync((current) => ({
      projectId: project.id,
      status: current?.projectId === project.id ? current.status : null,
      conflictKind: current?.projectId === project.id ? current.conflictKind : null,
      blocker: null,
      notice: null,
      noticeTone: 'neutral',
    }))
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Project sync: ${response.status}`)
      const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : null
      const request = data?.request && typeof data.request === 'object'
        ? data.request as Record<string, unknown>
        : null
      const conflict = request?.conflict && typeof request.conflict === 'object'
        ? request.conflict as Record<string, unknown>
        : null
      const blocker = typeof data?.blocker === 'string' ? data.blocker : null
      const message = typeof data?.message === 'string' ? data.message.trim() : ''
      const transferStarted = data?.transferStarted === true
      setManagedProjectSync({
        projectId: project.id,
        status: typeof request?.status === 'string' ? request.status : null,
        conflictKind: typeof conflict?.kind === 'string' ? conflict.kind : null,
        blocker,
        notice: transferStarted
          ? `Sync started.${message ? ` ${message}` : ''}`
          : blocker
            ? `Sync requested, but file transfer is ${projectSyncBlockerMessage(blocker)}`
            : `Sync request recorded.${message ? ` ${message}` : ''}`,
        noticeTone: transferStarted ? 'success' : blocker ? 'blocker' : 'neutral',
      })
      await Promise.all([
        loadManagedProjectLocations(project.id, false),
        refreshWorkspaceCatalogueRef.current(),
      ])
    } catch (syncError) {
      setManagedProjectSync((current) => ({
        projectId: project.id,
        status: current?.projectId === project.id ? current.status : null,
        conflictKind: current?.projectId === project.id ? current.conflictKind : null,
        blocker: null,
        notice: syncError instanceof Error ? syncError.message : 'Failed to start project sync',
        noticeTone: 'error',
      }))
      await Promise.all([
        loadManagedProjectLocations(project.id, false),
        refreshWorkspaceCatalogueRef.current(),
      ])
    } finally {
      projectSyncInFlightRef.current = false
      setProjectSyncSubmitting(false)
    }
  }, [loadManagedProjectLocations, orgId])

  const resetManagedProjectSync = useCallback(async (project: { id: string; name: string }) => {
    if (projectSyncInFlightRef.current) return
    projectSyncInFlightRef.current = true
    setProjectSyncResetting(true)
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/sync`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Project sync: ${response.status}`)
      const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : null
      const request = data?.request && typeof data.request === 'object'
        ? data.request as Record<string, unknown>
        : null
      setManagedProjectSync({
        projectId: project.id,
        status: typeof request?.status === 'string' ? request.status : 'cancelled',
        conflictKind: null,
        blocker: null,
        notice: 'The sync request was reset without overwriting either version. After reconciling the files on the linked machines, select Sync now to begin fresh inventory.',
        noticeTone: 'success',
      })
      await Promise.all([
        loadManagedProjectLocations(project.id, false),
        refreshWorkspaceCatalogueRef.current(),
      ])
    } catch (syncError) {
      setManagedProjectSync((current) => ({
        projectId: project.id,
        status: current?.projectId === project.id ? current.status : null,
        conflictKind: current?.projectId === project.id ? current.conflictKind : null,
        blocker: current?.projectId === project.id ? current.blocker : null,
        notice: syncError instanceof Error ? syncError.message : 'Failed to reset project sync',
        noticeTone: 'error',
      }))
    } finally {
      projectSyncInFlightRef.current = false
      setProjectSyncResetting(false)
    }
  }, [loadManagedProjectLocations, orgId])

  const handleLinkManagedProjectLocations = useCallback(async () => {
    if (!managedProject || projectLocationsMutating) return
    const selectedCandidates = managedUnlinkedLocationCandidates.filter((candidate) =>
      candidate.selectable && selectedManagedProjectLocationKeys.includes(candidate.key),
    )
    if (selectedCandidates.length === 0) return
    setProjectLocationsMutating(true)
    setProjectLocationsError(null)
    let mutationError: string | null = null
    try {
      for (const candidate of selectedCandidates) {
        const payload: Record<string, unknown> = {
          orgId,
          workspaceId: candidate.workspaceId,
          locationId: candidate.locationId,
          ...(candidate.mappingId ? { mappingId: candidate.mappingId } : {}),
        }
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(managedProject.id)}/locations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await readApiResponse(response)
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Link location: ${response.status}`)
      }
    } catch (linkError) {
      mutationError = linkError instanceof Error ? linkError.message : 'Failed to link project location'
    }
    const [nextLocations] = await Promise.all([
      loadManagedProjectLocations(managedProject.id, false),
      refreshWorkspaceCatalogueRef.current(),
    ])
    setSelectedManagedProjectLocationKeys([])
    if (mutationError) setProjectLocationsError(mutationError)
    if (!mutationError && !managedProjectCanSync(managedProjectLocations) && managedProjectCanSync(nextLocations)) {
      await requestManagedProjectSync(managedProject, nextLocations)
    }
    setProjectLocationsMutating(false)
  }, [loadManagedProjectLocations, managedProject, managedProjectLocations, managedUnlinkedLocationCandidates, orgId, projectLocationsMutating, requestManagedProjectSync, selectedManagedProjectLocationKeys])

  const handleUnlinkManagedProjectLocation = useCallback(async (location: ManagedProjectLocation) => {
    if (!managedProject || projectLocationsMutating) return
    setProjectLocationsMutating(true)
    setProjectLocationsError(null)
    let mutationError: string | null = null
    try {
      const query = new URLSearchParams({ orgId }).toString()
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(managedProject.id)}/locations/${encodeURIComponent(location.replicaId)}?${query}`,
        { method: 'DELETE' },
      )
      const body = await readApiResponse(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Unlink location: ${response.status}`)
    } catch (unlinkError) {
      mutationError = unlinkError instanceof Error ? unlinkError.message : 'Failed to unlink project location'
    }
    await Promise.all([
      loadManagedProjectLocations(managedProject.id, false),
      refreshWorkspaceCatalogueRef.current(),
    ])
    if (mutationError) setProjectLocationsError(mutationError)
    setProjectLocationsMutating(false)
  }, [loadManagedProjectLocations, managedProject, orgId, projectLocationsMutating])

  const loadModelCatalog = useCallback(async () => {
    if (!activeId || !activeModelAgentId) {
      setModelCatalog(null)
      setSelectedRuntime(null)
      return
    }
    setModelCatalogLoading(true)
    try {
      const params = new URLSearchParams({ agentId: activeModelAgentId })
      const res = await fetch(`/api/v1/conversations/${activeId}/models?${params.toString()}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `model catalogue: ${res.status}`)
      const catalog = body.data as MessageModelCatalog
      setModelCatalog(catalog)
      setSelectedRuntime((previous) => {
        if (previous && catalog.models.some((model) => model.model === previous.model
          && model.provider === previous.provider
          && model.connectionId === previous.llmConnectionId
          && model.credentialBindingId === previous.llmCredentialBindingId)) {
          return previous
        }
        return null
      })
    } catch {
      setModelCatalog(null)
      setSelectedRuntime(null)
    } finally {
      setModelCatalogLoading(false)
    }
  }, [activeId, activeModelAgentId])

  const loadWorkbenchFiles = useCallback(async () => {
    if (!activeId) return
    setWorkbenchFilesLoading(true)
    try {
      const job = await runConversationWorkbenchJob(activeId, { kind: 'fs.list', path: WORKBENCH_ROOT_PATH })
      const result = workbenchJobResult<{ entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> }>(job)
      setWorkbenchLiveFiles({
        source: 'sync',
        tree: workbenchEntriesToTree(result.entries),
      })
      setWorkbenchFilesMessage(null)
    } catch (filesError) {
      setWorkbenchLiveFiles({ source: 'none', tree: [] })
      setWorkbenchFilesMessage(filesError instanceof Error ? filesError.message : 'Failed to load files from the linked computer')
    } finally {
      setWorkbenchFilesLoading(false)
    }
  }, [activeId])

  const loadWorkbenchChanges = useCallback(async () => {
    if (!activeId) return
    setWorkbenchChangesLoading(true)
    try {
      const statusJob = await runConversationWorkbenchJob(activeId, { kind: 'git.status' })
      const status = workbenchJobResult<{ changes: Array<{ path: string; status: string }> }>(statusJob)
      const [unstagedJob, stagedJob] = await Promise.all([
        runConversationWorkbenchJob(activeId, { kind: 'git.diff', staged: false }),
        runConversationWorkbenchJob(activeId, { kind: 'git.diff', staged: true }),
      ])
      const unstaged = workbenchJobResult<{ diff: string }>(unstagedJob)
      const staged = workbenchJobResult<{ diff: string }>(stagedJob)
      setWorkbenchLiveChanges(attachWorkbenchDiffs(workbenchStatusToChanges(status.changes), [unstaged.diff, staged.diff].filter(Boolean).join('\n')))
      setWorkbenchChangesMessage('Live git status and diff from the linked computer.')
    } catch (changesError) {
      setWorkbenchLiveChanges(null)
      setWorkbenchChangesMessage(changesError instanceof Error ? changesError.message : null)
    } finally {
      setWorkbenchChangesLoading(false)
    }
  }, [activeId])

  const loadWorkbenchDirectory = useCallback(async (path: string) => {
    if (!activeId) return
    try {
      const job = await runConversationWorkbenchJob(activeId, { kind: 'fs.list', path })
      const result = workbenchJobResult<{ entries: Array<{ path: string; type: 'file' | 'directory'; size?: number }> }>(job)
      setWorkbenchLiveFiles((current) => ({
        source: 'sync',
        tree: mergeWorkbenchDirectory(current.tree, path, result.entries),
      }))
      setWorkbenchFilesMessage(null)
    } catch (directoryError) {
      setWorkbenchFilesMessage(directoryError instanceof Error ? directoryError.message : `Failed to load ${path}`)
      // Keep the current tree visible; expanding again or refreshing can retry.
      return
    }
  }, [activeId])

  const loadWorkbenchFileContent = useCallback(async (path: string) => {
    if (!activeId) return
    setWorkbenchFilePreview({ path, content: null, loading: true, error: null })
    try {
      const job = await runConversationWorkbenchJob(activeId, { kind: 'fs.read', path })
      const result = workbenchJobResult<{ content: string; sha256: string }>(job)
      setWorkbenchFilePreview({ path, content: result.content, sha256: result.sha256, loading: false, error: null })
    } catch (contentError) {
      setWorkbenchFilePreview({
        path,
        content: null,
        loading: false,
        error: contentError instanceof Error ? contentError.message : 'Failed to load file content',
      })
    }
  }, [activeId])

  const handleSelectWorkbenchFilePath = useCallback((path: string) => {
    setWorkbenchSelectedFilePath(path)
    void loadWorkbenchFileContent(path)
  }, [loadWorkbenchFileContent])

  const saveWorkbenchFile = useCallback(async (path: string, content: string, expectedSha256?: string) => {
    if (!activeId) throw new Error('No active conversation')
    const job = await runConversationWorkbenchJob(activeId, {
      kind: 'fs.write',
      path,
      content,
      ...(expectedSha256 ? { expectedSha256 } : {}),
    }, { approveWrite: true })
    const result = workbenchJobResult<{ bytesWritten: number; sha256: string }>(job)
    setWorkbenchFilePreview({ path, content, sha256: result.sha256, loading: false, error: null })
    void loadWorkbenchChanges()
    return { sha256: result.sha256 }
  }, [activeId, loadWorkbenchChanges])

  const runWorkbenchTerminalCommand = useCallback(async (command: string) => {
    if (!activeId || workbenchTerminalRunning) return
    const entryId = `local-terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const startedAt = Date.now()
    setWorkbenchTerminalRunning(true)
    setWorkbenchLocalTerminalEntries((entries) => [
      ...entries,
      { id: entryId, status: 'running' as const, label: command, meta: 'running…', body: `$ ${command}`, timestamp: startedAt },
    ].slice(-24))

    const finish = (status: 'done' | 'failed', outputBody: string) => {
      setWorkbenchLocalTerminalEntries((entries) => entries.map((entry) => (
        entry.id === entryId
          ? { ...entry, status, meta: `${Date.now() - startedAt}ms`, body: outputBody.startsWith('$ ') ? outputBody : `$ ${command}\n${outputBody}` }
          : entry
      )))
    }

    try {
      const res = await fetch(`/api/v1/conversations/${activeId}/workbench/terminal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `workbench terminal: ${res.status}`)

      if (typeof body?.data?.cwd === 'string') {
        finish('done', `$ ${command}\n${body.data.cwd}`)
        return
      }

      const jobId = body?.data?.jobId
      let job = body?.data
      const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'expired', 'awaiting_approval'])
      if (jobId && !terminalStatuses.has(job?.status)) {
        job = await pollWorkbenchJob(activeId, jobId, {
          timeoutMs: 90_000,
          onProgress: (liveJob) => {
            setWorkbenchLocalTerminalEntries((entries) => entries.map((entry) => (
              entry.id === entryId
                ? {
                    ...entry,
                    status: 'running',
                    meta: liveJob.status,
                    body: formatWorkbenchProgressBody(command, liveJob),
                  }
                : entry
            )))
          },
        })
      }
      const failed = job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'expired'
        || (job?.kind === 'shell.exec' && job?.result && 'exitCode' in job.result && Number(job.result.exitCode) !== 0)
      finish(failed ? 'failed' : 'done', formatWorkbenchOperationResult(job))
      if (job?.status === 'completed' && (command === 'git status' || command.startsWith('git diff'))) void loadWorkbenchChanges()
    } catch (error) {
      finish('failed', error instanceof Error ? error.message : 'Command failed.')
    } finally {
      setWorkbenchTerminalRunning(false)
    }
  }, [activeId, workbenchTerminalRunning, loadWorkbenchChanges])

  const clearWorkbenchLocalTerminal = useCallback(() => {
    if (workbenchTerminalRunning) return
    setWorkbenchLocalTerminalEntries([])
  }, [workbenchTerminalRunning])

  /** Merges a session snapshot's new-only output chunks into the running transcript, then updates view state. */
  const applyWorkbenchSessionUpdate = useCallback((remote: PublicWorkbenchSession) => {
    workbenchSessionTranscriptRef.current = appendWorkbenchSessionOutput(workbenchSessionTranscriptRef.current, remote)
    setWorkbenchSession({
      sessionId: remote.sessionId,
      status: remote.status,
      transcript: workbenchSessionTranscriptRef.current.text,
      exitCode: remote.exitCode ?? null,
      error: remote.error ?? null,
      busy: false,
    })
  }, [])

  const startWorkbenchSession = useCallback(async () => {
    if (!activeId) return
    if (workbenchSession?.sessionId) {
      setWorkbenchSessionHistory((current) => current.some((item) => item.sessionId === workbenchSession.sessionId) ? current : [...current, workbenchSession])
    }
    workbenchSessionAbortRef.current?.abort()
    const controller = new AbortController()
    workbenchSessionAbortRef.current = controller
    const startTimeout = window.setTimeout(() => controller.abort(), 15_000)
    workbenchSessionTranscriptRef.current = { text: '', lastSeq: -1 }
    setWorkbenchSession({ sessionId: null, status: 'starting', transcript: '', exitCode: null, error: null, busy: true })

    try {
      // A session always starts `awaiting_approval` — a full shell is more
      // powerful than the allowlisted one-shot jobs, so there is nothing to
      // poll until the user approves it in the Terminal panel.
      const created = await createWorkbenchSession(activeId, { signal: controller.signal })
      applyWorkbenchSessionUpdate(created)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setWorkbenchSession((prev) => prev ? { ...prev, status: 'error', error: 'Terminal startup timed out. Check that the linked computer runtime is online, then retry.', busy: false } : prev)
        return
      }
      setWorkbenchSession((prev) => ({
        sessionId: prev?.sessionId ?? null,
        status: 'error',
        transcript: prev?.transcript ?? '',
        exitCode: prev?.exitCode ?? null,
        error: error instanceof Error ? error.message : 'Failed to start the session.',
        busy: false,
      }))
    } finally { window.clearTimeout(startTimeout) }
  }, [activeId, applyWorkbenchSessionUpdate, workbenchSession])

  const selectWorkbenchSession = useCallback((sessionId: string) => {
    const selected = [...workbenchSessionHistory, ...(workbenchSession ? [workbenchSession] : [])].find((item) => item.sessionId === sessionId)
    if (!selected) return
    if (workbenchSession?.sessionId && workbenchSession.sessionId !== sessionId) {
      setWorkbenchSessionHistory((current) => current.filter((item) => item.sessionId !== sessionId).concat(workbenchSession))
    }
    setWorkbenchSession(selected)
  }, [workbenchSession, workbenchSessionHistory])

  const approveWorkbenchSession = useCallback(async () => {
    if (!activeId || !workbenchSession?.sessionId) return
    workbenchSessionAbortRef.current?.abort()
    const controller = new AbortController()
    workbenchSessionAbortRef.current = controller
    setWorkbenchSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const approved = await approveWorkbenchSessionApi(activeId, workbenchSession.sessionId, { signal: controller.signal })
      applyWorkbenchSessionUpdate(approved)
      if (!WORKBENCH_SESSION_TERMINAL_STATUSES.has(approved.status)) {
        await pollWorkbenchSession(activeId, approved.sessionId, {
          signal: controller.signal,
          onProgress: applyWorkbenchSessionUpdate,
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWorkbenchSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to approve the session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchSession?.sessionId, applyWorkbenchSessionUpdate])

  const sendWorkbenchSessionInput = useCallback(async (line: string) => {
    if (!activeId || !workbenchSession?.sessionId) return
    try {
      const updated = await writeWorkbenchSessionStdin(activeId, workbenchSession.sessionId, line, 'line')
      applyWorkbenchSessionUpdate(updated)
    } catch (error) {
      setWorkbenchSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to send input to the session.' }
        : prev)
    }
  }, [activeId, workbenchSession?.sessionId, applyWorkbenchSessionUpdate])

  /**
   * Keystrokes from the xterm surface. `mode: 'raw'` is mandatory here — the
   * emulator already sends its own Enter/control bytes, so `'line'` would
   * append a second newline and break interactive prompts and Ctrl-C.
   */
  const sendWorkbenchSessionData = useCallback(async (data: string) => {
    if (!activeId || !workbenchSession?.sessionId) return
    try {
      const updated = await writeWorkbenchSessionStdin(activeId, workbenchSession.sessionId, data, 'raw')
      applyWorkbenchSessionUpdate(updated)
    } catch (error) {
      setWorkbenchSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to send input to the session.' }
        : prev)
    }
  }, [activeId, workbenchSession?.sessionId, applyWorkbenchSessionUpdate])

  const resizeWorkbenchSession = useCallback(async (cols: number, rows: number) => {
    if (!activeId || !workbenchSession?.sessionId) return
    try {
      const updated = await resizeWorkbenchSessionApi(activeId, workbenchSession.sessionId, cols, rows)
      applyWorkbenchSessionUpdate(updated)
    } catch (error) {
      void error
      // A resize is cosmetic until the next keystroke: never surface it as a session error.
    }
  }, [activeId, workbenchSession?.sessionId, applyWorkbenchSessionUpdate])

  const killWorkbenchSession = useCallback(async () => {
    if (!activeId || !workbenchSession?.sessionId) return
    setWorkbenchSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      // An `awaiting_approval`/`queued` session is killed immediately; a `claimed`/`running`
      // one just has a kill control enqueued, so this response may still report the pre-kill
      // status — the poll loop started by `approveWorkbenchSession` picks up the terminal state.
      const killResponse = await killWorkbenchSessionApi(activeId, workbenchSession.sessionId)
      applyWorkbenchSessionUpdate(killResponse)
    } catch (error) {
      setWorkbenchSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to kill the session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchSession?.sessionId, applyWorkbenchSessionUpdate])

  useEffect(() => {
    // Conversation-scoped: drop any in-flight session poll and its transcript when switching conversations.
    workbenchSessionAbortRef.current?.abort()
    workbenchSessionTranscriptRef.current = { text: '', lastSeq: -1 }
    setWorkbenchSession(null)
    setWorkbenchSessionHistory([])
  }, [activeId])

  /**
   * Merges a tunnel snapshot into view state — mirrors `applyWorkbenchSessionUpdate` above.
   * `localUrl` isn't denormalized onto the top-level session (unlike `publicUrl`), so it's
   * pulled from the most recent `stream: 'tunnel'` progress chunk that reported one.
   */
  const applyWorkbenchTunnelUpdate = useCallback((remote: PublicWorkbenchTunnelSession) => {
    const progress = Array.isArray(remote.progress) ? remote.progress : []
    const localUrl = [...progress].reverse().find((chunk) => chunk.localUrl)?.localUrl ?? null
    const progressText = [...progress].reverse().find((chunk) => chunk.text?.trim())?.text?.trim() ?? null
    setWorkbenchTunnel({
      sessionId: remote.sessionId,
      status: remote.status,
      port: remote.port,
      publicUrl: remote.publicUrl ?? null,
      localUrl,
      error: remote.error ?? null,
      progress: progressText,
      busy: false,
    })
  }, [])

  const startWorkbenchTunnel = useCallback(async (port: number) => {
    if (!activeId) return
    workbenchTunnelAbortRef.current?.abort()
    const controller = new AbortController()
    workbenchTunnelAbortRef.current = controller
    setWorkbenchTunnel({ sessionId: null, status: 'starting', port, publicUrl: null, localUrl: null, error: null, busy: true })

    try {
      // A tunnel always starts `awaiting_approval` — nothing to poll until the user approves it.
      const created = await createTunnelSession(activeId, port, { signal: controller.signal })
      applyWorkbenchTunnelUpdate(created)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWorkbenchTunnel((prev) => ({
        sessionId: prev?.sessionId ?? null,
        status: 'error',
        port,
        publicUrl: prev?.publicUrl ?? null,
        localUrl: prev?.localUrl ?? null,
        error: error instanceof Error ? error.message : 'Failed to open the tunnel.',
        busy: false,
      }))
    }
  }, [activeId, applyWorkbenchTunnelUpdate])

  const approveWorkbenchTunnelSession = useCallback(async () => {
    if (!activeId || !workbenchTunnel?.sessionId) return
    workbenchTunnelAbortRef.current?.abort()
    const controller = new AbortController()
    workbenchTunnelAbortRef.current = controller
    setWorkbenchTunnel((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const approved = await approveTunnelSession(activeId, workbenchTunnel.sessionId, { signal: controller.signal })
      applyWorkbenchTunnelUpdate(approved)
      if (!WORKBENCH_TUNNEL_TERMINAL_STATUSES.has(approved.status) && !approved.publicUrl) {
        await pollTunnelSession(activeId, workbenchTunnel.sessionId, {
          signal: controller.signal,
          onProgress: applyWorkbenchTunnelUpdate,
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWorkbenchTunnel((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to approve the tunnel.', busy: false }
        : prev)
    }
  }, [activeId, workbenchTunnel?.sessionId, applyWorkbenchTunnelUpdate])

  const killWorkbenchTunnel = useCallback(async () => {
    if (!activeId || !workbenchTunnel?.sessionId) return
    workbenchTunnelAbortRef.current?.abort()
    setWorkbenchTunnel((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const killed = await killTunnelSession(activeId, workbenchTunnel.sessionId)
      applyWorkbenchTunnelUpdate(killed)
    } catch (error) {
      setWorkbenchTunnel((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to close the tunnel.', busy: false }
        : prev)
    }
  }, [activeId, workbenchTunnel?.sessionId, applyWorkbenchTunnelUpdate])

  useEffect(() => {
    // Conversation-scoped: drop any in-flight tunnel poll when switching conversations.
    workbenchTunnelAbortRef.current?.abort()
    setWorkbenchTunnel(null)
  }, [activeId])

  /** Merges a browser session snapshot's new-only progress chunks into view state — mirrors the terminal session pattern. */
  const applyWorkbenchBrowserSessionUpdate = useCallback((remote: PublicWorkbenchBrowserSession) => {
    workbenchBrowserSessionProgressRef.current = appendWorkbenchBrowserSessionProgress(workbenchBrowserSessionProgressRef.current, remote)
    const chunks = workbenchBrowserSessionProgressRef.current.chunks
    const frameCount = chunks.filter((chunk) => chunk.stream === 'frame' && chunk.imageUrl).length
    setWorkbenchBrowserSession((prev) => ({
      sessionId: remote.sessionId,
      status: remote.status,
      startUrl: remote.startUrl ?? null,
      currentUrl: remote.currentPageUrl ?? null,
      latestFrameUrl: latestWorkbenchBrowserSessionFrameUrl(chunks) ?? null,
      frameCount,
      viewport: remote.viewport ?? null,
      initiator: remote.initiator ?? prev?.initiator,
      driver: remote.driver ?? prev?.driver ?? 'idle',
      allowPrivateNetwork: remote.allowPrivateNetwork ?? prev?.allowPrivateNetwork,
      following: workbenchBrowserFollowingRef.current,
      error: remote.error ?? null,
      busy: false,
    }))
  }, [])

  const startWorkbenchBrowserSession = useCallback(async (startUrl?: string) => {
    if (!activeId) return
    workbenchBrowserSessionAbortRef.current?.abort()
    const controller = new AbortController()
    workbenchBrowserSessionAbortRef.current = controller
    workbenchBrowserSessionProgressRef.current = EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS
    setWorkbenchBrowserSession({
      sessionId: null, status: 'starting', startUrl: startUrl ?? null, currentUrl: null,
      latestFrameUrl: null, frameCount: 0, error: null, busy: true,
    })

    try {
      // A browser session always starts `awaiting_approval` — nothing to poll until the user approves it.
      const created = await createWorkbenchBrowserSession(activeId, { startUrl, signal: controller.signal })
      applyWorkbenchBrowserSessionUpdate(created)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWorkbenchBrowserSession((prev) => ({
        sessionId: prev?.sessionId ?? null,
        status: 'error',
        startUrl: startUrl ?? prev?.startUrl ?? null,
        currentUrl: prev?.currentUrl ?? null,
        latestFrameUrl: prev?.latestFrameUrl ?? null,
        frameCount: prev?.frameCount ?? 0,
        error: error instanceof Error ? error.message : 'Failed to start the browser session.',
        busy: false,
      }))
    }
  }, [activeId, applyWorkbenchBrowserSessionUpdate])

  const approveWorkbenchBrowserSession = useCallback(async () => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    workbenchBrowserSessionAbortRef.current?.abort()
    const controller = new AbortController()
    workbenchBrowserSessionAbortRef.current = controller
    setWorkbenchBrowserSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const approved = await approveWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId, { signal: controller.signal })
      applyWorkbenchBrowserSessionUpdate(approved)
      if (approved.status === 'queued' || approved.status === 'claimed') {
        await pollWorkbenchBrowserSession(activeId, workbenchBrowserSession.sessionId, {
          signal: controller.signal,
          onProgress: applyWorkbenchBrowserSessionUpdate,
          settledStatuses: new Set(['running', 'exited', 'killed', 'expired', 'failed']),
        })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setWorkbenchBrowserSession((prev) => prev
        ? {
            ...prev,
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to approve the browser session.',
            busy: false,
          }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  /** Slice-2 arbitration: the human explicitly takes the wheel back from the agent. */
  const takeControlWorkbenchBrowserSession = useCallback(async () => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    try {
      const updated = await setWorkbenchBrowserSessionDriverApi(activeId, workbenchBrowserSession.sessionId, { driver: 'user' })
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to take control of the browser session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  /** Human-only toggle: allow/revoke the agent's access to private/internal hosts. */
  const toggleAllowPrivateWorkbenchBrowserSession = useCallback(async () => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    try {
      const updated = await setWorkbenchBrowserSessionAllowPrivateApi(activeId, workbenchBrowserSession.sessionId, {
        allow: !(workbenchBrowserSession.allowPrivateNetwork ?? false),
      })
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to update the private-network allowance.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession, applyWorkbenchBrowserSessionUpdate])

  /** Requests a fresh accessibility snapshot and renders it in the Agent view — the exact text the agent sees. */
  const refreshWorkbenchBrowserSnapshot = useCallback(async () => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    if (workbenchBrowserSnapshotText) {
      setWorkbenchBrowserSnapshotText(null)
      return
    }
    setWorkbenchBrowserSnapshotLoading(true)
    try {
      await requestWorkbenchBrowserSnapshotApi(activeId, workbenchBrowserSession.sessionId)
      // The device posts the result as a progress chunk; poll the read side
      // until a fresh snapshot (seq advanced) lands or the session ends.
      const deadline = Date.now() + 20_000
      const previousSeq = 0
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        const result = await getWorkbenchBrowserSnapshot(activeId, workbenchBrowserSession.sessionId)
        if (result.snapshot && result.seq > previousSeq) {
          const lines = [
            `URL: ${result.snapshot.url ?? 'about:blank'}`,
            result.snapshot.title ? `Title: ${result.snapshot.title}` : '',
            result.snapshot.pendingDialog ? `⚠ Pending dialog (${result.snapshot.pendingDialog.type}): ${result.snapshot.pendingDialog.message ?? ''}` : '',
            '',
            result.snapshot.ax,
          ].filter((line) => line !== '').join('\n')
          setWorkbenchBrowserSnapshotText(lines)
          break
        }
        if (Date.now() >= deadline) {
          setWorkbenchBrowserSnapshotText(result.snapshot?.ax ?? 'The session has no snapshot yet — is the agent browser running?')
          break
        }
      }
    } catch (error) {
      setWorkbenchBrowserSnapshotText(error instanceof Error ? `Snapshot failed: ${error.message}` : 'Snapshot failed')
    } finally {
      setWorkbenchBrowserSnapshotLoading(false)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, workbenchBrowserSnapshotText])

  // Agent preview auto-open: when an agent-initiated session appears, offer the
  // browser tab once per session (the user can close it; we never re-hijack).
  useEffect(() => {
    if (!workbenchBrowserSession?.sessionId || workbenchBrowserSession.initiator !== 'agent') return
    if (workbenchBrowserAutoOpenedRef.current.has(workbenchBrowserSession.sessionId)) return
    workbenchBrowserAutoOpenedRef.current.add(workbenchBrowserSession.sessionId)
    setWorkbenchTab('browser')
    setWorkbenchOpen(true)
  }, [workbenchBrowserSession?.sessionId, workbenchBrowserSession?.initiator])

  const navigateWorkbenchBrowserSession = useCallback(async (url: string) => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    setWorkbenchBrowserSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const updated = await navigateWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId, url)
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to navigate the browser session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  const captureWorkbenchBrowserSession = useCallback(async () => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    setWorkbenchBrowserSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const updated = await captureWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId)
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to capture a frame.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  /**
   * Design Mode drive: the panel reports a point as a percentage of the frame it
   * is showing, which maps onto the session's own viewport (the frame is a
   * screenshot of exactly that viewport) rather than onto the rendered <img>.
   */
  const clickWorkbenchBrowserSessionAt = useCallback(async (xPct: number, yPct: number) => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    const viewport = workbenchBrowserSession.viewport ?? WORKBENCH_BROWSER_FALLBACK_VIEWPORT
    const x = Math.round(Math.min(100, Math.max(0, xPct)) / 100 * viewport.width)
    const y = Math.round(Math.min(100, Math.max(0, yPct)) / 100 * viewport.height)
    setWorkbenchBrowserSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const updated = await clickWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId, { x, y })
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to click in the browser session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, workbenchBrowserSession?.viewport, applyWorkbenchBrowserSessionUpdate])

  const typeInWorkbenchBrowserSession = useCallback(async (text: string) => {
    if (!activeId || !workbenchBrowserSession?.sessionId || !text) return
    setWorkbenchBrowserSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const updated = await typeWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId, { text })
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to type in the browser session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  /**
   * Device-side following. `following` is tracked locally rather than read back
   * from the session, so the toggle stays responsive and the frame poll below
   * can speed up immediately; a failed request rolls it back.
   */
  const setWorkbenchBrowserSessionFollow = useCallback(async (action: 'start' | 'stop') => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    const next = action === 'start'
    setWorkbenchBrowserFollowing(next)
    workbenchBrowserFollowingRef.current = next
    try {
      const updated = await followWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId, {
        action,
        ...(next ? { intervalMs: WORKBENCH_BROWSER_FOLLOW_INTERVAL_MS } : {}),
      })
      applyWorkbenchBrowserSessionUpdate(updated)
    } catch (error) {
      setWorkbenchBrowserFollowing(!next)
      workbenchBrowserFollowingRef.current = !next
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to change frame following.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  const startWorkbenchBrowserSessionFollow = useCallback(() => { void setWorkbenchBrowserSessionFollow('start') }, [setWorkbenchBrowserSessionFollow])
  const stopWorkbenchBrowserSessionFollow = useCallback(() => { void setWorkbenchBrowserSessionFollow('stop') }, [setWorkbenchBrowserSessionFollow])

  const killWorkbenchBrowserSession = useCallback(async () => {
    if (!activeId || !workbenchBrowserSession?.sessionId) return
    setWorkbenchBrowserFollowing(false)
    workbenchBrowserFollowingRef.current = false
    workbenchBrowserSessionAbortRef.current?.abort()
    setWorkbenchBrowserSession((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const killed = await killWorkbenchBrowserSessionApi(activeId, workbenchBrowserSession.sessionId)
      applyWorkbenchBrowserSessionUpdate(killed)
    } catch (error) {
      setWorkbenchBrowserSession((prev) => prev
        ? { ...prev, error: error instanceof Error ? error.message : 'Failed to close the browser session.', busy: false }
        : prev)
    }
  }, [activeId, workbenchBrowserSession?.sessionId, applyWorkbenchBrowserSessionUpdate])

  useEffect(() => {
    // Conversation-scoped: drop any in-flight browser session poll and its progress when switching conversations.
    workbenchBrowserSessionAbortRef.current?.abort()
    workbenchBrowserSessionProgressRef.current = EMPTY_WORKBENCH_BROWSER_SESSION_PROGRESS
    setWorkbenchBrowserSession(null)
    setWorkbenchBrowserFollowing(false)
    workbenchBrowserFollowingRef.current = false
  }, [activeId])

  // Following is only meaningful on a live session — a session that exits or is killed
  // leaves the flag behind otherwise, and the panel would keep claiming it is live.
  useEffect(() => {
    if (workbenchBrowserSession?.status !== 'running') {
      setWorkbenchBrowserFollowing(false)
      workbenchBrowserFollowingRef.current = false
    }
  }, [workbenchBrowserSession?.status])

  // A session the user just approved is almost always one they want to watch, so following
  // starts on its own once the device reports `running` and the Browser tab is on screen.
  useEffect(() => {
    if (!showAgentWorkbench || !workbenchOpen || workbenchTab !== 'browser') return
    if (workbenchBrowserSession?.status !== 'running' || !workbenchBrowserSession.sessionId) return
    if (workbenchBrowserFollowing) return
    void setWorkbenchBrowserSessionFollow('start')
    // `workbenchBrowserFollowing` is intentionally excluded: re-running on its own flip would
    // immediately re-start following after the user turns it off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAgentWorkbench, workbenchOpen, workbenchTab, workbenchBrowserSession?.status, workbenchBrowserSession?.sessionId])

  // While the Browser tab is open on a running agent session, poll for frames the agent
  // captures on its own (outside a user-triggered navigate/capture click) — this is the
  // "follow live frames" experience, mirroring how terminal Session mode streams continuously.
  useEffect(() => {
    if (!showAgentWorkbench || !workbenchOpen || workbenchTab !== 'browser') return
    if (!activeId || !workbenchBrowserSession?.sessionId || workbenchBrowserSession.status !== 'running') return
    const conversationId = activeId
    const sessionId = workbenchBrowserSession.sessionId
    const controller = new AbortController()
    const interval = setInterval(() => {
      getWorkbenchBrowserSession(conversationId, sessionId, { signal: controller.signal })
        .then(applyWorkbenchBrowserSessionUpdate)
        .catch(() => {
          // A follow-up poll failing (e.g. a transient network blip) shouldn't surface as an error banner.
        })
    }, workbenchBrowserFollowing ? WORKBENCH_BROWSER_FOLLOW_INTERVAL_MS : WORKBENCH_BROWSER_IDLE_POLL_INTERVAL_MS)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [showAgentWorkbench, workbenchOpen, workbenchTab, activeId, workbenchBrowserSession?.sessionId, workbenchBrowserSession?.status, workbenchBrowserFollowing, applyWorkbenchBrowserSessionUpdate])

  useEffect(() => {
    if (showAgentWorkbench && workbenchOpen && workbenchTab === 'files' && activeId) void loadWorkbenchFiles()
  }, [showAgentWorkbench, workbenchOpen, workbenchTab, activeId, loadWorkbenchFiles])

  useEffect(() => {
    if (showAgentWorkbench && workbenchOpen && workbenchTab === 'changes' && activeId) void loadWorkbenchChanges()
  }, [showAgentWorkbench, workbenchOpen, workbenchTab, activeId, loadWorkbenchChanges])

  useEffect(() => {
    void loadModelCatalog()
  }, [loadModelCatalog])

  // ── Load conversations ────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/conversations?${listQuery}`)
      if (!res.ok) throw new Error(`load conversations: ${res.status}`)
      const body = await res.json()
      const list: Conversation[] = body.data?.conversations ?? []
      let nextList = list
      if (initialConvId && !list.some((conversation) => conversation.id === initialConvId)) {
        const focusedRes = await fetch(`/api/v1/conversations/${initialConvId}`)
        if (focusedRes.ok) {
          const focusedBody = await focusedRes.json()
          const focusedConversation: Conversation | undefined = focusedBody.data?.conversation
          if (focusedConversation) {
            nextList = [
              focusedConversation,
              ...list.filter((conversation) => conversation.id !== focusedConversation.id),
            ]
          }
        }
      }
      setConversations(nextList)
      if (!activeId && nextList.length) {
        const preferred = initialConvId && nextList.find((c) => c.id === initialConvId)
        const relatedId = preferCurrentPageContext && currentPageContext ? findRelatedConversationId(nextList, currentPageContext) : null
        const firstRailConversation = nextList.find((conversation) => {
          const project = conversationProjectIdentity(conversation)
          return layoutVariant !== 'hermes' || compact || !project || linkedProjectIds.has(project.id)
        })
        setActiveId(preferred ? initialConvId! : relatedId ?? (preferCurrentPageContext ? null : firstRailConversation?.id ?? null))
      } else if (
        !activeId &&
        nextList.length === 0 &&
        autoCreateScopedConversation &&
        allowStartConversations &&
        initialAgentId &&
        scope &&
        scopeRefId &&
        scope !== 'company' &&
        scope !== 'workspace' &&
        scope !== 'project' &&
        !autoCreateRef.current
      ) {
        autoCreateRef.current = true
        const createRes = await fetch('/api/v1/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            participants: [{ kind: 'agent', agentId: initialAgentId }],
            title: autoCreateTitle?.trim() || 'Ticket conversation',
            scope,
            scopeRefId,
            ...(currentPageContext ? { contextRefs: [coerceContextRef(currentPageContext)] } : {}),
          }),
        })
        const createBody = await createRes.json().catch(() => null)
        if (!createRes.ok) {
          throw new Error(createBody?.error ?? `create conversation: ${createRes.status}`)
        }
        const conv: Conversation | undefined = createBody?.data?.conversation
        if (conv) {
          setConversations([conv])
          setActiveId(conv.id)
          setMobilePane('conversation')
        }
      }
    } catch (e) {
      const networkError = formatClientNetworkError(e, 'Failed to load conversations')
      if (networkError) setError(networkError)
    } finally {
      setConversationsHydrated(true)
    }
  }, [
    listQuery,
    activeId,
    initialConvId,
    autoCreateScopedConversation,
    allowStartConversations,
    initialAgentId,
    scope,
    scopeRefId,
    orgId,
    autoCreateTitle,
    currentPageContext,
    preferCurrentPageContext,
    coerceContextRef,
    compact,
    layoutVariant,
    linkedProjectIds,
    setActiveId,
  ])

  // Company Cowork (CRM embed): wait for the workspace catalogue, then create on the
  // org default computer (usually VPS) so sessions bind to the company folder.
  useEffect(() => {
  if (!autoCreateScopedConversation || !allowStartConversations || !initialAgentId) return
  if (scope !== 'company' || !scopeRefId) return
  if (!conversationsHydrated) return
  if (!workspaceCatalogueLoaded || !selectedWorkspaceId || !selectedWorkspaceRuntimeIsValid) return
  if (conversations.length > 0 || activeId || autoCreateRef.current) return

  autoCreateRef.current = true
  let cancelled = false
  let settled = false
  const idempotencyKey = `company-cowork-autocreate:${orgId}:${scopeRefId}:${currentUserUid}`
  const scopedShareMode = defaultScopedConversationShareMode(
    'company',
    selectedWorkspaceRuntimeTarget,
  )
  void (async () => {
      try {
        const selected = parseWorkspaceRuntimeSelection(selectedWorkspaceRuntime)
        const createRes = await fetch('/api/v1/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            orgId,
            participants: [{ kind: 'agent', agentId: initialAgentId }],
            title: autoCreateTitle?.trim() || `${orgName || 'Company'} Cowork`,
            scope: 'company',
            scopeRefId,
            workspaceId: selectedWorkspaceId,
            runtimeTarget: selected.runtimeTargetId,
            ...(selected.mappingId ? { mappingId: selected.mappingId } : {}),
            shareMode: scopedShareMode,
            ...(currentPageContext ? { contextRefs: [coerceContextRef(currentPageContext)] } : {}),
          }),
        })
        const createBody = await createRes.json().catch(() => null)
        if (cancelled) return
        if (!createRes.ok) {
          throw new Error(createBody?.error ?? `create conversation: ${createRes.status}`)
        }
        const conv: Conversation | undefined = createBody?.data?.conversation
        if (conv) {
          settled = true
          setConversations((current) => (current.some((row) => row.id === conv.id) ? current : [conv, ...current]))
          setActiveId(conv.id)
          setMobilePane('conversation')
        } else {
          autoCreateRef.current = false
        }
      } catch (createError) {
        if (cancelled) return
        autoCreateRef.current = false
        setError(createError instanceof Error ? createError.message : 'Failed to start company Cowork chat')
      }
    })()

    return () => {
      cancelled = true
      if (!settled) autoCreateRef.current = false
    }
  }, [
    activeId,
    allowStartConversations,
    autoCreateScopedConversation,
    autoCreateTitle,
    coerceContextRef,
    conversations.length,
    conversationsHydrated,
    currentPageContext,
    currentUserUid,
    initialAgentId,
    orgId,
    orgName,
    scope,
    scopeRefId,
    selectedWorkspaceId,
    selectedWorkspaceRuntime,
    selectedWorkspaceRuntimeIsValid,
    selectedWorkspaceRuntimeTarget,
    selectedWorkspaceShareMode,
    setActiveId,
    workspaceCatalogueLoaded,
  ])

  // ── Load messages ─────────────────────────────────────────────────────────
  // Only paint into React state when `convId` is still the active session.
  // Finalize polls / SSE recovery keep fetching in the background so runs can
  // complete after the user switches away, but a late response must never
  // overwrite the conversation currently on screen.
  const loadMessages = useCallback(async (
    convId: string,
    options?: { silent?: boolean; softError?: boolean },
  ): Promise<ConversationMessage[] | null> => {
    const shouldMutateUi = () => activeConversationIdRef.current === convId
    if (!options?.silent && shouldMutateUi()) setLoading(true)
    try {
      let res: Response
      try {
        res = await fetch(`/api/v1/conversations/${convId}/messages`)
      } catch {
        try {
          res = await fetch(`/api/v1/chat-feed/${convId}`)
        } catch {
          res = await fetch(`/api/v1/thread-data/${convId}`)
        }
      }
      if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500)) {
        const fallback = await fetch(`/api/v1/chat-feed/${convId}`)
        if (fallback.ok || !res.ok) res = fallback
      }
      if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500)) {
        const fallback = await fetch(`/api/v1/thread-data/${convId}`)
        if (fallback.ok || !res.ok) res = fallback
      }
      if (!res.ok) throw new Error(`load messages: ${res.status}`)
      const body = await res.json()
      const nextMessages = (body.data?.messages ?? []) as ConversationMessage[]
      if (shouldMutateUi()) {
        setMessages(nextMessages)
        if (options?.softError) setError(null)
      }
      return nextMessages
    } catch (e) {
      if (shouldMutateUi()) {
        const networkError = options?.softError
          ? formatLiveMessageRefreshError(e)
          : formatClientNetworkError(e, 'Failed to load messages')
        if (networkError) setError(networkError)
      }
      return null
    } finally {
      if (!options?.silent && shouldMutateUi()) setLoading(false)
    }
  }, [])

  const refreshConversation = useCallback(async (conversationId: string) => {
    try {
      const response = await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}`)
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          setConversations((current) => current.filter((conversation) => conversation.id !== conversationId))
        }
        return
      }
      const body = await response.json()
      const conversation = body.data?.conversation as Conversation | undefined
      if (!conversation || conversation.id !== conversationId) return
      setConversations((current) => {
        const existing = current.find((item) => item.id === conversation.id)
        if (!existing) return [conversation, ...current]
        return [conversation, ...current.filter((item) => item.id !== conversation.id)]
      })
    } catch {
      // The next invalidation or fallback connection will retry safely.
    }
  }, [])

  // The realtime connection must not be recreated when its targeted loaders
  // receive fresh callback identities during normal chat state updates.
  const refreshConversationRef = useRef(refreshConversation)
  const loadMessagesRef = useRef(loadMessages)
  refreshConversationRef.current = refreshConversation
  loadMessagesRef.current = loadMessages

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => { loadConversations() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Hidden Messages tabs must not keep a server-side Firestore poll alive.
  // A visibility change reopens the stream and immediately supplies a fresh
  // snapshot when the user returns to the tab.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const updateVisibility = () => setConversationPageVisible(document.visibilityState !== 'hidden')
    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  // Clear scary network banners when the browser comes back online and rehydrate.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = () => {
      setError((current) => {
        if (!current) return current
        const lower = current.toLowerCase()
        if (
          lower.includes('offline')
          || lower.includes('network dropped')
          || lower.includes('failed to fetch')
          || lower.includes('check your connection')
        ) {
          return null
        }
        return current
      })
      const convId = activeConversationIdRef.current
      if (convId) void loadMessages(convId, { silent: true, softError: true })
      void loadConversations()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [loadConversations, loadMessages])

  // Hermes can restore a saved tab whose conversation is intentionally absent
  // from the current rail catalogue (for example an unlinked project). Hydrate
  // it through the permission-checked conversation endpoint instead of using
  // rail visibility as an access decision.
  useEffect(() => {
    if (!activeId || conversations.some((conversation) => conversation.id === activeId)) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/v1/conversations/${encodeURIComponent(activeId)}`)
        if (!response.ok || cancelled) return
        const body = await response.json()
        const conversation: Conversation | undefined = body.data?.conversation
        if (!conversation || conversation.id !== activeId || cancelled) return
        setConversations((current) => current.some((item) => item.id === conversation.id)
          ? current
          : [conversation, ...current])
      } catch {
        // A stale or no-longer-authorised saved tab remains unavailable without
        // exposing a conversation that the server did not approve.
      }
    })()
    return () => { cancelled = true }
  }, [activeId, conversations])

  // Drop the previous thread's transcript immediately. loadMessages is async —
  // if open_context auto-handlers still see the prior assistant bubble after
  // activeId flips, they PATCH that context onto the newly focused chat.
  useEffect(() => {
    setMessages([])
    setLoading(Boolean(activeId))
    setContextFocusRequest(undefined)
    setContextArtifactRequest(undefined)
    handledOpenContextActionsRef.current.clear()
  }, [activeId])

  useEffect(() => {
    if (activeId) loadMessages(activeId)
  }, [activeId, loadMessages])

  // One permission-checked server stream keeps both the session rail and the
  // active thread current. This covers agent, direct-human, and group chats,
  // including conversations another member creates while this screen is open.
  // EventSource reconnects automatically after the bounded server stream ends.
  useEffect(() => {
    if (!shouldUseConversationLiveFallback({
      pageVisible: conversationPageVisible,
      transport: CONVERSATION_REALTIME_TRANSPORT,
      gatewayReady: conversationRealtimeGatewayReady,
    })) {
      setConversationLiveConnected(false)
      return
    }
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
      setConversationLiveConnected(false)
      return
    }

    const params = new URLSearchParams(listQuery)
    if (activeId) params.set('conversationId', activeId)
    const source = new window.EventSource(`/api/v1/conversations/live?${params.toString()}`)
    let disposed = false

    source.onopen = () => {
      if (!disposed) setConversationLiveConnected(true)
    }
    source.onmessage = (event) => {
      if (disposed) return
      try {
        const snapshot = JSON.parse(event.data) as {
          type?: string
          conversations?: Conversation[]
          conversation?: Conversation | null
          messages?: ConversationMessage[] | null
          presence?: ConversationPresence[] | null
        }
        if (snapshot.type !== 'snapshot' || !Array.isArray(snapshot.conversations)) return

        const nextConversations = [...snapshot.conversations]
        if (
          snapshot.conversation
          && !nextConversations.some((conversation) => conversation.id === snapshot.conversation!.id)
        ) {
          nextConversations.unshift(snapshot.conversation)
        }
        setConversations(nextConversations)

        if (
          activeConversationIdRef.current
          && snapshot.conversation?.id === activeConversationIdRef.current
          && Array.isArray(snapshot.messages)
        ) {
          setMessages((current) => mergeSnapshotMessages(snapshot.messages!, current))
        }
        if (
          activeConversationIdRef.current
          && snapshot.conversation?.id === activeConversationIdRef.current
          && Array.isArray(snapshot.presence)
        ) {
          setThreadPresence(snapshot.presence)
        } else if (!snapshot.conversation || snapshot.conversation.id !== activeConversationIdRef.current) {
          setThreadPresence([])
        }
      } catch (error) {
        void error
        // Ignore malformed frames and let EventSource deliver the next snapshot.
      }
    }
    source.onerror = () => {
      if (!disposed) setConversationLiveConnected(false)
    }

    return () => {
      disposed = true
      source.close()
      setConversationLiveConnected(false)
    }
  }, [activeId, conversationPageVisible, conversationRealtimeGatewayReady, listQuery])

  // The GCP gateway is an optional, read-only invalidation transport. It does
  // not carry conversation data; every refresh still goes through the existing
  // permission-checked HTTP APIs. In shadow mode it exercises the connection
  // and delivery path but deliberately leaves the proven SSE feed authoritative.
  useEffect(() => {
    const mode = CONVERSATION_REALTIME_TRANSPORT
    if (
      !conversationPageVisible
      || !CONVERSATION_REALTIME_WEBSOCKET_URL
      || (mode !== 'shadow' && mode !== 'enabled')
      || typeof window === 'undefined'
      || typeof window.WebSocket !== 'function'
    ) {
      setConversationRealtimeGatewayReady(false)
      onRealtimeGatewayConnectionChangeRef.current?.(realtimeGatewayClientId, false)
      return
    }

    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let refreshTimer: number | undefined
    let retryMs = 1_000
    const pendingInvalidations = new Map<string, ConversationRealtimeInvalidation>()
    const reportGatewayReady = (ready: boolean) => {
      setConversationRealtimeGatewayReady(ready)
      onRealtimeGatewayConnectionChangeRef.current?.(realtimeGatewayClientId, ready)
    }
    const scheduleTargetedRefresh = (invalidation: ConversationRealtimeInvalidation) => {
      if (mode !== 'enabled') return
      const initialPlan = planConversationRealtimeRefresh(invalidation, activeConversationIdRef.current)
      if (!initialPlan) return
      onConversationRealtimeInvalidationRef.current?.(invalidation)
      pendingInvalidations.set(initialPlan.conversationId, invalidation)
      if (refreshTimer !== undefined) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        if (disposed || document.visibilityState === 'hidden') return
        for (const invalidation of pendingInvalidations.values()) {
          const plan = planConversationRealtimeRefresh(invalidation, activeConversationIdRef.current)
          if (!plan) continue
          void refreshConversationRef.current(plan.conversationId)
          if (plan.refreshMessages) void loadMessagesRef.current(plan.conversationId, { silent: true, softError: true })
        }
        pendingInvalidations.clear()
      }, 250)
    }
    const connect = async () => {
      if (disposed) return
      const user = auth.currentUser
      if (!user) {
        reconnectTimer = window.setTimeout(() => void connect(), retryMs)
        return
      }
      try {
        const token = await user.getIdToken()
        if (disposed) return
        const nextSocket = new window.WebSocket(CONVERSATION_REALTIME_WEBSOCKET_URL)
        socket = nextSocket
        nextSocket.onopen = () => nextSocket.send(JSON.stringify({ type: 'authenticate', token }))
        nextSocket.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data) as { type?: string; eventId?: string; conversationId?: string }
            if (frame.type === 'ready') {
              retryMs = 1_000
              reportGatewayReady(true)
            }
            if (
              frame.type === 'invalidate'
              && typeof frame.eventId === 'string'
              && typeof frame.conversationId === 'string'
            ) scheduleTargetedRefresh({ eventId: frame.eventId, conversationId: frame.conversationId })
          } catch {
            // The gateway is an optimisation. Ignore malformed frames and retain SSE.
          }
        }
        nextSocket.onclose = () => {
          reportGatewayReady(false)
          if (disposed) return
          reconnectTimer = window.setTimeout(() => {
            retryMs = Math.min(retryMs * 2, 30_000)
            void connect()
          }, retryMs)
        }
        nextSocket.onerror = () => nextSocket.close()
      } catch {
        reportGatewayReady(false)
        if (!disposed) {
          reconnectTimer = window.setTimeout(() => {
            retryMs = Math.min(retryMs * 2, 30_000)
            void connect()
          }, retryMs)
        }
      }
    }
    void connect()
    return () => {
      disposed = true
      reportGatewayReady(false)
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      socket?.close()
    }
  }, [conversationPageVisible])

  // Drop stale collaborator chips immediately when switching threads.
  useEffect(() => {
    setThreadPresence([])
    presenceTypingRef.current = false
  }, [activeId])

  // Presence heartbeat: viewing while the thread is open; typing while the
  // composer has content. Server TTL is ~12s — refresh well under that.
  useEffect(() => {
    if (!activeId || !orgId || !currentUserUid) {
      setThreadPresence([])
      return
    }
    let cancelled = false
    const postPresence = async (state: 'viewing' | 'typing' | 'active') => {
      try {
        await fetch(`/api/v1/conversations/${encodeURIComponent(activeId)}/presence?orgId=${encodeURIComponent(orgId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state,
            displayName: currentUserDisplayName || undefined,
            lastMessageId: messages[messages.length - 1]?.id,
          }),
        })
      } catch {
        // Best-effort presence — live chat still works without it.
      }
    }

    void postPresence(presenceTypingRef.current ? 'typing' : 'viewing')
    const timer = window.setInterval(() => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void postPresence(presenceTypingRef.current ? 'typing' : 'viewing')
    }, 5_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  // messages length intentionally omitted — lastMessageId is optional context only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, orgId, currentUserUid, currentUserDisplayName])

  useEffect(() => {
    const typing = Boolean(input.trim())
    presenceTypingRef.current = typing
    if (!activeId || !orgId || !typing) return
    const handle = window.setTimeout(() => {
      void fetch(`/api/v1/conversations/${encodeURIComponent(activeId)}/presence?orgId=${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: 'typing',
          displayName: currentUserDisplayName || undefined,
        }),
      }).catch(() => undefined)
    }, 350)
    return () => window.clearTimeout(handle)
  }, [input, activeId, orgId, currentUserDisplayName])

  const presenceLine = useMemo(
    () => formatConversationPresenceLine(threadPresence, currentUserUid),
    [threadPresence, currentUserUid],
  )

  // Clear the current member's unread counter only after the exact latest
  // message is visible in the focused thread. A 409 means a newer message won
  // the race; the live snapshot will supply its id and trigger a safe retry.
  const latestVisibleMessageId = messages[messages.length - 1]?.id ?? null
  useEffect(() => {
    if (!activeId || !activeConversation) return
    if (!activeConversation.lastMessageId || latestVisibleMessageId !== activeConversation.lastMessageId) return
    if (activeConversation.lastReadMessageId === activeConversation.lastMessageId) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const marker = `${activeId}:${activeConversation.lastMessageId}`
    if (markedReadRef.current === marker) return
    markedReadRef.current = marker
    void fetch(`/api/v1/conversations/${encodeURIComponent(activeId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastMessageId: activeConversation.lastMessageId }),
    })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status !== 409) markedReadRef.current = ''
          return null
        }
        return response.json()
      })
      .then((body) => {
        const updated = body?.data?.conversation as Conversation | undefined
        if (!updated) return
        setConversations((current) => current.map((conversation) =>
          conversation.id === updated.id ? updated : conversation))
      })
      .catch(() => {
        markedReadRef.current = ''
      })
  }, [activeConversation, activeId, latestVisibleMessageId])

  // Composer state is per-conversation. On id change, stash the prior draft,
  // restore the next chat's draft (or empty), and drop context pins until the
  // new conversation's refs hydrate — so nothing from chat A can be sent as chat B.
  useEffect(() => {
    const previousConversationId = composerStateConversationIdRef.current
    composerStateConversationIdRef.current = activeId

    setContextRefs([])
    setContextMention(null)
    setContextTypePrompt(null)
    setSlashPrompt(null)
    setSelectedSlashCommand(null)
    setContextSearchResults([])
    setContextSearchMessage(null)
    setContextSearchLoading(false)
    setContextPickerActiveIndex(0)
    setHistoryCursor(null)
    historyDraftRef.current = ''
    contextPickerInsertedSeparatorRef.current = undefined
    composerEditRevisionRef.current += 1

    // Keep a pre-hydration draft (or a first-send auto-create) intact when there
    // was no prior session — only isolate when leaving a real conversation.
    if (!previousConversationId || previousConversationId === activeId) return

    const previousText = inputRef.current
    const previousAttachments = attachmentsRef.current
    if (previousText.trim() || previousAttachments.length > 0) {
      composerDraftsByConversationRef.current.set(previousConversationId, {
        text: previousText,
        attachments: previousAttachments,
      })
    } else {
      composerDraftsByConversationRef.current.delete(previousConversationId)
    }

    const nextDraft = activeId
      ? composerDraftsByConversationRef.current.get(activeId)
      : undefined
    if (activeId) composerDraftsByConversationRef.current.delete(activeId)
    setInput(nextDraft?.text ?? '')
    setAttachments(nextDraft?.attachments ?? [])
  }, [activeId])

  useEffect(() => {
    if (!activeConversation?.id || activeConversation.id !== activeId) return
    setContextRefs((activeConversation.contextRefs ?? []).map(coerceContextRef))
  }, [activeId, activeConversation?.id, activeConversation?.contextRefs, coerceContextRef])

  useEffect(() => {
    setHistoryCursor(null)
    historyDraftRef.current = ''
    if (!activeId) {
      setComposerHistory([])
      return
    }
    setComposerHistory(readComposerHistory(orgId, activeId))
  }, [activeId, orgId])

  useEffect(() => {
    if (!contextMention) {
      setContextSearchResults([])
      setAgentMentionResults([])
      setContextSearchLoading(false)
      setContextSearchMessage(null)
      return
    }

    const controller = new AbortController()
    // @agent: — only specialists available on *this chat's* bound computer
    // (visible-agents?runtimeTarget=… + live inventory), never a hard-coded roster.
    if (contextMention.kind === 'agent' || isAgentMentionNamespace(contextMention.namespace)) {
      const q = contextMention.query.trim().toLowerCase()
      if (mentionAgentsStatus === 'loading') {
        setContextSearchResults([])
        setAgentMentionResults([])
        setContextSearchLoading(true)
        setContextSearchMessage(null)
        return () => controller.abort()
      }
      const hits = mentionAgents
        .filter((agent) => {
          if (!q) return true
          return (
            agent.agentId.toLowerCase().includes(q)
            || agent.name?.toLowerCase().includes(q)
            || agent.role?.toLowerCase().includes(q)
            || (typeof agent.agentHandle === 'string' && agent.agentHandle.toLowerCase().includes(q))
          )
        })
        .slice(0, 12)
        .map((agent) => ({
          agentId: agent.agentId,
          label: agent.name?.trim() || agent.agentId,
          summary: [
            agent.role,
            mentionRuntimeLabel ? `on ${mentionRuntimeLabel}` : null,
            `@agent:${agent.agentId}`,
          ].filter(Boolean).join(' · '),
        }))
      setContextSearchResults([])
      setAgentMentionResults(hits)
      setContextSearchLoading(false)
      setContextSearchMessage(
        hits.length === 0
          ? (mentionAgentsEmptyReason
            ?? (q ? 'No matching agents on this computer' : 'No agents available on this computer'))
          : null,
      )
      return () => controller.abort()
    }

    const isWorkbenchPathSearch = Boolean(
      activeId
      && activeConversation?.workspaceContext
      && (contextMention.namespace === 'files' || contextMention.namespace === 'folders'),
    )
    if (isWorkbenchPathSearch && !contextMention.query.trim()) {
      setContextSearchResults([])
      setAgentMentionResults([])
      setContextSearchLoading(false)
      setContextSearchMessage('Type part of a linked file or folder name')
      return () => controller.abort()
    }
    const params = new URLSearchParams({
      orgId,
      type: contextMention.namespace,
      q: contextMention.query,
      limit: '8',
    })
    if (currentPageContext?.type && currentPageContext?.id) {
      params.set('contextType', currentPageContext.type)
      params.set('contextId', currentPageContext.id)
    }
    setContextSearchLoading(true)
    setContextSearchMessage(null)
    setAgentMentionResults([])
    if (isWorkbenchPathSearch) {
      const timer = window.setTimeout(() => {
        void runConversationWorkbenchJob(activeId!, {
          kind: 'fs.search',
          query: contextMention.query,
          entryType: contextMention.namespace === 'files' ? 'file' : 'directory',
          limit: 8,
        }, { signal: controller.signal })
        .then(async (job) => {
          const response = await fetch(
            `/api/v1/conversations/${encodeURIComponent(activeId!)}/workbench/context-references`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId: job.jobId }),
              signal: controller.signal,
            },
          )
          const body = await response.json().catch(() => null)
          if (!response.ok) throw new Error(body?.error || 'Unable to attach linked path')
          return body
        })
        .then((body) => {
          setContextSearchResults(((body?.data?.refs ?? []) as ContextReference[]).map(coerceContextRef))
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setContextSearchResults([])
          setContextSearchMessage(err instanceof Error ? err.message : 'Linked path search failed')
        })
        .finally(() => {
          if (!controller.signal.aborted) setContextSearchLoading(false)
        })
      }, 300)
      return () => {
        window.clearTimeout(timer)
        controller.abort()
      }
    }
    fetch(`/api/v1/context-references/search?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body?.data?.refs) {
          setContextSearchResults([])
          return
        }
        setContextSearchResults((body.data.refs as ContextReference[]).map(coerceContextRef))
        setContextSearchMessage(null)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setContextSearchResults([])
        setContextSearchMessage('Reference search failed')
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextSearchLoading(false)
      })

    return () => controller.abort()
  }, [
    activeConversation?.workspaceContext,
    activeId,
    coerceContextRef,
    contextMention,
    currentPageContext?.id,
    currentPageContext?.type,
    mentionAgents,
    mentionAgentsEmptyReason,
    mentionAgentsStatus,
    mentionRuntimeLabel,
    orgId,
  ])

  useEffect(() => {
    if (!activeId) return
    if ((activeConversation?.participantAgentIds?.length ?? 0) > 0) return
    if (conversationLiveConnected) return

    const interval = window.setInterval(() => {
      void loadMessages(activeId, { silent: true })
    }, HUMAN_CHAT_REFRESH_INTERVAL)

    return () => window.clearInterval(interval)
  }, [activeConversation?.participantAgentIds?.length, activeId, conversationLiveConnected, loadMessages])

  // On conversation enter: force one scroll-to-latest pass after layout.
  // While reading history (scrolled up), ignore subsequent message updates.
  useEffect(() => {
    stickMessagesToBottomRef.current = true
    pendingEnterMessagesScrollRef.current = true
  }, [activeId])

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const nearBottom = distanceFromBottom <= 96
    stickMessagesToBottomRef.current = nearBottom
    if (!nearBottom) {
      pendingEnterMessagesScrollRef.current = false
    }
  }, [])

  // Auto-scroll on enter and while still stuck to bottom. Run after layout so
  // opening an existing chat lands at the latest message, not a stale height.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    if (!pendingEnterMessagesScrollRef.current && !stickMessagesToBottomRef.current) return

    const scrollToLatest = () => {
      container.scrollTop = container.scrollHeight
    }

    scrollToLatest()
    const frameId = window.requestAnimationFrame(scrollToLatest)
    const timeoutId = window.setTimeout(scrollToLatest, 0)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [activeId, messages])

  // Close context menu on outside click
  useEffect(() => {
    if (!menuOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-conv-menu]')) {
        setMenuOpenId(null)
        setMenuPosition(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenId])

  // Close mobile header menu on outside click
  useEffect(() => {
    if (!headerMenuOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-header-menu]')) setHeaderMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [headerMenuOpen])

  // Close project folder ⋯ menu on outside click
  useEffect(() => {
    if (!projectActionsOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-project-actions]')) setProjectActionsOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [projectActionsOpenId])

  // Close header menu when switching conversations
  useEffect(() => { setHeaderMenuOpen(false) }, [activeId])

  // Cleanup polling + SSE on unmount
  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current)
    Object.values(eventSourcesRef.current).forEach((es) => es.close())
  }, [])

  // ── SSE event stream ─────────────────────────────────────────────────────
  const startEventStream = useCallback(
    (msgId: string, runId: string, agentId: AgentId, convId?: string) => {
      eventSourcesRef.current[msgId]?.close()
      const url = `/api/v1/admin/agents/${agentId}/runs/${encodeURIComponent(runId)}/events`
      const es = new EventSource(url)
      setLiveEvents((prev) => {
        if (!(msgId in prev)) return prev
        const next = { ...prev }
        delete next[msgId]
        return next
      })
      const shouldPaintStream = () => !convId || activeConversationIdRef.current === convId
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as ChatEvent
          // Always accumulate events — finalize may still need them after a session switch.
          setLiveEvents((prev) => ({
            ...prev,
            [msgId]: [...(prev[msgId] ?? []), data],
          }))
          if (!shouldPaintStream()) return
          const richParts = Array.isArray(data.richParts) ? data.richParts as RichMessagePart[] : []
          const uiActions = Array.isArray(data.uiActions) ? data.uiActions as ChatUiAction[] : []
          if (richParts.length > 0 || uiActions.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      richParts: appendRichItems(m.richParts, richParts),
                      uiActions: appendRichItems(m.uiActions, uiActions),
                    }
                  : m,
              ),
            )
          }
          if (data.event === 'assistant.text_delta' && data.delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, status: 'streaming', content: applyAssistantTextDelta(m.content ?? '', data.delta ?? '') }
                  : m,
              ),
            )
          }
        } catch {
          return
        }
      }
      es.onerror = () => {
        // EventSource reconnects automatically after transient network errors and
        // bounded server streams. Keep this instance alive until finalize polling
        // proves the run terminal; closing here permanently silences long runs.
        if (convId) {
          void loadMessages(convId, { silent: true, softError: true })
        }
      }
      eventSourcesRef.current[msgId] = es
    },
    [loadMessages],
  )

  const closeEventStream = useCallback((msgId: string) => {
    eventSourcesRef.current[msgId]?.close()
    delete eventSourcesRef.current[msgId]
  }, [])

  const scheduleFinalizePoll = useCallback((
    convId: string,
    msgId: string,
    runId: string,
    agentId: AgentId,
    attempts: number,
    delay = POLL_INTERVAL,
  ) => {
    pollRef.current = setTimeout(
      () => pollFinalizeRef.current?.(convId, msgId, runId, agentId, attempts + 1),
      delay,
    )
  }, [])

  // ── Polling finalize ──────────────────────────────────────────────────────
  const pollFinalize = useCallback(
    async (convId: string, msgId: string, runId: string, agentId: AgentId, attempts = 0) => {
      const shouldPaint = () => activeConversationIdRef.current === convId
      if (attempts > MAX_RUN_POLL_ATTEMPTS) {
        closeEventStream(msgId)
        // Update the pending message to show a timeout notice without killing it
        if (shouldPaint()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, status: 'failed', error: 'Run timed out — the agent may still be working. Refresh to check.', content: '' }
                : m,
            ),
          )
        }
        return
      }

      // Show elapsed time hint in the bubble after 30s
      if (attempts === 20 && shouldPaint()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.status === 'pending'
              ? { ...m, content: '' } // keep pending state visible
              : m,
          ),
        )
      }

      try {
        const events = liveEventsRef.current[msgId] ?? []
        const res = await fetch(`/api/v1/conversations/${convId}/messages/${msgId}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, agentId, events }),
        })
        const body = await readApiResponse(res)
        const data = body.data as { status?: string; content?: string; error?: string } | undefined
        const status: string | undefined = data?.status
        const finalizedContent = typeof data?.content === 'string' ? data.content : undefined
        const finalizedError = typeof data?.error === 'string' && data.error.trim()
          ? data.error.trim()
          : undefined

        if (!res.ok && shouldStopFinalizePollingForStatus(res.status)) {
          closeEventStream(msgId)
          if (shouldPaint()) {
            const apiMessage = typeof body.error === 'string' && !body.error.trim().startsWith('<')
              ? body.error
              : undefined
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      status: 'failed',
                      error: apiMessage
                        ? `Agent response could not be finalized: ${apiMessage}. Refresh and send again if needed.`
                        : `Agent response could not be finalized (${res.status}). Refresh and send again if needed.`,
                      content: '',
                    }
                  : m,
              ),
            )
          }
          return
        }

        // Retry transient non-2xx finalize API errors (e.g. 502 upstream), but do not retry terminal auth/not-found cases.
        if (!res.ok && status !== 'failed') {
          scheduleFinalizePoll(convId, msgId, runId, agentId, attempts)
          return
        }

        if (status === 'queued') {
          pollFailuresRef.current[msgId] = 0
          if (shouldPaint()) {
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? { ...m, status: 'queued', runId } : m)),
            )
          }
          scheduleFinalizePoll(convId, msgId, runId, agentId, attempts)
          return
        }

        if (!status || status === 'running') {
          pollFailuresRef.current[msgId] = 0
          // Safety net: if SSE died, the DB may already have the completed reply.
          if (attempts > 0 && attempts % FINALIZE_MESSAGE_RECOVERY_EVERY === 0) {
            const latest = await loadMessages(convId, { silent: true, softError: true })
            const serverMessage = latest?.find((message) => message.id === msgId)
            if (shouldAdoptServerMessageDuringFinalizePoll(serverMessage)) {
              closeEventStream(msgId)
              await loadConversations()
              return
            }
          }
          scheduleFinalizePoll(convId, msgId, runId, agentId, attempts)
          return
        }

        if (status === 'waiting_approval') {
          if (shouldPaint()) {
            const lastEvent = events[events.length - 1]
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? { ...m, status: 'waiting_approval', runId } : m)),
            )
            setApprovalPending((prev) => ({
              ...prev,
              [msgId]: { runId, agentId, toolName: lastEvent?.tool },
            }))
          }
          if (shouldAutoApproveDangerousCommands(approvalModeRef.current)) {
            void (async () => {
              try {
                const res = await fetch(
                  `/api/v1/admin/agents/${agentId}/runs/${encodeURIComponent(runId)}/approval`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ choice: 'always' }),
                  },
                )
                if (!res.ok) return
                if (shouldPaint()) {
                  setApprovalPending((prev) => {
                    const next = { ...prev }
                    delete next[msgId]
                    return next
                  })
                  setMessages((prev) =>
                    prev.map((m) => (m.id === msgId ? { ...m, status: 'pending' } : m)),
                  )
                }
                startEventStream(msgId, runId, agentId, convId)
                scheduleFinalizePoll(convId, msgId, runId, agentId, attempts)
              } catch {
                // Keep waiting_approval UI if auto-approve fails.
                return
              }
            })()
          }
          return
        }

        // completed or failed — flip local status even when SSE never delivered events,
        // then reload with retries so a transient Failed to fetch cannot leave the bubble pending.
        closeEventStream(msgId)
        const thinking = buildThinkingTrace(events)
        const terminalStatus = status === 'failed' ? 'failed' : 'completed'
        if (shouldPaint()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? {
                    ...m,
                    status: terminalStatus,
                    ...(typeof finalizedContent === 'string' ? { content: finalizedContent } : {}),
                    ...(thinking ? { thinking } : {}),
                    ...(terminalStatus === 'failed'
                      ? { error: finalizedError || m.error || 'Agent run failed' }
                      : { error: undefined }),
                  }
                : m,
            ),
          )
        }
        let loaded: ConversationMessage[] | null = null
        for (let retry = 0; retry < FINALIZE_LOAD_RETRIES; retry += 1) {
          loaded = await loadMessages(convId, { silent: true, softError: true })
          if (loaded) break
          await new Promise((resolve) => setTimeout(resolve, 400 * (retry + 1)))
        }
        if (!loaded && shouldPaint()) {
          setError('Agent finished, but the reply could not be refreshed. Reload the page to see it.')
        }
        await loadConversations()
      } catch {
        const failures = (pollFailuresRef.current[msgId] ?? 0) + 1
        pollFailuresRef.current[msgId] = failures
        if (failures < 8) {
          scheduleFinalizePoll(
            convId,
            msgId,
            runId,
            agentId,
            attempts,
            Math.min(POLL_INTERVAL * failures, 10_000),
          )
          return
        }
        closeEventStream(msgId)
        if (shouldPaint()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? {
                    ...m,
                    status: 'failed',
                    error: 'Lost connection while checking the agent run. Refresh or send the message again.',
                    content: '',
                  }
                : m,
            ),
          )
        }
      }
    },
    [loadMessages, loadConversations, closeEventStream, scheduleFinalizePoll, startEventStream],
  )

  useEffect(() => {
    pollFinalizeRef.current = pollFinalize
  }, [pollFinalize])

  // ── Auto-resume polling for pending messages (e.g. from previous sessions) ─
  // Must be after startEventStream + pollFinalize to avoid TDZ
  useEffect(() => {
    resumedRunsRef.current = new Set()
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    const knownAgentIds: AgentId[] = [...AGENT_IDS]
    for (const m of messages) {
      if (
        m.role === 'assistant' &&
        (m.status === 'queued' || m.status === 'pending' || m.status === 'streaming') &&
        m.runId &&
        !resumedRunsRef.current.has(m.id)
      ) {
        resumedRunsRef.current.add(m.id)
        const dispatchedAgentId = m.dispatchAgentId ?? m.authorId
        const agentId: AgentId = knownAgentIds.includes(dispatchedAgentId as AgentId)
          ? (dispatchedAgentId as AgentId)
          : 'pip'
        if (m.status !== 'queued') startEventStream(m.id, m.runId, agentId, activeId)
        pollFinalize(activeId, m.id, m.runId, agentId)
      }
    }
  }, [messages, activeId, startEventStream, pollFinalize])

  // ── Resolve approval ──────────────────────────────────────────────────────
  const resolveApproval = useCallback(
    async (msgId: string, choice: 'once' | 'always' | 'deny') => {
      const pending = approvalPending[msgId]
      if (!pending) return
      try {
        const res = await fetch(
          `/api/v1/admin/agents/${pending.agentId}/runs/${encodeURIComponent(pending.runId)}/approval`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ choice }),
          },
        )
        if (!res.ok) throw new Error(`approval failed: ${res.status}`)
        setApprovalPending((prev) => {
          const next = { ...prev }
          delete next[msgId]
          return next
        })
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, status: 'pending' } : m)),
        )
        if (activeId) {
          startEventStream(msgId, pending.runId, pending.agentId, activeId)
          pollFinalize(activeId, msgId, pending.runId, pending.agentId)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Approval failed')
      }
    },
    [approvalPending, activeId, pollFinalize, startEventStream],
  )

  const patchContextRefsRef = useRef<((
    action: 'add' | 'remove' | 'clear',
    refs?: Array<ContextReference | ContextReferenceSeed>,
  ) => Promise<ContextReference[]>) | null>(null)
  const handleUiAction = useCallback(
    async (message: ConversationMessage, action: ChatUiAction, options?: { openDock?: boolean }) => {
      const actionType = String(action.type).toLowerCase()
      if (actionType === 'open_context') {
        // Never pin context for a bubble that belongs to another thread (stale
        // transcript after a tab switch, or a late SSE/finalize paint).
        if (
          message.conversationId
          && activeConversationIdRef.current
          && message.conversationId !== activeConversationIdRef.current
        ) {
          return
        }
        const payload = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
          ? action.payload as Record<string, unknown>
          : {}
        const kind = contextReferenceTypeFrom(payload.kind ?? payload.type ?? action.value)
        const id = typeof payload.id === 'string'
          ? payload.id.trim()
          : typeof action.value === 'string'
            ? action.value.trim()
            : ''
        const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : ''
        const label = typeof payload.label === 'string' ? payload.label.trim() : action.label
        if (!kind || !id) {
          setError('This open-context action is missing a valid context reference.')
          return
        }
        try {
          const patch = patchContextRefsRef.current
          if (!patch) throw new Error('Context attachment is not ready yet')
          await patch('add', [{
            type: kind,
            id,
            ...(label ? { label } : {}),
            ...(projectId ? { metadata: { projectId } } : {}),
          }])
          if (
            message.conversationId
            && activeConversationIdRef.current
            && message.conversationId !== activeConversationIdRef.current
          ) {
            return
          }
          // Auto-attach pins the ref (so the strip chip appears) but must NOT
          // force the Context Dock open. The human clicks the chip or the
          // action button to open the preview.
          if (options?.openDock === false) return
          setContextFocusRequest({
            kind,
            id,
            ...(projectId ? { projectId } : {}),
            nonce: Date.now(),
          })
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to open context')
        }
        return
      }
      if (actionType === 'open' || actionType === 'download' || actionType === 'copy') return

      // Project task proposals: create durable tasks on the platform. Do not require
      // Hermes run resume — the proposal run is often already completed when Peet clicks.
      if (isCreateTasksUiAction(action) && extractProjectTaskProposal(message)) {
        const conversationId = message.conversationId || activeId
        if (!conversationId) {
          setError('Select the conversation that owns this task proposal before creating tasks.')
          return
        }
        try {
          setError(null)
          const result = await createProposedTasksFromMessage({
            orgId,
            conversationId,
            message,
            messages,
          })
          setMessages((prev) =>
            prev.map((row) => {
              if (row.id !== message.id) return row
              const nextActions = Array.isArray(row.uiActions)
                ? row.uiActions.map((item) => (
                  item.id === action.id || item.actionId === action.actionId
                    ? { ...item, disabled: true, label: 'Tasks created' }
                    : item
                ))
                : row.uiActions
              return { ...row, uiActions: nextActions }
            }),
          )
          void refreshProjectChat().catch(() => undefined)
          if (result.deduplicatedCount > 0 && result.deduplicatedCount === result.createdTaskIds.length) {
            setError(null)
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to create proposed tasks')
        }
        return
      }

      // Human-session API actions (Decision Brief confirm, etc.): browser cookie auth,
      // payload body as-is. Never requires a Hermes run id — agents cannot perform these.
      const endpoint = typeof action.endpoint === 'string' && action.endpoint.startsWith('/api/')
        ? action.endpoint
        : null
      const bodyMode = String(action.bodyMode ?? action.body_mode ?? 'envelope').toLowerCase()
      if (endpoint && bodyMode === 'payload') {
        try {
          const method = action.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(action.method).toUpperCase())
            ? String(action.method).toUpperCase()
            : 'POST'
          const res = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload && typeof action.payload === 'object' ? action.payload : {}),
          })
          if (!res.ok) {
            const body = await readApiResponse(res)
            throw new Error(typeof body.error === 'string' ? body.error : `action failed: ${res.status}`)
          }
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== message.id) return m
              const nextActions = Array.isArray(m.uiActions)
                ? m.uiActions.map((item) => (
                  item.id === action.id
                    ? { ...item, disabled: true, label: actionType === 'approve' ? 'Confirmed' : `${item.label} ✓` }
                    : item
                ))
                : m.uiActions
              return { ...m, uiActions: nextActions }
            }),
          )
          // Refresh project suite / command session so Plan gate unlocks live.
          void refreshProjectChat().catch(() => undefined)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Action failed')
        }
        return
      }

      const runId = message.runId
      if (!runId) {
        setError('This action is missing the Hermes run id.')
        return
      }

      const candidateAgentId = message.dispatchAgentId ?? message.authorId ?? initialAgentId ?? 'pip'
      const agentId: AgentId = AGENT_IDS.includes(candidateAgentId as AgentId)
        ? candidateAgentId as AgentId
        : 'pip'

      try {
        const runEndpoint = endpoint
          ?? `/api/v1/admin/agents/${agentId}/runs/${encodeURIComponent(runId)}/actions`
        const res = await fetch(runEndpoint, {
          method: action.method && ['POST', 'PUT', 'PATCH'].includes(action.method) ? action.method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionId: action.actionId ?? action.id,
            type: actionType,
            value: action.value,
            payload: action.payload,
          }),
        })
        if (!res.ok) {
          const body = await readApiResponse(res)
          throw new Error(typeof body.error === 'string' ? body.error : `action failed: ${res.status}`)
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, status: 'pending' } : m)),
        )
        if (activeId) {
          startEventStream(message.id, runId, agentId, activeId)
          pollFinalize(activeId, message.id, runId, agentId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    },
    [activeId, initialAgentId, messages, orgId, pollFinalize, refreshProjectChat, startEventStream],
  )

  useEffect(() => {
    if (!activeId) return
    // Require conversationId match. After a tab switch the previous transcript
    // is still mounted until the clear+load effects commit; without this gate
    // chat A's open_context would PATCH onto chat B.
    const latestAssistant = [...messages].reverse().find((message) => (
      message.role === 'assistant'
      && message.conversationId === activeId
      && Array.isArray(message.uiActions)
      && message.uiActions.length > 0
    ))
    if (!latestAssistant?.uiActions?.length) return
    for (const action of latestAssistant.uiActions) {
      if (String(action.type).toLowerCase() !== 'open_context') continue
      const payload = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
        ? action.payload as Record<string, unknown>
        : {}
      const kind = String(payload.kind ?? payload.type ?? action.value ?? '').trim().toLowerCase()
      const targetId = typeof payload.id === 'string'
        ? payload.id.trim()
        : typeof action.value === 'string'
          ? action.value.trim()
          : ''
      // Prefer stable canvas identity over message id so finalize/replace of the
      // assistant bubble cannot re-auto-open a dock the user already dismissed.
      // Scope by conversation so switch-time handled-set clears cannot re-pin
      // chat A's open_context onto chat B while A's messages are still mounted.
      const identity = action.id
        ? `action:${action.id}`
        : kind && targetId
          ? `target:${kind}:${targetId}`
          : `message:${latestAssistant.id}:${action.id ?? 'open_context'}`
      const key = `${activeId}:${identity}`
      if (handledOpenContextActionsRef.current.has(key)) continue
      handledOpenContextActionsRef.current.add(key)
      // Auto-handler: attach the ref (chip appears) but do NOT auto-open the
      // Context Dock. Peet opens the preview by clicking the chip/button.
      void handleUiAction(latestAssistant, action, { openDock: false })
      break
    }
  }, [activeId, handleUiAction, messages])

  const projectTaskHref = useCallback((taskId: string) => {
    const projectId = projectChat.activeProjectId ?? ''
    const base = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')
      ? `/admin/projects/${encodeURIComponent(projectId)}`
      : `/portal/projects/${encodeURIComponent(projectId)}`
    return `${base}?task=${encodeURIComponent(taskId)}`
  }, [projectChat.activeProjectId])

  const handleProjectTaskAction = useCallback(async (task: ProjectChatTaskItem) => {
    const projectId = projectChat.activeProjectId
    if (!projectId) return
    const approvalTask = task.approvalStatus === 'pending'
      || task.labels?.some((label) => /approval-gate|approval-required|client-approval|required-approval/.test(label.toLowerCase()))
    if (!approvalTask) {
      window.location.assign(projectTaskHref(task.id))
      return
    }
    const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columnId: 'done',
        reviewStatus: 'approved',
        approvalStatus: 'approved',
      }),
    })
    if (!res.ok) {
      const body = await readApiResponse(res)
      setError(typeof body.error === 'string' ? body.error : `Task approval failed: ${res.status}`)
      return
    }
    await projectChat.refresh().catch(() => undefined)
  }, [projectChat, projectTaskHref])

  const addSelectionToComposer = useCallback((selectedText: string) => {
    const cleaned = selectedText.trim()
    if (!cleaned) return
    const quoted = cleaned
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n')
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${quoted}\n\n` : `${quoted}\n\n`))
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      const length = composerRef.current?.value.length ?? 0
      composerRef.current?.setSelectionRange(length, length)
    })
  }, [])

  const addVoiceTranscriptToComposer = useCallback((transcript: string) => {
    const cleaned = transcript.trim()
    if (!cleaned) return
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${cleaned}` : cleaned))
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      const length = composerRef.current?.value.length ?? 0
      composerRef.current?.setSelectionRange(length, length)
    })
  }, [])

  const addWorkbenchNoteToComposer = useCallback((text: string) => {
    const cleaned = text.trim()
    if (!cleaned) return
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${cleaned}\n\n` : `${cleaned}\n\n`))
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      const length = composerRef.current?.value.length ?? 0
      composerRef.current?.setSelectionRange(length, length)
    })
  }, [])

  const updateMentionFromComposer = useCallback((value: string, caret = value.length) => {
    const mention = findActiveContextMention(value, caret)
    const typePrompt = mention ? null : findActiveContextTypePrompt(value, caret)
    const activeContextPicker = mention ?? typePrompt
    const insertedSeparator = contextPickerInsertedSeparatorRef.current
    if (!activeContextPicker) contextPickerInsertedSeparatorRef.current = undefined
    else if (typeof insertedSeparator === 'number' && (
      insertedSeparator !== activeContextPicker.start - 1 || value[insertedSeparator] !== ' '
    )) contextPickerInsertedSeparatorRef.current = undefined
    const commandPrompt = mention || typePrompt ? null : findActiveSlashCommandPrompt(value, caret)
    if (commandPrompt) setDesignMenuOpen(false)
    setContextMention(mention)
    setContextTypePrompt(typePrompt)
    setSlashPrompt(commandPrompt)
    const parsed = parseLeadingSlashCommand(value)
    if (!parsed) setSelectedSlashCommand(null)
    else if (!selectedSlashCommand || parsed.command.id !== selectedSlashCommand.id) {
      setSelectedSlashCommand(parsed.command)
    }
  }, [selectedSlashCommand])

  const focusComposerToEnd = useCallback((value: string) => {
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(value.length, value.length)
    })
  }, [])

  const openContextPicker = useCallback(() => {
    const activePicker = contextMention ?? contextTypePrompt
    if (activePicker) {
      requestAnimationFrame(() => {
        composerRef.current?.focus()
        composerRef.current?.setSelectionRange(activePicker.end, activePicker.end)
      })
      return
    }
    const needsSeparator = Boolean(input && !/\s$/.test(input))
    contextPickerInsertedSeparatorRef.current = needsSeparator ? input.length : null
    const next = `${input}${needsSeparator ? ' ' : ''}@`
    setInput(next)
    updateMentionFromComposer(next, next.length)
    focusComposerToEnd(next)
  }, [contextMention, contextTypePrompt, focusComposerToEnd, input, updateMentionFromComposer])

  const rememberComposerPrompt = useCallback((conversationId: string, rawPrompt: string) => {
    const trimmed = rawPrompt.trim()
    if (!trimmed) return

    setHistoryCursor(null)
    historyDraftRef.current = ''
    setComposerHistory((previous) => {
      const next = [...previous.filter((entry) => entry !== trimmed), trimmed]
        .slice(-MAX_COMPOSER_HISTORY_ENTRIES)
      writeComposerHistory(orgId, conversationId, next)
      return conversationId === activeId ? next : previous
    })
  }, [activeId, orgId])

  const queueCurrentComposerDraft = useCallback(() => {
    if (!activeId) {
      setError('Select or start a conversation before queuing a follow-up.')
      return false
    }
    if (!allowSendMessages) {
      setError('Replies are disabled for your organisation role.')
      return false
    }
    if (!input.trim() && attachments.length === 0) return false
    if (activeQueuedDrafts.length >= MAX_QUEUED_COMPOSER_DRAFTS) {
      setError(`You can queue up to ${MAX_QUEUED_COMPOSER_DRAFTS} follow-ups for this conversation.`)
      return false
    }

    const nextDraft: QueuedComposerDraft = {
      id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: activeId,
      text: input,
      attachments: [...attachments],
      queuedAt: Date.now(),
    }

    setQueuedDraftsByConversation((previous) => {
      const current = previous[activeId] ?? []
      return { ...previous, [activeId]: [...current, nextDraft] }
    })

    rememberComposerPrompt(activeId, input)
    setInput('')
    setAttachments([])
    setContextMention(null)
    setContextTypePrompt(null)
    setSlashPrompt(null)
    setSelectedSlashCommand(null)
    setContextSearchResults([])
    setError(null)
    focusComposerToEnd('')
    return true
  }, [activeId, activeQueuedDrafts.length, allowSendMessages, attachments, focusComposerToEnd, input, rememberComposerPrompt])

  const removeQueuedDraft = useCallback((draftId: string) => {
    if (!activeId) return
    setQueuedDraftsByConversation((previous) => {
      const current = previous[activeId] ?? []
      const next = current.filter((draft) => draft.id !== draftId)
      if (next.length === current.length) return previous
      if (next.length === 0) {
        const { [activeId]: _removed, ...rest } = previous
        void _removed
        return rest
      }
      return { ...previous, [activeId]: next }
    })
  }, [activeId])

  const loadQueuedDraftIntoComposer = useCallback((draft: QueuedComposerDraft) => {
    if (!activeId || draft.conversationId !== activeId) return
    setInput(draft.text)
    setAttachments(draft.attachments)
    setHistoryCursor(null)
    historyDraftRef.current = ''
    updateMentionFromComposer(draft.text, draft.text.length)
    removeQueuedDraft(draft.id)
    focusComposerToEnd(draft.text)
  }, [activeId, focusComposerToEnd, removeQueuedDraft, updateMentionFromComposer])

  const navigateComposerHistory = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, direction: -1 | 1) => {
    const historyEntries = composerHistory.length > 0 || !activeId
      ? composerHistory
      : readComposerHistory(orgId, activeId)
    if (contextMention || contextTypePrompt || slashPrompt || historyEntries.length === 0) return false
    if (historyEntries !== composerHistory) setComposerHistory(historyEntries)

    const target = event.currentTarget
    const selectionStart = target.selectionStart ?? target.value.length
    const selectionEnd = target.selectionEnd ?? target.value.length
    const hasSelection = selectionStart !== selectionEnd
    const atStart = selectionStart === 0 && selectionEnd === 0
    const atEnd = selectionStart === target.value.length && selectionEnd === target.value.length
    if (hasSelection) return false
    if (direction < 0 && target.value.includes('\n') && !atStart) return false
    if (direction > 0 && historyCursor === null) return false
    if (direction > 0 && target.value.includes('\n') && !atEnd) return false

    event.preventDefault()

    let nextCursor: number | null
    let nextInput: string
    if (direction < 0) {
      if (historyCursor === null) {
        historyDraftRef.current = input
        nextCursor = historyEntries.length - 1
      } else {
        nextCursor = Math.max(0, historyCursor - 1)
      }
      nextInput = historyEntries[nextCursor] ?? ''
    } else if (historyCursor === null) {
      return true
    } else if (historyCursor >= historyEntries.length - 1) {
      nextCursor = null
      nextInput = historyDraftRef.current
    } else {
      nextCursor = historyCursor + 1
      nextInput = historyEntries[nextCursor] ?? ''
    }

    setHistoryCursor(nextCursor)
    setInput(nextInput)
    updateMentionFromComposer(nextInput, nextInput.length)
    focusComposerToEnd(nextInput)
    requestAnimationFrame(() => resizeComposer())
    return true
  }, [activeId, composerHistory, contextMention, contextTypePrompt, focusComposerToEnd, historyCursor, input, orgId, resizeComposer, slashPrompt, updateMentionFromComposer])

  const patchContextRefs = useCallback(async (
    action: 'add' | 'remove' | 'clear',
    refs: Array<ContextReference | ContextReferenceSeed> = [],
  ): Promise<ContextReference[]> => {
    const localRefs = refs.map(coerceContextRef)
    if (!activeId) {
      let next: ContextReference[]
      if (action === 'clear') next = []
      else if (action === 'remove') {
        const removeKeys = new Set(localRefs.map(contextReferenceKey))
        next = contextRefs.filter((ref) => !removeKeys.has(contextReferenceKey(ref)))
      } else {
        next = mergeContextRefs(contextRefs, localRefs)
      }
      setContextRefs(next)
      return next
    }

    const initiatingConversationId = activeId
    const res = await fetch(`/api/v1/conversations/${initiatingConversationId}/context`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, refs: localRefs }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? `context update failed: ${res.status}`)
    const next = ((body?.data?.contextRefs ?? []) as ContextReference[]).map(coerceContextRef)
    if (activeConversationIdRef.current === initiatingConversationId) setContextRefs(next)
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === initiatingConversationId ? { ...conversation, contextRefs: next } : conversation,
      ),
    )
    return next
  }, [activeId, coerceContextRef, contextRefs])
  patchContextRefsRef.current = patchContextRefs

  const pinCurrentPageContext = useCallback(async (): Promise<ContextReference[]> => {
    if (!currentPageContext) {
      setError('No current page context was detected for this route.')
      return contextRefs
    }
    setError(null)
    return patchContextRefs('add', [coerceContextRef(currentPageContext)])
  }, [coerceContextRef, contextRefs, currentPageContext, patchContextRefs])

  const removeContextRef = useCallback((ref: ContextReference) => {
    const initiatingConversationId = activeId
    patchContextRefs('remove', [ref]).catch((err) => {
      if (activeConversationIdRef.current !== initiatingConversationId) return
      setError(err instanceof Error ? err.message : 'Failed to remove context')
    })
  }, [activeId, patchContextRefs])

  const selectMentionContext = useCallback((ref: ContextReference) => {
    const conversationIdAtSelection = activeId
    const mentionAtSelection = contextMention
    const inputAtSelection = input
    const editRevisionAtSelection = composerEditRevisionRef.current
    const insertedSeparatorAtSelection = contextPickerInsertedSeparatorRef.current
    patchContextRefs('add', [ref])
      .then(() => {
        if (activeConversationIdRef.current !== conversationIdAtSelection) return
        if (mentionAtSelection && composerEditRevisionRef.current === editRevisionAtSelection) {
          setInput((latestInput) => {
            if (composerEditRevisionRef.current !== editRevisionAtSelection || latestInput !== inputAtSelection) {
              return latestInput
            }
            return removeMentionTokenFromLatest(
              latestInput,
              inputAtSelection,
              mentionAtSelection,
              insertedSeparatorAtSelection,
            )
          })
        }
        contextPickerInsertedSeparatorRef.current = undefined
        setContextMention(null)
        setContextTypePrompt(null)
        setContextSearchResults([])
        setAgentMentionResults([])
        requestAnimationFrame(() => composerRef.current?.focus())
      })
      .catch((err) => {
        if (activeConversationIdRef.current !== conversationIdAtSelection) return
        setError(err instanceof Error ? err.message : 'Failed to attach context')
      })
  }, [activeId, contextMention, input, patchContextRefs])

  /** Insert @agent:<id> into the draft — does not pin context; send spawns the branch. */
  const selectAgentMention = useCallback((agentId: string) => {
    if (!contextMention || (contextMention.kind !== 'agent' && !isAgentMentionNamespace(contextMention.namespace))) {
      return
    }
    const completed = completeAgentMentionToken(input, contextMention, agentId)
    setInput(completed.value)
    setContextMention(null)
    setContextTypePrompt(null)
    setContextSearchResults([])
    setAgentMentionResults([])
    setSlashPrompt(null)
    contextPickerInsertedSeparatorRef.current = undefined
    composerEditRevisionRef.current += 1
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(completed.caret, completed.caret)
    })
  }, [contextMention, input])

  const selectContextType = useCallback((option: ContextReferenceMentionOption) => {
    if (!contextTypePrompt) return
    // Agents use the singular @agent: token that parseMentions understands on send.
    const namespace = option.kind === 'agent' ? 'agent' : option.namespace
    const nextInput = replaceTypePromptToken(input, contextTypePrompt, namespace)
    const caret = contextTypePrompt.start + namespace.length + 2
    setInput(nextInput)
    setContextTypePrompt(null)
    setSlashPrompt(null)
    setContextMention(findActiveContextMention(nextInput, caret))
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(caret, caret)
    })
  }, [contextTypePrompt, input])

  const handleContextPickerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!contextPickerOpen) return false

    if (event.key === 'Escape') return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (contextPickerOptionCount === 0) return true
      setContextPickerActiveIndex((current) => {
        if (event.key === 'Home') return 0
        if (event.key === 'End') return contextPickerOptionCount - 1
        if (event.key === 'ArrowDown') return (current + 1) % contextPickerOptionCount
        return (current - 1 + contextPickerOptionCount) % contextPickerOptionCount
      })
      return true
    }
    if (event.key !== 'Enter' || event.shiftKey) return false

    event.preventDefault()
    if (contextPickerOptionCount === 0) return true
    const activeIndex = Math.min(contextPickerActiveIndex, contextPickerOptionCount - 1)
    if (contextTypePrompt) {
      const option = contextTypeOptions[activeIndex]
      if (option) selectContextType(option)
    } else if (contextMention && isAgentComposerMention) {
      const agent = agentMentionResults[activeIndex]
      if (agent) selectAgentMention(agent.agentId)
    } else if (contextMention) {
      const ref = contextSearchResults[activeIndex]
      if (ref) selectMentionContext(ref)
    }
    return true
  }, [agentMentionResults, contextMention, contextPickerActiveIndex, contextPickerOpen, contextPickerOptionCount, contextSearchResults, contextTypeOptions, contextTypePrompt, isAgentComposerMention, selectAgentMention, selectContextType, selectMentionContext])

  const selectSlashCommand = useCallback((command: SlashCommandDefinition) => {
    if (!slashPrompt) return
    const next = replaceSlashCommandToken(input, slashPrompt, command)
    setInput(next.value)
    setSelectedSlashCommand(command)
    setSlashPrompt(null)
    setContextMention(null)
    setContextTypePrompt(null)
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }, [input, slashPrompt])

  // Design-command action menu (mobile fallback for the "/" composer surface).
  // Inserts the command token into the composer so the user can add a target,
  // or sends a bare command when the composer is empty and Enter is pressed.
  const insertDesignCommand = useCallback((command: DesignCommandDefinition) => {
    const token = `${command.token} `
    const nextValue = input.trim() ? `${input.trimEnd()} ${token}` : token
    setInput(nextValue)
    setSelectedSlashCommand({
      id: command.id,
      token: command.token,
      label: command.label,
      description: command.description,
      aliases: command.aliases,
      icon: command.icon,
      executorKind: 'design_command',
    })
    setDesignMenuOpen(false)
    setSlashPrompt(null)
    setContextMention(null)
    setContextTypePrompt(null)
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(nextValue.length, nextValue.length)
    })
  }, [input])

  const addPendingAttachments = useCallback((files: File[]) => {
    if (files.length === 0) return
    const { validFiles, errors } = splitValidConversationAttachments(files)
    setError(errors[0] ?? null)
    if (validFiles.length === 0) return
    const openSlots = Math.max(0, MAX_PENDING_ATTACHMENTS - attachments.length)
    if (openSlots === 0) {
      setError(`You can attach up to ${MAX_PENDING_ATTACHMENTS} files at a time.`)
      return
    }
    if (validFiles.length > openSlots) {
      setError(`Only ${openSlots} more attachment${openSlots === 1 ? '' : 's'} can be added.`)
    }
    setAttachments((prev) => [...prev, ...validFiles.slice(0, openSlots)].slice(0, MAX_PENDING_ATTACHMENTS))
  }, [attachments.length])

  const dataTransferHasFiles = useCallback((dataTransfer: DataTransfer): boolean => {
    if ((dataTransfer.files?.length ?? 0) > 0) return true
    return Array.from(dataTransfer.types ?? []).includes('Files')
  }, [])

  const handleAttachmentDrop = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setDraggingAttachments(false)
    if (sending) return
    addPendingAttachments(Array.from(event.dataTransfer.files ?? []))
  }, [addPendingAttachments, dataTransferHasFiles, sending])

  const handleAttachmentDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    if (sending) return
    event.dataTransfer.dropEffect = 'copy'
    setDraggingAttachments(true)
  }, [dataTransferHasFiles, sending])

  const handleAttachmentDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDraggingAttachments(false)
  }, [])

  // ── Rename conversation ───────────────────────────────────────────────────
  const renameConversation = useCallback(async (convId: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setRenamingId(null)
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title: trimmed } : c)),
    )
    await fetch(`/api/v1/conversations/${convId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    }).catch(() => {})
  }, [])

  // ── Archive conversation ──────────────────────────────────────────────────
  const archiveConversation = useCallback(
    async (convId: string) => {
      if (!allowArchiveConversations) return
      setMenuOpenId(null)
      setMenuPosition(null)
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (activeId === convId) setActiveId(null)
      await fetch(`/api/v1/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      }).catch(() => {})
    },
    [activeId, allowArchiveConversations, setActiveId],
  )

  // ── Delete conversation ──────────────────────────────────────────────────
  const deleteConversation = useCallback(
    async (convId: string) => {
      if (!allowDeleteConversations) return
      const conv = conversations.find((c) => c.id === convId)
      const label = conv?.title || 'this conversation'
      if (!window.confirm(`Delete "${label}" permanently? This cannot be undone.`)) return

      setMenuOpenId(null)
      setMenuPosition(null)
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (activeId === convId) {
        setActiveId(null)
        setMessages([])
      }

      const res = await fetch(`/api/v1/conversations/${convId}`, { method: 'DELETE' })
      if (!res.ok) {
        await loadConversations()
        if (activeId === convId) await loadMessages(convId).catch(() => {})
        setError(`Delete failed: ${res.status}`)
      }
    },
    [activeId, allowDeleteConversations, conversations, loadConversations, loadMessages, setActiveId],
  )

  const openConversationInNewWindow = useCallback((convId: string) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('convId', convId)
    url.searchParams.delete('agent')
    url.searchParams.delete('runId')
    url.searchParams.delete('taskId')
    url.searchParams.delete('taskTitle')

    setMenuOpenId(null)
    setMenuPosition(null)
    setHeaderMenuOpen(false)

    const width = Math.min(1240, Math.max(860, Math.floor(window.screen.availWidth * 0.72)))
    const height = Math.min(940, Math.max(720, Math.floor(window.screen.availHeight * 0.86)))
    const left = Math.max(0, Math.floor((window.screen.availWidth - width) / 2))
    const top = Math.max(0, Math.floor((window.screen.availHeight - height) / 2))
    window.open(
      url.toString(),
      `pib-chat-${convId}`,
      `noopener,noreferrer,width=${width},height=${height},left=${left},top=${top}`,
    )
  }, [])

  // ── Export chat transcript (Markdown download) ───────────────────────────
  const fetchConversationMessagesForExport = useCallback(async (convId: string): Promise<ConversationMessage[]> => {
    let res: Response
    try {
      res = await fetch(`/api/v1/conversations/${convId}/messages`)
    } catch {
      try {
        res = await fetch(`/api/v1/chat-feed/${convId}`)
      } catch {
        res = await fetch(`/api/v1/thread-data/${convId}`)
      }
    }
    if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500)) {
      const fallback = await fetch(`/api/v1/chat-feed/${convId}`)
      if (fallback.ok || !res.ok) res = fallback
    }
    if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 404 || res.status >= 500)) {
      const fallback = await fetch(`/api/v1/thread-data/${convId}`)
      if (fallback.ok || !res.ok) res = fallback
    }
    if (!res.ok) throw new Error(`export messages: ${res.status}`)
    const body = await res.json()
    return (body.data?.messages ?? []) as ConversationMessage[]
  }, [])

  const exportConversation = useCallback(async (convId: string) => {
    if (exportingChat) return
    const conversation = conversations.find((item) => item.id === convId)
      ?? (activeConversation?.id === convId ? activeConversation : null)
    setExportingChat(true)
    setMenuOpenId(null)
    setMenuPosition(null)
    setHeaderMenuOpen(false)
    try {
      const exportMessages = convId === activeId
        ? messages
        : await fetchConversationMessagesForExport(convId)
      exportChatAsMarkdown({
        title: conversation?.title || 'Conversation',
        conversationId: convId,
        messages: exportMessages,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export chat')
    } finally {
      setExportingChat(false)
    }
  }, [
    activeConversation,
    activeId,
    conversations,
    exportingChat,
    fetchConversationMessagesForExport,
    messages,
  ])

  // Any participant in the chat can stop an in-flight agent run.
  const canStopRuns = allowStopRuns

  // ── Stop agent run ───────────────────────────────────────────────────────
  const stopAgentRun = useCallback(
    async (convId: string, msgId: string) => {
      if (!canStopRuns) return
      closeEventStream(msgId)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, status: 'failed', error: 'Stopping agent run...', content: '' }
            : m,
        ),
      )
      const res = await fetch(`/api/v1/conversations/${convId}/messages/${msgId}/stop`, {
        method: 'POST',
      })
      if (!res.ok) {
        setError(`Stop failed: ${res.status}`)
      }
      await loadMessages(convId)
      await loadConversations()
    },
    [canStopRuns, closeEventStream, loadConversations, loadMessages],
  )

  // ── Create new conversation (from modal) ──────────────────────────────────
  const handleProjectSetup = useCallback(async () => {
    if (!projectSetupCanSubmit || projectSetupSubmitting) return
    setProjectSetupSubmitting(true)
    setProjectSetupError(null)
    try {
      const payload: Record<string, unknown> = {
        mode: projectSetupMode,
        orgId,
        companyId: projectSetupCompanyId,
        projectName: projectSetupName.trim(),
      }
      if (projectSetupMode === 'existing_folder') {
        const locations = projectSetupLocationOptions.filter((candidate) => projectSetupLocationIds.includes(candidate.locationId) && candidate.selectable)
        const location = locations[0]
        if (!location || locations.length !== projectSetupLocationIds.length) throw new Error('Select authorised project locations.')
        payload.workspaceId = projectSetupWorkspaceId
        payload.workspaceFolderId = projectSetupWorkspaceFolderId
        payload.locationId = location.locationId
        payload.locationIds = locations.map((candidate) => candidate.locationId)
        if (location.mappingId) payload.mappingId = location.mappingId
      } else if (projectSetupMode === 'standard') {
        payload.workspaceId = projectSetupWorkspaceId
        payload.locationIds = Array.from(new Set([
          ...(projectSetupCanonicalVps ? [projectSetupCanonicalVps.locationId] : []),
          ...projectSetupLocationIds,
        ]))
      } else {
        payload.clientName = projectSetupClientName.trim()
        payload.domainSlug = projectSetupDomainSlug.trim()
        payload.agentName = projectSetupAgentName.trim()
      }

      const idempotencyKey = projectSetupIdempotencyKeyRef.current || newProjectSetupIdempotencyKey()
      projectSetupIdempotencyKeyRef.current = idempotencyKey
      const response = await fetch('/api/v1/project-setups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error ?? `Project setup failed: ${response.status}`)
      const data = body?.data && typeof body.data === 'object'
        ? body.data as Record<string, unknown>
        : null
      const projectIdFromResponse = typeof data?.projectId === 'string' ? data.projectId.trim() : ''
      const plan = data?.plan && typeof data.plan === 'object'
        ? data.plan as ProjectSetupPlanView
        : null
      if (!projectIdFromResponse || !plan || typeof plan.state !== 'string') {
        throw new Error('Project setup returned an incomplete project contract.')
      }
      const project = data?.project && typeof data.project === 'object'
        ? data.project as Record<string, unknown>
        : null
      const projectNameFromResponse = typeof project?.name === 'string' && project.name.trim()
        ? project.name.trim()
        : projectSetupName.trim()
      const directLocationIds = Array.isArray(project?.locationIds)
        ? project.locationIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
        : []
      const nestedLocationIds = Array.isArray(project?.locations)
        ? project.locations.flatMap((value) => {
            if (typeof value === 'string' && value.trim()) return [value.trim()]
            if (!value || typeof value !== 'object') return []
            const location = value as Record<string, unknown>
            const id = typeof location.locationId === 'string'
              ? location.locationId
              : typeof location.id === 'string' ? location.id : ''
            return id.trim() ? [id.trim()] : []
          })
        : []
      const topLevelLocationIds = Array.isArray(data?.locationIds)
        ? data.locationIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim())
        : []
      const replicaLocationIds = Array.isArray(data?.replicas)
        ? data.replicas.flatMap((value) => {
            if (!value || typeof value !== 'object') return []
            const replica = value as Record<string, unknown>
            return typeof replica.locationId === 'string' && replica.locationId.trim()
              ? [replica.locationId.trim()]
              : []
          })
        : []
      const linkedLocationIds = Array.from(new Set([
        ...directLocationIds,
        ...nestedLocationIds,
        ...topLevelLocationIds,
        ...replicaLocationIds,
      ]))

      const setupResult: ProjectSetupResultView = {
        mode: projectSetupMode,
        projectId: projectIdFromResponse,
        projectName: projectNameFromResponse,
        plan,
        linkedLocationIds,
        ...(typeof data?.organizationId === 'string' && data.organizationId.trim()
          ? { organizationId: data.organizationId.trim() }
          : {}),
        ...(typeof data?.organizationSlug === 'string' && data.organizationSlug.trim()
          ? { organizationSlug: data.organizationSlug.trim() }
          : {}),
      }
      if (projectSetupMode === 'full_client') {
        // The project belongs to the newly provisioned client organisation.
        // Keep the current organisation catalogue untouched and hand the user
        // into that client's Messages workspace explicitly.
        setProjectSetupResult(setupResult)
        return
      }

      const refreshed = await refreshWorkspaceCatalogueRef.current()
      const catalogueProjects = refreshed?.projects ?? workspaceProjects
      if (!catalogueProjects.some((candidate) => candidate.id === projectIdFromResponse)) {
        setWorkspaceProjects((current) => [
          ...current.filter((candidate) => candidate.id !== projectIdFromResponse),
          { id: projectIdFromResponse, name: projectNameFromResponse },
        ].sort((left, right) => left.name.localeCompare(right.name)))
      }
      setNewScope('project')
      setSelectedProjectId(projectIdFromResponse)

      const refreshedTargets = refreshed?.runtimeTargetsByWorkspace ?? workspaceRuntimeTargetsByWorkspace
      let availableLocation: { workspaceId: string; selectionKey: string } | undefined
      for (const [workspaceId, targets] of Object.entries(refreshedTargets)) {
        const runtime = targets.find((candidate) => candidate.selectable && linkedLocationIds.includes(projectRuntimeLocationId(candidate)))
        if (runtime) {
          availableLocation = { workspaceId, selectionKey: workspaceRuntimeSelectionKey(runtime) }
          break
        }
      }
      if (availableLocation) {
        workspaceRuntimeExplicitRef.current = true
        setSelectedWorkspaceId(availableLocation.workspaceId)
        setSelectedWorkspaceRuntime(availableLocation.selectionKey)
      }
      setProjectSetupResult(setupResult)
    } catch (projectError) {
      setProjectSetupError(projectError instanceof Error ? projectError.message : 'Project setup failed')
    } finally {
      setProjectSetupSubmitting(false)
    }
  }, [orgId, projectSetupAgentName, projectSetupCanSubmit, projectSetupCanonicalVps, projectSetupClientName, projectSetupCompanyId, projectSetupDomainSlug, projectSetupLocationIds, projectSetupLocationOptions, projectSetupMode, projectSetupName, projectSetupSubmitting, projectSetupWorkspaceFolderId, projectSetupWorkspaceId, workspaceProjects, workspaceRuntimeTargetsByWorkspace])

  const handleCreateConversation = useCallback(async () => {
    if (creatingConv) return
    if (!allowStartConversations) {
      setModalError('Starting new conversations is disabled for your organisation role.')
      return
    }
    if ((newScope === 'workspace' || newScope === 'company' || newScope === 'project') && !selectedWorkspaceRuntimeIsValid) {
      setModalError('Select an available runtime for this Workspace before starting the conversation.')
      return
    }
    if (newScope === 'project' && projectSetupBlocksSession) {
      setModalError('This project does not yet have an available linked location.')
      return
    }
    setCreatingConv(true)
    setModalError(null)
    const idempotencyKey = newConversationCreateIdempotencyKey()
    const adoptCreatedConversation = (conv: Conversation, opts?: { networkRecovered?: boolean }) => {
      setConversations((prev) => (prev.some((row) => row.id === conv.id) ? prev : [conv, ...prev]))
      setActiveId(conv.id)
      setMobilePane('conversation')
      setMessages([])
      setShowNewModal(false)
      setShowProjectSetupWizard(false)
      setNewTitle('')
      setNewParticipants([])
      setNewScope(scope ?? (projectId ? 'project' : 'general'))
      setModalError(null)
      if (opts?.networkRecovered) {
        setError('Chat was created — connection dropped on the way back. You’re in the new session now.')
      }
    }
    try {
      const participants = newParticipants.map((p) =>
        p.kind === 'agent'
          ? { kind: 'agent' as const, agentId: p.agentId }
          : { kind: 'user' as const, uid: p.uid },
      )
      const agentIds = participants
        .filter((participant): participant is { kind: 'agent'; agentId: string } => participant.kind === 'agent')
        .map((participant) => participant.agentId)
      const scopedShareMode = normalizedScopedConversationShareMode(
        newScope,
        selectedWorkspaceRuntimeTarget,
        selectedWorkspaceShareMode,
      )
      const payload: Record<string, unknown> = {
        orgId,
        participants,
      }
      if (newTitle.trim()) payload.title = newTitle.trim()
      if (newScope !== 'general') payload.scope = newScope
      if (newScope === 'workspace') {
        if (!selectedWorkspaceId) throw new Error('Select a Workspace before starting a Workspace chat.')
        const selected = parseWorkspaceRuntimeSelection(selectedWorkspaceRuntime)
        payload.workspaceId = selectedWorkspaceId
        payload.runtimeTarget = selected.runtimeTargetId
        if (selected.mappingId) payload.mappingId = selected.mappingId
        payload.shareMode = scopedShareMode
      }
      if (newScope === 'company') {
        if (!selectedCompanyId) throw new Error('Select a company before starting a company Cowork chat.')
        if (!selectedWorkspaceId) throw new Error('No organisation runtime Workspace is available for this company.')
        const selected = parseWorkspaceRuntimeSelection(selectedWorkspaceRuntime)
        payload.scopeRefId = selectedCompanyId
        payload.workspaceId = selectedWorkspaceId
        payload.runtimeTarget = selected.runtimeTargetId
        if (selected.mappingId) payload.mappingId = selected.mappingId
        payload.shareMode = scopedShareMode
      }
      if (newScope === 'project') {
        if (!selectedProjectId) throw new Error('Select a project before starting a project chat.')
        if (!selectedWorkspaceId) throw new Error('No organisation Workspace is available for this project.')
        const selected = parseWorkspaceRuntimeSelection(selectedWorkspaceRuntime)
        payload.scopeRefId = selectedProjectId
        payload.workspaceId = selectedWorkspaceId
        payload.runtimeTarget = selected.runtimeTargetId
        if (selected.mappingId) payload.mappingId = selected.mappingId
        payload.shareMode = scopedShareMode
      }
      if (newScope === scope && scopeRefId) payload.scopeRefId = scopeRefId
      if (newScope === 'project' && projectId && !payload.scopeRefId) payload.scopeRefId = projectId
      if (contextRefs.length > 0) payload.contextRefs = contextRefs

      const reconcileCriteria = {
        startedBy: currentUserUid,
        scope: newScope,
        scopeRefId: typeof payload.scopeRefId === 'string' ? payload.scopeRefId : undefined,
        companyId: newScope === 'company' ? selectedCompanyId : undefined,
        projectId: newScope === 'project'
          ? (typeof payload.scopeRefId === 'string' ? payload.scopeRefId : selectedProjectId)
          : undefined,
        workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : selectedWorkspaceId || undefined,
        runtimeTarget: typeof payload.runtimeTarget === 'string' ? payload.runtimeTarget : undefined,
        agentIds,
        title: newTitle.trim() || undefined,
      }

      let res: Response
      try {
        res = await fetch('/api/v1/conversations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(payload),
        })
      } catch (networkError) {
        if (!isNetworkFetchFailure(networkError)) throw networkError
        setModalError(formatCreateConversationNetworkError('checking'))
        // Retry once with the same idempotency key — server replays the created chat.
        try {
          res = await fetch('/api/v1/conversations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
          })
        } catch (retryError) {
          if (!isNetworkFetchFailure(retryError)) throw retryError
          const listRes = await fetch(`/api/v1/conversations?${listQuery}`)
          if (!listRes.ok) throw new Error(formatCreateConversationNetworkError('unconfirmed'))
          const listBody = await listRes.json().catch(() => null)
          const listed = (listBody?.data?.conversations ?? []) as Conversation[]
          const matched = matchReconciledCreatedConversation(listed, reconcileCriteria)
          if (!matched) throw new Error(formatCreateConversationNetworkError('unconfirmed'))
          const recovered = listed.find((row) => row.id === matched.id) ?? (matched as Conversation)
          adoptCreatedConversation(recovered, { networkRecovered: true })
          return
        }
      }

      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? `create conversation: ${res.status}`)
      }
      const conv: Conversation | undefined = body?.data?.conversation
      if (!conv?.id) throw new Error('create conversation: missing conversation payload')
      adoptCreatedConversation(conv)
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to create conversation')
    } finally {
      setCreatingConv(false)
    }
  }, [allowStartConversations, creatingConv, newParticipants, newTitle, newScope, orgId, projectId, projectSetupBlocksSession, scope, scopeRefId, contextRefs, selectedWorkspaceId, selectedWorkspaceRuntime, selectedWorkspaceRuntimeIsValid, selectedWorkspaceShareMode, selectedProjectId, selectedCompanyId, setActiveId, currentUserUid, listQuery])

  const dispatchComposerMessage = useCallback(
    async (options: {
      text: string
      attachments: File[]
      clearComposer: boolean
      useSelectedSlashCommand?: boolean
    }): Promise<boolean> => {
      const {
        text,
        attachments: filesToSend,
        clearComposer,
        useSelectedSlashCommand = true,
      } = options
      if (!text.trim() && filesToSend.length === 0) return false
      if (sending) return false
      if (!allowSendMessages) {
        setError('Replies are disabled for your organisation role.')
        return false
      }
      if (runtimeBlocksComposer) {
        setError('Computer unavailable')
        return false
      }

      setError(null)
      setSending(true)
      let convId = activeId
      let optimisticMessageIds: string[] = []

      try {
        const currentPageCommand = extractCurrentPageContextCommand(text)
        const parsedSlashCommand = parseLeadingSlashCommand(text)
        const activeSlashCommand = (
          useSelectedSlashCommand ? selectedSlashCommand : null
        ) ?? parsedSlashCommand?.command ?? null
        const slashArgs = parsedSlashCommand?.args ?? ''
        const slashPayload: SlashCommandPayload | null = activeSlashCommand
          ? buildSlashCommandPayload(activeSlashCommand, slashArgs)
          : null
        if (slashPayload) {
          const access = evaluateSlashCommandAccess({
            commandId: slashPayload.id,
            args: slashPayload.args,
            actor: slashAccessActor,
            conversation: {
              startedBy: activeConversation?.startedBy ?? currentUserUid,
              ownerUserId: activeConversation?.workspaceContext?.ownerUserId ?? null,
            },
            agent: slashAccessAgent,
          })
          if (!access.allowed) {
            setError(access.reason)
            setSending(false)
            return false
          }
        }
        const shouldUseCurrentPage =
          currentPageCommand.shouldUseCurrentPage || activeSlashCommand?.id === 'use-current-page'
        const messageText = currentPageCommand.shouldUseCurrentPage
          ? currentPageCommand.content
          : activeSlashCommand?.id === 'use-current-page'
            ? slashArgs
            : activeSlashCommand?.executorKind === 'hermes_goal'
              // Preserve args only (may be empty for `/goal status`-style controls).
              // Server maps slashCommand token + args into Hermes goal control/state.
              ? slashArgs
            : activeSlashCommand
              ? slashArgs || activeSlashCommand.description
              : text
        let refsForSend = preferCurrentPageContext && currentPageContext && !convId
          ? [coerceContextRef(currentPageContext)]
          : contextRefs
        if (shouldUseCurrentPage) {
          refsForSend = await pinCurrentPageContext()
          if (!messageText.trim() && filesToSend.length === 0) {
            if (clearComposer) {
              setInput('')
              setContextMention(null)
              setContextTypePrompt(null)
              setSlashPrompt(null)
              setSelectedSlashCommand(null)
            }
            return false
          }
        }

        // Auto-create a conversation if none selected.
        let createdWithAgent = false
        if (!convId) {
          if (!allowStartConversations) {
            throw new Error('Starting new conversations is disabled for your organisation role.')
          }
          const participants = allowAgentParticipants
            ? [{ kind: 'agent' as const, agentId: 'pip' as const }]
            : []
          const payload: Record<string, unknown> = {
            orgId,
            participants,
            title: messageText.slice(0, 80) || 'Context conversation',
          }
          const scopedShareMode = normalizedScopedConversationShareMode(
            scope ?? 'general',
            selectedWorkspaceRuntimeTarget,
            selectedWorkspaceShareMode,
          )
          if (scope) payload.scope = scope
          if (scopeRefId) payload.scopeRefId = scopeRefId
          if (scope === 'company') {
            if (!selectedWorkspaceId || !selectedWorkspaceRuntimeIsValid) {
              throw new Error('Select an available computer before starting this company Cowork chat.')
            }
            const selected = parseWorkspaceRuntimeSelection(selectedWorkspaceRuntime)
            payload.workspaceId = selectedWorkspaceId
            payload.runtimeTarget = selected.runtimeTargetId
            if (selected.mappingId) payload.mappingId = selected.mappingId
            payload.shareMode = scopedShareMode
          }
          if (refsForSend.length > 0) payload.contextRefs = refsForSend
          const r = await fetch('/api/v1/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const b = await r.json()
          convId = b.data?.conversation?.id as string | undefined ?? null
          if (!convId) throw new Error(b?.error ?? 'Failed to create conversation')
          createdWithAgent = participants.length > 0
          setConversations((prev) => [b.data.conversation, ...prev])
          setActiveId(convId)
          setMobilePane('conversation')
        }

        const uploadedAttachments = filesToSend.length > 0
          ? await Promise.all(filesToSend.map((file) => uploadConversationAttachment(convId!, file)))
          : []

        // Build content: keep file names in the text preview, store URLs separately.
        let content = messageText
        if (uploadedAttachments.length > 0) {
          const attNote = uploadedAttachments
            .map((attachment) => `Attachment: ${attachment.name} (${(attachment.sizeBytes / 1024).toFixed(1)} KB)`)
            .join('\n')
          content = content.trim() ? `${content}\n\n${attNote}` : attNote
        }
        rememberComposerPrompt(convId!, text)
        if (clearComposer) {
          setInput('')
          setContextMention(null)
          setContextTypePrompt(null)
          setSlashPrompt(null)
          setSelectedSlashCommand(null)
          setContextSearchResults([])
          setAttachments([])
        }
        const nowSec = Date.now() / 1000
        const shouldExpectAgentReply =
          createdWithAgent ||
          (activeConversation?.participantAgentIds?.length ?? 0) > 0
        const runtimeForSend = modelCatalog?.canSelect && selectedRuntime?.model ? selectedRuntime : null

        // Optimistic messages
        const optimisticTimestamp = Date.now()
        const optimisticUser: ConversationMessage = {
          id: `tmp-user-${optimisticTimestamp}`,
          conversationId: convId,
          role: 'user',
          content,
          authorKind: 'user',
          authorId: currentUserUid,
          authorDisplayName: currentUserDisplayName,
          ...(uploadedAttachments.length > 0 ? { attachments: uploadedAttachments } : {}),
          ...(refsForSend.length > 0 ? { contextRefs: refsForSend } : {}),
          ...(slashPayload ? { slashCommand: slashPayload } : {}),
          ...(agentEffort ? { agentEffort } : {}),
          ...(runtimeForSend?.model ? { model: runtimeForSend.model } : {}),
          ...(runtimeForSend?.provider ? { provider: runtimeForSend.provider } : {}),
          status: 'completed',
          createdAt: { seconds: nowSec },
        }
        const optimisticAgent: ConversationMessage[] = shouldExpectAgentReply
          ? [{
              id: `tmp-assistant-${optimisticTimestamp}`,
              conversationId: convId,
              role: 'assistant',
              content: '',
              authorKind: 'agent',
              authorId: 'pending',
              authorDisplayName: 'Agent',
              ...(runtimeForSend?.model ? { model: runtimeForSend.model } : {}),
              ...(runtimeForSend?.provider ? { provider: runtimeForSend.provider } : {}),
              status: 'pending',
              createdAt: { seconds: nowSec + 0.001 },
            }]
          : []
        optimisticMessageIds = [optimisticUser.id, ...optimisticAgent.map((message) => message.id)]
        // Do not append optimistic rows if the user already switched sessions —
        // that would briefly (or permanently, via a follow-on race) paint this
        // send into the wrong conversation.
        if (activeConversationIdRef.current === convId) {
          setMessages((prev) => [...prev, optimisticUser, ...optimisticAgent])
        }

        const res = await postConversationMessage(`/api/v1/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            attachments: uploadedAttachments,
            contextRefs: refsForSend,
            approvalMode,
            ...(slashPayload ? { slashCommand: slashPayload } : {}),
            ...(agentEffort ? { agentEffort } : {}),
            ...(runtimeForSend?.model ? { model: runtimeForSend.model } : {}),
            ...(runtimeForSend?.provider ? { provider: runtimeForSend.provider } : {}),
            ...(runtimeForSend?.llmConnectionId ? { llmConnectionId: runtimeForSend.llmConnectionId } : {}),
            ...(runtimeForSend?.llmCredentialBindingId ? { llmCredentialBindingId: runtimeForSend.llmCredentialBindingId } : {}),
          }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Send failed')

        const newAssistantId: string | undefined = body.data?.assistantMessage?.id
        const runId: string | undefined = body.data?.runId
        const runDocId: string | undefined = body.data?.runDocId
        const dispatchAgentId: AgentId | undefined = body.data?.dispatchAgentId

        // Reload real messages (replaces optimistic). Soft-fail so a transient
        // Failed to fetch cannot block live run tracking.
        await loadMessages(convId, { softError: true })

        if (newAssistantId && runId) {
          const agentParticipant = conversations
            .find((c) => c.id === convId)
            ?.participants.find((p) => p.kind === 'agent')
          const agentId: AgentId =
            dispatchAgentId ?? (agentParticipant?.kind === 'agent' ? agentParticipant.agentId : 'pip')
          void runDocId
          // Open SSE stream to receive live tool-call events
          startEventStream(newAssistantId, runId, agentId, convId)
          pollFinalize(convId, newAssistantId, runId, agentId)
        }
        return true
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Send failed'
        if (optimisticMessageIds.length > 0) {
          const optimisticIds = new Set(optimisticMessageIds)
          setMessages((prev) => prev.filter((row) => !optimisticIds.has(row.id)))
        }
        if (clearComposer) {
          setInput((current) => current.trim() ? current : text)
          if (filesToSend.length > 0) {
            setAttachments((current) => current.length > 0 ? current : filesToSend)
          }
        }
        setError(message)
        return false
      } finally {
        setSending(false)
      }
    },
    [
      activeId,
      agentEffort,
      approvalMode,
      selectedRuntime,
      modelCatalog?.canSelect,
      sending,
      rememberComposerPrompt,
      contextRefs,
      preferCurrentPageContext,
      currentPageContext,
      coerceContextRef,
      pinCurrentPageContext,
      allowAgentParticipants,
      allowStartConversations,
      allowSendMessages,
      runtimeBlocksComposer,
      orgId,
      currentUserUid,
      currentUserDisplayName,
      scope,
      scopeRefId,
      selectedWorkspaceId,
      selectedWorkspaceRuntime,
      selectedWorkspaceRuntimeIsValid,
      selectedWorkspaceShareMode,
      loadMessages,
      pollFinalize,
      startEventStream,
      conversations,
      activeConversation?.participantAgentIds?.length,
      selectedSlashCommand,
      setActiveId,
    ],
  )

  const dispatchComposerMessageRef = useRef(dispatchComposerMessage)
  useEffect(() => {
    dispatchComposerMessageRef.current = dispatchComposerMessage
  }, [dispatchComposerMessage])

  const send = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!input.trim() && attachments.length === 0) return
      if (sending) return
      if (!allowSendMessages) {
        setError('Replies are disabled for your organisation role.')
        return
      }
      if (runtimeBlocksComposer) {
        setError('Computer unavailable')
        return
      }
      if (hasInFlightAgentRun) {
        queueCurrentComposerDraft()
        return
      }
      await dispatchComposerMessage({
        text: input,
        attachments,
        clearComposer: true,
        useSelectedSlashCommand: true,
      })
    },
    [
      input,
      attachments,
      sending,
      allowSendMessages,
      runtimeBlocksComposer,
      hasInFlightAgentRun,
      queueCurrentComposerDraft,
      dispatchComposerMessage,
    ],
  )

  // Auto-send the next queued follow-up once the active agent run finishes.
  // The queue is a next-turn bridge ("Will send after this run"), not live steering.
  const queuedDraftsRef = useRef(queuedDraftsByConversation)
  const flushingQueuedDraftRef = useRef(false)
  const autoFlushBlockedDraftIdsRef = useRef(new Set<string>())
  useEffect(() => {
    queuedDraftsRef.current = queuedDraftsByConversation
  }, [queuedDraftsByConversation])

  useEffect(() => {
    if (hasInFlightAgentRun) {
      // A new run started — allow previously failed auto-flushes to retry afterward.
      autoFlushBlockedDraftIdsRef.current.clear()
      return
    }
    if (sending || flushingQueuedDraftRef.current) return
    if (!activeId || !allowSendMessages || runtimeBlocksComposer) return
    const nextDraft = (queuedDraftsRef.current[activeId] ?? [])[0]
    if (!nextDraft || autoFlushBlockedDraftIdsRef.current.has(nextDraft.id)) return

    flushingQueuedDraftRef.current = true
    const current = queuedDraftsRef.current[activeId] ?? []
    if (current[0]?.id !== nextDraft.id) {
      flushingQueuedDraftRef.current = false
      return
    }
    const draft = current[0]
    const remaining = current.slice(1)
    const nextQueue = remaining.length === 0
      ? (() => {
          const { [activeId]: _removed, ...rest } = queuedDraftsRef.current
          void _removed
          return rest
        })()
      : { ...queuedDraftsRef.current, [activeId]: remaining }
    queuedDraftsRef.current = nextQueue
    setQueuedDraftsByConversation(nextQueue)

    void dispatchComposerMessageRef.current({
      text: draft.text,
      attachments: draft.attachments,
      clearComposer: false,
      useSelectedSlashCommand: false,
    }).then((ok) => {
      if (ok) return
      autoFlushBlockedDraftIdsRef.current.add(draft.id)
      const restored = {
        ...queuedDraftsRef.current,
        [activeId]: [draft, ...(queuedDraftsRef.current[activeId] ?? []).filter((item) => item.id !== draft.id)],
      }
      queuedDraftsRef.current = restored
      setQueuedDraftsByConversation(restored)
    }).finally(() => {
      flushingQueuedDraftRef.current = false
    })
  }, [
    hasInFlightAgentRun,
    sending,
    activeId,
    allowSendMessages,
    runtimeBlocksComposer,
    queuedDraftsByConversation,
  ])

  // ── Render ────────────────────────────────────────────────────────────────
  const scopeLabel = companyCoworkLocked
    ? 'Company Cowork'
    : scope && scope !== 'general'
      ? scope.charAt(0).toUpperCase() + scope.slice(1)
      : 'Default'
  const subtitle = [orgName, scopeLabel].filter(Boolean).join(' · ')
  const availableConversationContexts = companyCoworkLocked
    ? [{ value: 'company' as const, label: `Company Cowork: ${selectedCompanyName || orgName || 'selected company'}` }]
    : [
      { value: 'general' as const, label: `General conversation${orgName ? `: ${orgName}` : ''}` },
      ...(workspaces.length > 0 ? [{ value: 'workspace' as const, label: 'Organisation root folder' }] : []),
      ...(workspaces.length > 0 ? [{ value: 'company' as const, label: 'Company Cowork folder' }] : []),
      { value: 'project' as const, label: 'Project inside company' },
      ...(scope && scope !== 'general' && scope !== 'project' && scope !== 'workspace' && scope !== 'company'
        ? [{ value: scope, label: `Current ${scope}: ${scopeRefId ?? 'selected item'}` }]
        : []),
    ]
  const showListOnMobile = mobilePane === 'list'
  const hermesLayout = layoutVariant === 'hermes' && !compact
  // A saved collapsed preference only applies to the docked >=1280 rail. Overlay
  // Sessions always renders its complete catalogue without mutating that preference.
  const railCollapsed = hermesLayout && conversationRailMode === 'collapsed' && !sessionsOverlayViewport
  const closeSessions = useCallback(() => {
    setMobilePane('conversation')
    if (sessionsOverlayViewport) {
      requestAnimationFrame(() => mobileSessionsTriggerRef.current?.focus())
    }
  }, [sessionsOverlayViewport])
  useEffect(() => {
    if (!showConversationList || !showListOnMobile || !sessionsOverlayViewport) return
    mobileSessionsCloseRef.current?.focus()
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && activeConversation) { event.preventDefault(); closeSessions(); return }
      if (event.key !== 'Tab' || !mobileSessionsRef.current) return
      const focusable = Array.from(mobileSessionsRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]; const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [activeConversation, closeSessions, sessionsOverlayViewport, showConversationList, showListOnMobile])
  const canStopActiveRun = Boolean(
    canStopRuns &&
    activeRuntimeMessage?.runId &&
    activeId &&
    (activeRuntimeMessage?.status === 'pending' ||
      activeRuntimeMessage?.status === 'queued' ||
      activeRuntimeMessage?.status === 'streaming' ||
      activeRuntimeMessage?.status === 'waiting_approval'),
  )
  const retryRuntimeAction = activeRuntimeMessage?.uiActions?.find((action) =>
    String(action.type).toLowerCase() === 'retry' && !action.disabled,
  )
  const runtimeExecution: RuntimeExecution | undefined = activeRuntimeMessage?.runId ? {
    activeMessage: activeRuntimeMessage,
    events: activeRuntimeEvents,
    selectedRuntime,
    catalog: modelCatalog,
    canStop: canStopActiveRun,
    onStop: activeRuntimeMessage.id && activeId ? () => stopAgentRun(activeId, activeRuntimeMessage.id) : undefined,
    canRetry: Boolean(retryRuntimeAction),
    onRetry: retryRuntimeAction ? () => { void handleUiAction(activeRuntimeMessage, retryRuntimeAction) } : undefined,
  } : undefined
  const showComposerContextToolbar = Boolean(
    currentPageContext ||
    contextRefs.length > 0 ||
    projectChat.progress ||
    (!hermesLayout && (allowAgentParticipants || activeModelAgentId)),
  )

  return (
    <div
      data-testid="unified-chat-root"
      data-layout-variant={layoutVariant}
      className={
        compact
          ? 'relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden'
          : !showConversationList
            ? 'relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden'
          : hermesLayout
            ? `relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden xl:grid xl:gap-2 ${railCollapsed ? 'xl:grid-cols-[48px_minmax(0,1fr)]' : 'xl:grid-cols-[236px_minmax(0,1fr)]'}`
            : 'relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden lg:grid lg:gap-4 lg:grid-cols-[280px_minmax(0,1fr)]'
      }
    >
      {/* ── Left: conversation list ─────────────────────────────────────── */}
      {showConversationList && showListOnMobile && tabletSessionsDrawer && <div data-testid="sessions-backdrop" aria-hidden="true" onClick={closeSessions} className="fixed inset-0 z-40 bg-black/45 xl:hidden" />}
      {showConversationList && <aside
        ref={mobileSessionsRef}
        role={sessionsOverlayViewport && showListOnMobile ? 'dialog' : undefined}
        aria-modal={sessionsOverlayViewport && showListOnMobile ? 'true' : undefined}
        aria-label={sessionsOverlayViewport && showListOnMobile ? 'Session browser' : undefined}
        data-presentation={sessionsOverlayViewport && showListOnMobile ? tabletSessionsDrawer ? 'drawer' : 'sheet' : 'rail'}
        className={[
          hermesLayout
            ? `min-h-0 min-w-0 flex-col gap-2 overflow-hidden flex-1 rounded-xl border border-[var(--color-card-border)] bg-black/[0.08] ${railCollapsed ? 'p-1' : 'p-2'}`
            : 'pib-card min-h-0 min-w-0 flex-col gap-2 overflow-hidden flex-1 p-3',
          compact ? '!rounded-none !border-0 !bg-transparent' : 'xl:flex max-xl:!rounded-none max-xl:!border-0 max-xl:!bg-transparent',
          showListOnMobile
            ? tabletSessionsDrawer
              ? 'flex fixed inset-y-0 left-0 z-50 w-[min(380px,42vw)] rounded-none bg-[var(--color-surface,#151515)] pl-[max(.75rem,env(safe-area-inset-left))] pr-[max(.75rem,env(safe-area-inset-right))] pb-[max(.75rem,env(safe-area-inset-bottom))] pt-[max(.75rem,env(safe-area-inset-top))] shadow-2xl xl:static xl:w-auto xl:shadow-none'
              : 'flex max-xl:fixed max-xl:inset-0 max-xl:z-50 max-xl:rounded-none max-xl:bg-[var(--color-surface,#151515)] max-xl:pl-[max(.75rem,env(safe-area-inset-left))] max-xl:pr-[max(.75rem,env(safe-area-inset-right))] max-xl:pb-[max(.75rem,env(safe-area-inset-bottom))] max-xl:pt-[max(.75rem,env(safe-area-inset-top))]'
            : 'hidden',
        ].join(' ')}
      >
        {railCollapsed && (
          <div className="hidden min-h-0 flex-1 flex-col items-center gap-1.5 xl:flex">
            <button type="button" aria-label="Expand sessions" onClick={() => onConversationRailModeChange?.('expanded')} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] xl:h-10 xl:w-10"><span aria-hidden="true" className="material-symbols-outlined text-[19px]">left_panel_open</span></button>
            <button type="button" aria-label="New conversation" onClick={() => openNewConversation()} disabled={!allowStartConversations} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-40 xl:h-10 xl:w-10"><span aria-hidden="true" className="material-symbols-outlined text-[19px]">add_comment</span></button>
            <button type="button" aria-label="Search sessions" onClick={() => { onConversationRailModeChange?.('expanded'); requestAnimationFrame(() => conversationFilterRef.current?.focus()) }} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] xl:h-10 xl:w-10"><span aria-hidden="true" className="material-symbols-outlined text-[19px]">search</span></button>
            <div aria-hidden="true" className="my-0.5 h-px w-7 bg-[var(--color-card-border)]" />
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {filteredConversations.slice(0, 10).map((conversation) => (
                <button key={conversation.id} type="button" aria-label={`Open ${conversation.title || 'Untitled session'}`} title={conversation.title || 'Untitled session'} onClick={() => { setActiveId(conversation.id); closeSessions() }} className={`relative grid h-11 w-11 place-items-center rounded-lg xl:h-10 xl:w-10 ${conversation.id === activeId ? 'bg-primary/14 text-primary' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.07] hover:text-[var(--color-pib-text)]'}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">chat_bubble</span>
                  {pinnedConversationIdSet.has(conversation.id) ? <span aria-label="Pinned session" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-300" /> : null}
                  {(conversation.unreadCount ?? 0) > 0 ? (
                    <span
                      aria-label={`${conversation.unreadCount} unread message${conversation.unreadCount === 1 ? '' : 's'}`}
                      className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[8px] font-bold text-on-primary"
                    >
                      {conversation.unreadCount! > 9 ? '9+' : conversation.unreadCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={railCollapsed ? 'hidden' : 'contents'}>
        <div className="mb-1 flex min-h-11 items-center justify-between xl:hidden"><div><p className="text-[10px] font-label uppercase tracking-[0.2em] text-[var(--color-pib-text-muted)]">Messages</p><h2 className="text-base font-semibold text-[var(--color-pib-text)]">Browse sessions</h2></div>{activeConversation && <button ref={mobileSessionsCloseRef} type="button" aria-label="Close sessions" onClick={closeSessions} className="grid h-11 w-11 place-items-center rounded-full text-[var(--color-pib-text-muted)] hover:bg-white/[0.07]"><span aria-hidden="true" className="material-symbols-outlined">close</span></button>}</div>
        <div className={hermesLayout ? 'flex min-w-0 items-center gap-1.5' : 'contents'}>
          <button
            type="button"
            onClick={() => openNewConversation()}
            disabled={!allowStartConversations}
            aria-label="New conversation"
            className={hermesLayout
              ? 'flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-[var(--color-card-border)] bg-white/[0.05] px-1.5 text-xs font-medium text-[var(--color-pib-text)] hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 xl:h-8'
              : 'rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:opacity-90 flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45'}
          >
            <span className={`material-symbols-outlined ${hermesLayout ? 'text-[14px]' : 'text-[16px]'}`} aria-hidden="true">add</span>
            {hermesLayout ? 'Conversation' : 'New conversation'}
          </button>

          {hermesLayout && (
            <button
              type="button"
              aria-label="New project"
              onClick={openNewProject}
              disabled={!allowStartConversations}
              className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-xs font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-45 xl:h-8"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">create_new_folder</span>
              Project
            </button>
          )}
        </div>

        <div className={hermesLayout ? 'mt-1.5 px-1 text-[10px] font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]' : 'text-xs text-[var(--color-pib-text-muted)] mt-2 px-1'}>
          {hermesLayout ? 'Sessions' : 'Conversations'}
        </div>

        <label className="relative block">
          <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-[var(--color-pib-text-muted)]" aria-hidden="true">search</span>
          <input
            ref={conversationFilterRef}
            type="search"
            aria-label="Filter conversations"
            value={conversationFilter}
            onChange={(event) => setConversationFilter(event.target.value)}
            placeholder="Filter conversations"
            className={hermesLayout
              ? 'h-11 w-full rounded-md border border-[var(--color-card-border)] bg-black/10 pl-7 pr-2 text-xs text-[var(--color-pib-text)] outline-none placeholder:text-[var(--color-pib-text-muted)]/65 focus:border-primary/50 focus:ring-1 focus:ring-primary/30 xl:h-8'
              : 'h-9 w-full rounded-lg border border-[var(--color-card-border)] bg-transparent pl-8 pr-2 text-sm text-[var(--color-pib-text)] outline-none placeholder:text-[var(--color-pib-text-muted)] focus:border-primary/50 focus:ring-1 focus:ring-primary/30'}
          />
        </label>

        {hermesLayout && hiddenFolderPreferencesLoaded && hiddenFolderOptions.length > 0 && (
          <div className="relative">
            <button
              type="button"
              aria-label="Restore hidden folders"
              aria-expanded={showHiddenFolders}
              onClick={() => setShowHiddenFolders((current) => !current)}
              className="flex h-11 w-full items-center justify-between rounded-md border border-dashed border-white/[0.1] px-2 text-xs text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8"
            >
              <span className="inline-flex items-center gap-1.5"><span className="material-symbols-outlined text-[14px]" aria-hidden="true">folder_open</span>Hidden folders</span>
              <span className="font-mono text-[10px]">{hiddenFolderOptions.length}</span>
            </button>
            {showHiddenFolders && (
              <div className="mt-1 space-y-1 rounded-md border border-white/[0.08] bg-black/10 p-1.5">
                {hiddenFolderOptions.map((folder) => (
                  <div key={folder.key} className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1">
                    <HoverTip label={folder.name} side="right" className="min-w-0 flex-1">
                      <span className="block min-w-0 truncate text-xs text-[var(--color-pib-text)]">{folder.name}</span>
                    </HoverTip>
                    <span className="text-[10px] text-[var(--color-pib-text-muted)]">{folder.kind}</span>
                    <button
                      type="button"
                      aria-label={`Restore ${folder.name}`}
                      disabled={hiddenFolderPreferencesSaving}
                      onClick={() => restoreFolderToSidebar(folder.key)}
                      className="rounded px-2 py-1 text-xs text-primary hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={hermesLayout ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5' : 'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto'}>
          {(hermesLayout ? !hasHermesRailItems : filteredConversations.length === 0) && (
            <div className="text-xs text-[var(--color-pib-text-muted)] px-2 py-3">
              {conversationFilter.trim()
                ? 'No projects or conversations match your filter.'
                : allowStartConversations
                  ? workspaceProjects.length === 0
                    ? 'No projects yet. Use New project above to create your first project, then start its sessions.'
                    : 'No projects or conversations yet. Start one.'
                  : 'No projects or conversations yet.'}
            </div>
          )}
          {hermesLayout && hermesCompanyGroups.length > 0 && (
            <div data-testid="hermes-companies" className="min-w-0">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
                <span>Cowork folders</span>
                <span className="font-mono text-[10px] tracking-normal text-[var(--color-pib-text-muted)]/55">{hermesCompanyGroups.length}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                {hermesCompanyGroups.map((company) => {
                  const groupKey = `company:${company.id}`
                  const sessionsExpanded = Boolean(conversationFilter.trim()) || expandedSessionGroupKeys.includes(groupKey)
                  const sessionsRegionId = `company-sessions-${company.id}`
                  return (
                    <div
                      key={company.id}
                      data-testid={`hermes-company-${company.id}`}
                      data-folder-accent={`company:${company.id}`}
                      style={folderAccentStyle(`company:${company.id}`)}
                      className="mx-folder-accent min-w-0 overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.025] py-0.5 pl-1.5 pr-0.5"
                    >
                    <div className="flex min-w-0 items-center gap-0.5 px-0.5">
                      <button
                        type="button"
                        aria-expanded={sessionsExpanded}
                        aria-controls={sessionsRegionId}
                        aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} sessions for ${company.name}`}
                        onClick={() => toggleSessionGroup(groupKey)}
                        className="flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0"
                      >
                        <span className="material-symbols-outlined shrink-0 text-[14px] text-primary" aria-hidden="true">folder</span>
                        <HoverTip label={company.name} side="right" className="min-w-0 flex-1">
                          <span className="block min-w-0 truncate text-[11px] font-semibold leading-4 text-[var(--color-pib-text)]">{company.name}</span>
                        </HoverTip>
                        <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]/70">{company.conversations.length}</span>
                        <span className="material-symbols-outlined shrink-0 text-[14px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                          {sessionsExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Start session in ${company.name}`}
                        title={`Start session in ${company.name}`}
                        disabled={!allowStartConversations}
                        onClick={() => openNewCompanyConversation(company.id, company.name)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 xl:h-7 xl:w-7"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                      </button>
                    </div>
                    {sessionsExpanded && <div id={sessionsRegionId} className="mt-0.5 flex min-w-0 flex-col gap-0.5">
                      {company.conversations.map((c) => (
                        <div key={c.id} className="relative group/conv">
                          {renamingId === c.id ? (
                            <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                              <input
                                autoFocus
                                value={renameValue}
                                aria-label="Rename conversation"
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') renameConversation(c.id, renameValue)
                                  if (e.key === 'Escape') {
                                    renameCancelledRef.current = true
                                    setRenamingId(null)
                                  }
                                }}
                                onBlur={() => {
                                  if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                                  renameCancelledRef.current = false
                                }}
                                className="h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-[var(--color-pib-text)] outline-none xl:h-8"
                              />
                            </div>
                          ) : (
                            <ConversationListItem
                              conversation={c}
                              active={c.id === activeId}
                              onClick={() => {
                                setActiveId(c.id)
                                closeSessions()
                              }}
                              currentUserUid={currentUserUid}
                              density="compact"
                              pinned={pinnedConversationIdSet.has(c.id)}
                            />
                          )}
                          {renamingId !== c.id && (
                            <button
                              type="button"
                              data-conv-menu
                              onClick={(e) => {
                                e.stopPropagation()
                                openConversationRowMenu(c.id, e.currentTarget)
                              }}
                              className={`absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-[11px] text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:right-1 xl:hidden xl:h-5 xl:w-5 xl:group-hover/conv:flex xl:focus-visible:flex ${menuOpenId === c.id ? '!flex' : ''}`}
                              aria-label={`Conversation options for ${c.title || 'Untitled'}`}
                            >
                              ⋯
                            </button>
                          )}
                        </div>
                      ))}
                    </div>}
                  </div>
                  )
                })}
              </div>
            </div>
          )}
          {hermesLayout && hermesProjectGroups.length > 0 && (
            <div data-testid="hermes-projects" className="min-w-0">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
                <span>Projects</span>
                <span className="font-mono text-[10px] tracking-normal text-[var(--color-pib-text-muted)]/55">{hermesProjectGroups.length}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                {hermesProjectGroups.map((project) => {
                  const groupKey = `project:${project.id}`
                  const sessionsExpanded = Boolean(conversationFilter.trim()) || expandedSessionGroupKeys.includes(groupKey)
                  const sessionsRegionId = `project-sessions-${project.id}`
                  return (
                    <div
                      key={project.id}
                      data-testid={`hermes-project-${project.id}`}
                      data-folder-accent={`project:${project.id}`}
                      style={folderAccentStyle(`project:${project.id}`)}
                      className="group/project mx-folder-accent relative min-w-0 overflow-visible rounded-md border border-white/[0.06] bg-white/[0.025] py-0.5 pl-1.5 pr-0.5"
                    >
                    <div className="flex min-w-0 items-center gap-0.5 px-0.5">
                      <button
                        type="button"
                        aria-expanded={sessionsExpanded}
                        aria-controls={sessionsRegionId}
                        aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} sessions for ${project.name}`}
                        onClick={() => toggleSessionGroup(groupKey)}
                        className="flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0"
                      >
                        <span className="material-symbols-outlined shrink-0 text-[14px] text-primary" aria-hidden="true">folder_managed</span>
                        <HoverTip label={project.name} side="right" className="min-w-0 flex-1">
                          <span className="block min-w-0 truncate text-[11px] font-semibold leading-4 text-[var(--color-pib-text)]">{project.name}</span>
                        </HoverTip>
                        <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]/70">{project.conversations.length}</span>
                        <span className="material-symbols-outlined shrink-0 text-[14px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                          {sessionsExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Start session for ${project.name}`}
                        title={`Start session for ${project.name}`}
                        disabled={!allowStartConversations}
                        onClick={() => openNewConversation(project.id)}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 xl:h-7 xl:w-7"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                      </button>
                      <div className="relative shrink-0" data-project-actions>
                        <button
                          type="button"
                          aria-label={`More actions for ${project.name}`}
                          title={`More actions for ${project.name}`}
                          aria-expanded={projectActionsOpenId === project.id}
                          aria-haspopup="menu"
                          aria-controls={`project-actions-${project.id}`}
                          onClick={() => setProjectActionsOpenId((current) => current === project.id ? null : project.id)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-7 xl:w-7 ${projectActionsOpenId === project.id ? 'bg-white/[0.08] text-primary' : 'text-[var(--color-pib-text-muted)]'}`}
                        >
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">more_horiz</span>
                        </button>
                        {projectActionsOpenId === project.id && (
                          <div
                            id={`project-actions-${project.id}`}
                            role="menu"
                            aria-label={`Actions for ${project.name}`}
                            className="absolute right-0 top-full z-40 mt-1 min-w-[13.5rem] overflow-hidden rounded-lg border border-white/[0.1] bg-[var(--color-pib-surface,rgba(18,18,24,0.98))] py-1 shadow-xl shadow-black/40"
                          >
                            <button
                              type="button"
                              aria-label={`Manage locations for ${project.name}`}
                              onClick={() => {
                                setProjectActionsOpenId(null)
                                if (managedProject?.id === project.id) setManagedProject(null)
                                else openProjectLocationManager({ id: project.id, name: project.name })
                              }}
                              className={`flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:outline-none ${managedProject?.id === project.id ? 'bg-white/[0.06] text-primary' : 'text-[var(--color-pib-text)]'}`}
                            >
                              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" aria-hidden="true">devices</span>
                              <span className="min-w-0">
                                <span className="block font-medium leading-4">Locations</span>
                                <span className="mt-0.5 block text-[10px] leading-3.5 text-[var(--color-pib-text-muted)]">
                                  Link computers &amp; VPS for this project
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Link client organisation to ${project.name}`}
                              onClick={() => {
                                setProjectActionsOpenId(null)
                                setAccessProject({ id: project.id, name: project.name })
                              }}
                              className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:outline-none"
                            >
                              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" aria-hidden="true">group_add</span>
                              <span className="min-w-0">
                                <span className="block font-medium leading-4">Access</span>
                                <span className="mt-0.5 block text-[10px] leading-3.5 text-[var(--color-pib-text-muted)]">
                                  Link client org or team access
                                </span>
                              </span>
                            </button>
                            <div className="my-1 border-t border-white/[0.06]" role="separator" />
                            <button
                              type="button"
                              aria-label={`Remove ${project.name} from my projects`}
                              onClick={() => {
                                setProjectActionsOpenId(null)
                                void removeProjectFromSidebar(project.id)
                              }}
                              className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-red-200 hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none"
                            >
                              <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px]" aria-hidden="true">folder_off</span>
                              <span className="min-w-0">
                                <span className="block font-medium leading-4">Remove from sidebar</span>
                                <span className="mt-0.5 block text-[10px] leading-3.5 text-red-200/70">
                                  {project.conversations.length === 0
                                    ? 'Hide this empty project folder. You can add it again later.'
                                    : 'Unlink from your list. Sessions stay; re-add anytime.'}
                                </span>
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {(sessionsExpanded && (project.locations?.length ?? 0) > 0) && (
                      <div data-testid={`project-location-badges-${project.id}`} className="flex min-w-0 flex-wrap gap-1 px-1 pb-1">
                        {project.locations?.map((location) => {
                          const machineType = location.kind === 'vps' ? 'VPS' : 'Computer'
                          const runtimeStatus = !location.authenticatedRuntime
                            ? 'Pairing required'
                            : location.availability === 'online' ? 'online' : 'Computer unavailable'
                          const runtimeReady = location.authenticatedRuntime && location.availability === 'online'
                          return (
                            <span
                              key={location.locationId}
                              data-testid={`project-location-badge-${project.id}-${location.locationId}`}
                              aria-label={`${machineType} ${location.label}: ${runtimeStatus}`}
                              className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-xs ${runtimeReady
                                ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                                : 'border-amber-400/20 bg-amber-500/10 text-amber-100'}`}
                            >
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${runtimeReady ? 'bg-emerald-300' : 'bg-amber-300'}`} aria-hidden="true" />
                              <HoverTip label={`${machineType} · ${location.label} · ${runtimeStatus}`} side="top" className="min-w-0 max-w-full">
                                <span className="block min-w-0 truncate">
                                  {machineType} · {location.label} · {runtimeStatus}
                                </span>
                              </HoverTip>
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {managedProject?.id === project.id && (
                      <section
                        role="region"
                        aria-label={`Manage locations for ${project.name}`}
                        className="mx-1 mb-1 space-y-2 rounded-md border border-primary/20 bg-black/10 p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-text-muted)]">Project locations</span>
                          <button
                            type="button"
                            aria-label={`Close location manager for ${project.name}`}
                            onClick={() => setManagedProject(null)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8 xl:w-8"
                          >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                          </button>
                        </div>

                        {projectLocationsLoading ? (
                          <div className="py-1 text-xs text-[var(--color-pib-text-muted)]">Loading locations…</div>
                        ) : (
                          <>
                            {managedProjectLocations.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-xs font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]/70">Linked</div>
                                {managedProjectLocations.map((location) => {
                                  const statusLabel = !location.authenticatedRuntime
                                    ? 'Pairing required'
                                    : location.availability === 'online' ? 'online' : 'Computer unavailable'
                                  const fullLabel = `${location.label} · ${statusLabel}`
                                  return (
                                  <div key={location.replicaId} className="flex min-w-0 flex-wrap items-center gap-1 rounded border border-white/[0.06] px-2 py-2 text-xs">
                                    <HoverTip label={fullLabel} side="right" className="min-w-0 flex-1">
                                      <span className="block min-w-0 truncate text-[var(--color-pib-text)]">
                                        {fullLabel}
                                      </span>
                                    </HoverTip>
                                    {!location.authenticatedRuntime && (
                                      <span className="rounded bg-amber-500/10 px-1.5 py-1 text-xs text-amber-100">Legacy · pairing required</span>
                                    )}
                                    {location.visibility === 'private' && (
                                      <span className="rounded bg-white/[0.06] px-1.5 py-1 text-xs text-[var(--color-pib-text-muted)]">Private</span>
                                    )}
                                    <button
                                      type="button"
                                      aria-label={`Unlink ${location.label}`}
                                      disabled={projectLocationsMutating}
                                      onClick={() => void handleUnlinkManagedProjectLocation(location)}
                                      className="min-h-11 rounded px-2 py-1 text-xs text-red-200 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-300/60 disabled:opacity-40 xl:min-h-8"
                                    >
                                      Unlink
                                    </button>
                                  </div>
                                  )
                                })}
                              </div>
                            )}

                            <div className="space-y-1">
                              <div className="text-xs font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]/70">Available to link</div>
                              {projectLocationManagementCandidates.length === 0 ? (
                                <p className="rounded border border-amber-400/15 bg-amber-500/[0.08] px-2 py-2 text-xs leading-5 text-amber-100">
                                  A device must first be shared with and mapped to this organisation before it can be linked to the project.
                                </p>
                              ) : managedUnlinkedLocationCandidates.length === 0 ? (
                                <p className="text-xs text-[var(--color-pib-text-muted)]">Every available location is already linked.</p>
                              ) : (
                                managedUnlinkedLocationCandidates.map((candidate) => {
                                  // Keep status casing stable for a11y tests + screen readers.
                                  const statusLabel = candidate.selectable ? 'online' : 'Computer unavailable'
                                  const fullLabel = `${candidate.label} · ${statusLabel}`
                                  return (
                                  <label key={candidate.key} className="flex min-h-11 min-w-0 items-center gap-2 rounded border border-white/[0.06] px-2 py-2 text-xs text-[var(--color-pib-text)] xl:min-h-0">
                                    <input
                                      type="checkbox"
                                      aria-label={fullLabel}
                                      checked={selectedManagedProjectLocationKeys.includes(candidate.key)}
                                      disabled={!candidate.selectable || projectLocationsMutating}
                                      onChange={(event) => setSelectedManagedProjectLocationKeys((current) => event.target.checked
                                        ? [...current, candidate.key]
                                        : current.filter((key) => key !== candidate.key))}
                                    />
                                    <HoverTip label={fullLabel} side="right" className="min-w-0 flex-1">
                                      <span className="block min-w-0 truncate">{candidate.label}</span>
                                    </HoverTip>
                                    <span className={candidate.selectable ? 'text-emerald-200' : 'text-amber-100'}>
                                      {candidate.selectable ? 'Online' : 'Computer unavailable'}
                                    </span>
                                  </label>
                                  )
                                })
                              )}
                            </div>

                            <div className="space-y-1 rounded border border-primary/15 bg-primary/[0.04] p-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]/70">Keep synced</span>
                                <span className="text-xs text-[var(--color-pib-text-muted)]">
                                  Current status: {projectSyncLoading && managedProjectSync?.projectId !== project.id
                                    ? 'Loading…'
                                    : projectSyncStatusLabel(managedProjectSync?.projectId === project.id ? managedProjectSync.status : null)}
                                </span>
                              </div>
                              <p className={`text-xs leading-5 ${managedProjectSyncEligible ? 'text-[var(--color-pib-text-muted)]' : 'text-amber-100'}`}>
                                {managedProjectHasLegacyLocations
                                  ? 'Pair every legacy location with an authenticated runtime before enabling sync.'
                                  : managedProjectSyncEligible
                                    ? 'Keep this project synced continuously across its linked locations.'
                                    : 'Link at least two locations, including an organisation VPS, to keep this project synced.'}
                              </p>
                              {managedProjectSync?.projectId === project.id && managedProjectSync.blocker && !managedProjectSync.notice && (
                                <p className="rounded border border-amber-400/15 bg-amber-500/[0.08] px-2 py-2 text-xs leading-5 text-amber-100">
                                  File transfer is {projectSyncBlockerMessage(managedProjectSync.blocker)}
                                </p>
                              )}
                              {managedProjectSync?.projectId === project.id
                                && ['conflict', 'failed'].includes(managedProjectSync.status ?? '') && (
                                <p className="rounded border border-amber-400/20 bg-amber-500/10 px-2 py-2 text-xs leading-5 text-amber-100">
                                  {projectSyncConflictMessage(managedProjectSync.conflictKind)} Both versions were preserved. Reconcile the files on the linked machines before resetting and re-inventorying.
                                </p>
                              )}
                              {managedProjectSync?.projectId === project.id && managedProjectSync.notice && (
                                <p
                                  role={managedProjectSync.noticeTone === 'error' ? 'alert' : 'status'}
                                  className={`rounded border px-2 py-2 text-xs leading-5 ${managedProjectSync.noticeTone === 'error'
                                    ? 'border-red-400/20 bg-red-500/10 text-red-200'
                                    : managedProjectSync.noticeTone === 'success'
                                      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                                      : managedProjectSync.noticeTone === 'blocker'
                                        ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
                                        : 'border-white/[0.08] bg-white/[0.04] text-[var(--color-pib-text-muted)]'}`}
                                >
                                  {managedProjectSync.notice}
                                </p>
                              )}
                              <button
                                type="button"
                                onClick={() => void requestManagedProjectSync({ id: project.id, name: project.name }, managedProjectLocations)}
                                disabled={projectLocationsMutating || projectSyncLoading || projectSyncSubmitting || projectSyncResetting || !managedProjectSyncEligible}
                                className="min-h-11 w-full rounded border border-primary/30 bg-primary/10 px-2 py-2 text-xs font-medium text-primary hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 xl:min-h-9"
                              >
                                {projectSyncSubmitting ? 'Syncing…' : 'Sync now'}
                              </button>
                              {managedProjectSync?.projectId === project.id
                                && ['conflict', 'failed'].includes(managedProjectSync.status ?? '') && (
                                <button
                                  type="button"
                                  onClick={() => void resetManagedProjectSync({ id: project.id, name: project.name })}
                                  disabled={projectLocationsMutating || projectSyncLoading || projectSyncSubmitting || projectSyncResetting}
                                  className="min-h-11 w-full rounded border border-amber-400/30 bg-amber-500/10 px-2 py-2 text-xs font-medium text-amber-100 hover:bg-amber-500/15 focus-visible:ring-2 focus-visible:ring-amber-300/60 disabled:cursor-not-allowed disabled:opacity-40 xl:min-h-9"
                                >
                                  {projectSyncResetting ? 'Resetting…' : 'Reset sync safely'}
                                </button>
                              )}
                            </div>

                            {projectLocationsError && (
                              <p role="alert" className="rounded border border-red-400/20 bg-red-500/10 px-2 py-2 text-xs text-red-200">{projectLocationsError}</p>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleLinkManagedProjectLocations()}
                              disabled={projectLocationsMutating || !managedUnlinkedLocationCandidates.some((candidate) =>
                                candidate.selectable && selectedManagedProjectLocationKeys.includes(candidate.key))}
                              className="min-h-11 w-full rounded bg-primary px-2 py-2 text-xs font-medium text-on-primary hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40 xl:min-h-9"
                            >
                              {projectLocationsMutating ? 'Updating…' : 'Link selected locations'}
                            </button>
                          </>
                        )}
                      </section>
                    )}
                    {sessionsExpanded && (project.conversations.length === 0 ? (
                      <div id={sessionsRegionId} className="px-6 py-1 text-xs text-[var(--color-pib-text-muted)]/70">No sessions yet</div>
                    ) : (
                      <div id={sessionsRegionId} className="mt-0.5 flex min-w-0 flex-col gap-0.5">
                        {project.conversations.map((c) => (
                          <div key={c.id} className="relative group/conv">
                            {renamingId === c.id ? (
                              <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                                <input
                                  autoFocus
                                  value={renameValue}
                                  aria-label="Rename conversation"
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') renameConversation(c.id, renameValue)
                                    if (e.key === 'Escape') {
                                      renameCancelledRef.current = true
                                      setRenamingId(null)
                                    }
                                  }}
                                  onBlur={() => {
                                    if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                                    renameCancelledRef.current = false
                                  }}
                                  className="h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-[var(--color-pib-text)] outline-none xl:h-8"
                                />
                              </div>
                            ) : (
                              <ConversationListItem
                                conversation={c}
                                active={c.id === activeId}
                                onClick={() => {
                                  setActiveId(c.id)
                                  closeSessions()
                                }}
                                currentUserUid={currentUserUid}
                                density="compact"
                                pinned={pinnedConversationIdSet.has(c.id)}
                              />
                            )}
                            {renamingId !== c.id && (
                              <button
                                type="button"
                                data-conv-menu
                                onClick={(e) => {
                                e.stopPropagation()
                                openConversationRowMenu(c.id, e.currentTarget)
                              }}
                                className={`absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-[11px] text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:right-1 xl:hidden xl:h-5 xl:w-5 xl:group-hover/conv:flex xl:focus-visible:flex ${menuOpenId === c.id ? '!flex' : ''}`}
                                aria-label={`Conversation options for ${c.title || 'Untitled'}`}
                              >
                                ⋯
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  )
                })}
              </div>
            </div>
          )}
          {hermesLayout && hermesWorkspaceGroups.length > 0 && (
            <div data-testid="hermes-workspaces" className="min-w-0">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
                <span>Workspaces</span>
                <span className="font-mono text-[10px] tracking-normal text-[var(--color-pib-text-muted)]/55">{hermesWorkspaceGroups.length}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                {hermesWorkspaceGroups.map((workspace) => {
                  const groupKey = `workspace:${workspace.id}`
                  const sessionsExpanded = Boolean(conversationFilter.trim()) || expandedSessionGroupKeys.includes(groupKey)
                  const sessionsRegionId = `workspace-sessions-${workspace.id}`
                  return (
                    <div
                      key={workspace.id}
                      data-testid={`hermes-workspace-${workspace.id}`}
                      data-folder-accent={`workspace:${workspace.id}`}
                      style={folderAccentStyle(`workspace:${workspace.id}`)}
                      className="mx-folder-accent min-w-0 overflow-visible rounded-md border border-white/[0.06] bg-white/[0.025] py-0.5 pl-1.5 pr-0.5"
                    >
                      <div className="flex min-w-0 items-center gap-0.5 px-0.5">
                        <button
                          type="button"
                          aria-expanded={sessionsExpanded}
                          aria-controls={sessionsRegionId}
                          aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} sessions for ${workspace.name}`}
                          onClick={() => toggleSessionGroup(groupKey)}
                          className="flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0"
                        >
                          <span className="material-symbols-outlined shrink-0 text-[14px] text-primary" aria-hidden="true">work</span>
                          <HoverTip label={workspace.name} side="right" className="min-w-0 flex-1">
                            <span className="block min-w-0 truncate text-[11px] font-semibold leading-4 text-[var(--color-pib-text)]">{workspace.name}</span>
                          </HoverTip>
                          <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]/70">{workspace.conversations.length}</span>
                          <span className="material-symbols-outlined shrink-0 text-[14px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                            {sessionsExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Start session in ${workspace.name}`}
                          disabled={!allowStartConversations}
                          onClick={() => openNewWorkspaceConversation(workspace.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 xl:h-6 xl:w-6"
                        >
                          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">add</span>
                        </button>
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            aria-label={`More actions for ${workspace.name}`}
                            aria-expanded={folderActionsOpenKey === groupKey}
                            onClick={() => setFolderActionsOpenKey((current) => current === groupKey ? null : groupKey)}
                            className="flex h-8 w-8 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-6 xl:w-6"
                          >
                            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">more_horiz</span>
                          </button>
                          {folderActionsOpenKey === groupKey && (
                            <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-md border border-white/[0.1] bg-[var(--color-card)] p-1 shadow-xl">
                              <button
                                type="button"
                                aria-label={`Remove ${workspace.name} from sidebar`}
                                disabled={hiddenFolderPreferencesSaving}
                                onClick={() => hideFolderFromSidebar(groupKey)}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--color-pib-text)] hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">visibility_off</span>
                                Remove from sidebar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {sessionsExpanded && (
                        <div id={sessionsRegionId} className="mt-0.5 flex min-w-0 flex-col gap-0.5">
                          {workspace.conversations.length === 0 ? (
                            <p className="px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]">No sessions yet</p>
                          ) : workspace.conversations.map((c) => (
                            <div key={c.id} className="relative group/conv">
                              {renamingId === c.id ? (
                                <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                                  <input
                                    autoFocus
                                    value={renameValue}
                                    aria-label="Rename conversation"
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') renameConversation(c.id, renameValue)
                                      if (e.key === 'Escape') {
                                        renameCancelledRef.current = true
                                        setRenamingId(null)
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                                      renameCancelledRef.current = false
                                    }}
                                    className="h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-[var(--color-pib-text)] outline-none xl:h-8"
                                  />
                                </div>
                              ) : (
                                <ConversationListItem
                                  conversation={c}
                                  active={c.id === activeId}
                                  onClick={() => {
                                    setActiveId(c.id)
                                    closeSessions()
                                  }}
                                  currentUserUid={currentUserUid}
                                  density="compact"
                                  pinned={pinnedConversationIdSet.has(c.id)}
                                />
                              )}
                              {renamingId !== c.id && (
                                <button
                                  type="button"
                                  data-conv-menu
                                  onClick={(e) => {
                                e.stopPropagation()
                                openConversationRowMenu(c.id, e.currentTarget)
                              }}
                                  className={`absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-[11px] text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:right-1 xl:hidden xl:h-5 xl:w-5 xl:group-hover/conv:flex xl:focus-visible:flex ${menuOpenId === c.id ? '!flex' : ''}`}
                                  aria-label={`Conversation options for ${c.title || 'Untitled'}`}
                                >
                                  ⋯
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {hermesLayout && hermesAgentGroups.length > 0 && (
            <div data-testid="hermes-agents" className="min-w-0">
              <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
                <span>Agents</span>
                <span className="font-mono text-[10px] tracking-normal text-[var(--color-pib-text-muted)]/55">{hermesAgentGroups.length}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                {hermesAgentGroups.map((agent) => {
                  const groupKey = `agent:${agent.id}`
                  const agentIsAuthorized = Boolean(agentMap[agent.id])
                  const sessionsExpanded = Boolean(conversationFilter.trim()) || expandedSessionGroupKeys.includes(groupKey)
                  const sessionsRegionId = `agent-sessions-${agent.id}`
                  return (
                    <div
                      key={agent.id}
                      data-testid={`hermes-agent-${agent.id}`}
                      data-folder-accent={`agent:${agent.id}`}
                      style={folderAccentStyle(`agent:${agent.id}`)}
                      className="mx-folder-accent min-w-0 overflow-visible rounded-md border border-white/[0.06] bg-white/[0.025] py-0.5 pl-1.5 pr-0.5"
                    >
                      <div className="flex min-w-0 items-center gap-0.5 px-0.5">
                        <button
                          type="button"
                          aria-expanded={sessionsExpanded}
                          aria-controls={sessionsRegionId}
                          aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} sessions for ${agent.name}`}
                          onClick={() => toggleSessionGroup(groupKey)}
                          className="flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0"
                        >
                          <span className="material-symbols-outlined shrink-0 text-[14px] text-primary" aria-hidden="true">smart_toy</span>
                          <HoverTip label={agent.name} side="right" className="min-w-0 flex-1">
                            <span className="block min-w-0 truncate text-[11px] font-semibold leading-4 text-[var(--color-pib-text)]">{agent.name}</span>
                          </HoverTip>
                          <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]/70">{agent.conversations.length}</span>
                          <span className="material-symbols-outlined shrink-0 text-[14px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                            {sessionsExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                        </button>
                        {agentIsAuthorized && <button
                          type="button"
                          aria-label={`Start direct session with ${agent.name}`}
                          disabled={!allowStartConversations}
                          onClick={() => openNewAgentConversation(agent.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 xl:h-6 xl:w-6"
                        >
                          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">add</span>
                        </button>}
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            aria-label={`More actions for ${agent.name}`}
                            aria-expanded={folderActionsOpenKey === groupKey}
                            onClick={() => setFolderActionsOpenKey((current) => current === groupKey ? null : groupKey)}
                            className="flex h-8 w-8 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-6 xl:w-6"
                          >
                            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">more_horiz</span>
                          </button>
                          {folderActionsOpenKey === groupKey && (
                            <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-md border border-white/[0.1] bg-[var(--color-card)] p-1 shadow-xl">
                              <button
                                type="button"
                                aria-label={`Remove ${agent.name} from sidebar`}
                                disabled={hiddenFolderPreferencesSaving}
                                onClick={() => hideFolderFromSidebar(groupKey)}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--color-pib-text)] hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">visibility_off</span>
                                Remove from sidebar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {sessionsExpanded && (
                        <div id={sessionsRegionId} className="mt-0.5 flex min-w-0 flex-col gap-0.5">
                          {agent.conversations.map((c) => (
                            <div key={c.id} className="relative group/conv">
                              {renamingId === c.id ? (
                                <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                                  <input
                                    autoFocus
                                    value={renameValue}
                                    aria-label="Rename conversation"
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') renameConversation(c.id, renameValue)
                                      if (e.key === 'Escape') {
                                        renameCancelledRef.current = true
                                        setRenamingId(null)
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                                      renameCancelledRef.current = false
                                    }}
                                    className="h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-[var(--color-pib-text)] outline-none xl:h-8"
                                  />
                                </div>
                              ) : (
                                <ConversationListItem
                                  conversation={c}
                                  active={c.id === activeId}
                                  onClick={() => {
                                    setActiveId(c.id)
                                    closeSessions()
                                  }}
                                  currentUserUid={currentUserUid}
                                  density="compact"
                                  pinned={pinnedConversationIdSet.has(c.id)}
                                />
                              )}
                              {renamingId !== c.id && (
                                <button
                                  type="button"
                                  data-conv-menu
                                  onClick={(e) => {
                                e.stopPropagation()
                                openConversationRowMenu(c.id, e.currentTarget)
                              }}
                                  className={`absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-[11px] text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:right-1 xl:hidden xl:h-5 xl:w-5 xl:group-hover/conv:flex xl:focus-visible:flex ${menuOpenId === c.id ? '!flex' : ''}`}
                                  aria-label={`Conversation options for ${c.title || 'Untitled'}`}
                                >
                                  ⋯
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {hermesLayout
            ? hermesSessionSections.map((section) => (
              <div key={section.id} data-testid={`hermes-session-section-${section.id}`} className="min-w-0">
                <div className="mb-1 flex items-center justify-between px-1 text-xs font-label uppercase tracking-[0.22em] text-[var(--color-pib-text-muted)]/75">
                  <span>{section.label}</span>
                  <span className="font-mono text-xs tracking-normal text-[var(--color-pib-text-muted)]/55">{section.conversations.length}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  {section.conversations.map((c) => (
                    <div key={c.id} className="relative group/conv">
                      {renamingId === c.id ? (
                        <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                          <input
                            autoFocus
                            value={renameValue}
                            aria-label="Rename conversation"
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') renameConversation(c.id, renameValue)
                              if (e.key === 'Escape') {
                                renameCancelledRef.current = true
                                setRenamingId(null)
                              }
                            }}
                            onBlur={() => {
                              if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                              renameCancelledRef.current = false
                            }}
                            className="h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-[var(--color-pib-text)] outline-none xl:h-8"
                          />
                        </div>
                      ) : (
                        <ConversationListItem
                          conversation={c}
                          active={c.id === activeId}
                          onClick={() => {
                            setActiveId(c.id)
                            closeSessions()
                          }}
                          currentUserUid={currentUserUid}
                          density="compact"
                          pinned={pinnedConversationIdSet.has(c.id)}
                        />
                      )}

                      {/* ⋯ hover menu button */}
                      {renamingId !== c.id && (
                        <button
                          type="button"
                          data-conv-menu
                          onClick={(e) => {
                                e.stopPropagation()
                                openConversationRowMenu(c.id, e.currentTarget)
                              }}
                          className={`absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-[11px] text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:right-1 xl:hidden xl:h-5 xl:w-5 xl:group-hover/conv:flex xl:focus-visible:flex ${
                            menuOpenId === c.id ? '!flex' : ''
                          }`}
                          aria-label={`Conversation options for ${c.title || 'Untitled'}`}
                        >
                          ⋯
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
            : filteredConversations.map((c) => (
              <div key={c.id} className="relative group/conv">
                {renamingId === c.id ? (
                  <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                    <input
                      autoFocus
                      value={renameValue}
                      aria-label="Rename conversation"
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameConversation(c.id, renameValue)
                        if (e.key === 'Escape') {
                          renameCancelledRef.current = true
                          setRenamingId(null)
                        }
                      }}
                      onBlur={() => {
                        if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                        renameCancelledRef.current = false
                      }}
                      className="h-11 min-w-0 flex-1 border-b border-primary bg-transparent text-sm text-[var(--color-pib-text)] outline-none xl:h-8"
                    />
                  </div>
                ) : (
                  <ConversationListItem
                    conversation={c}
                    active={c.id === activeId}
                    onClick={() => {
                      setActiveId(c.id)
                      closeSessions()
                    }}
                    currentUserUid={currentUserUid}
                    density="comfortable"
                  />
                )}

                {/* ⋯ hover menu button */}
                {renamingId !== c.id && (
                  <button
                    type="button"
                    data-conv-menu
                    onClick={(e) => {
                                e.stopPropagation()
                                openConversationRowMenu(c.id, e.currentTarget)
                              }}
                    className={`absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded text-[var(--color-pib-text-muted)] outline-none hover:bg-[var(--color-card-hover,rgba(255,255,255,0.08))] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:right-1 xl:hidden xl:h-6 xl:w-6 xl:group-hover/conv:flex xl:focus-visible:flex ${
                      menuOpenId === c.id ? '!flex' : ''
                    }`}
                    aria-label="Conversation options"
                  >
                    ⋯
                  </button>
                )}
              </div>
            ))}
        </div>
        </div>
      </aside>}

      {/* Context menu — fixed, flips above near the bottom of the screen */}
      {menuOpenId && menuPosition && (
        <div
          data-conv-menu
          data-placement={menuPosition.placement}
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
          className="z-50 max-h-[min(22rem,calc(100vh-1rem))] min-w-[176px] overflow-y-auto rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl"
        >
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
            onClick={() => openConversationInNewWindow(menuOpenId)}
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            Open in new window
          </button>
          <button
            type="button"
            disabled={exportingChat}
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] disabled:opacity-50 xl:min-h-0"
            onClick={() => { void exportConversation(menuOpenId) }}
          >
            <span className="material-symbols-outlined text-[14px]">download</span>
            {exportingChat ? 'Exporting…' : 'Export chat'}
          </button>
          {hermesLayout && menuConversation && (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
              onClick={() => {
                togglePinnedConversation(menuConversation.id)
                setMenuOpenId(null)
                setMenuPosition(null)
              }}
            >
              <span className="material-symbols-outlined text-[14px]">
                {pinnedConversationIdSet.has(menuConversation.id) ? 'keep_off' : 'keep'}
              </span>
              {pinnedConversationIdSet.has(menuConversation.id) ? 'Unpin session' : 'Pin session'}
            </button>
          )}
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
            onClick={() => {
              const conv = conversations.find((c) => c.id === menuOpenId)
              setMenuOpenId(null)
              setMenuPosition(null)
              if (conv) {
                setRenamingId(conv.id)
                setRenameValue(conv.title || '')
              }
            }}
          >
            <span className="material-symbols-outlined text-[14px]">edit</span>
            Rename
          </button>
          {menuConversation && (allowManageConversationAccess || (menuConversation.workspaceContext?.ownerUserId ?? menuConversation.startedBy) === currentUserUid) && (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
              onClick={() => {
                setAccessConversation(menuConversation)
                setMenuOpenId(null)
                setMenuPosition(null)
              }}
            >
              <span className="material-symbols-outlined text-[14px]">manage_accounts</span>
              {menuConversation.workspaceContext ? 'Manage access' : 'Manage people'}
            </button>
          )}
          {allowArchiveConversations && (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
              onClick={() => archiveConversation(menuOpenId)}
            >
              <span className="material-symbols-outlined text-[14px]">archive</span>
              Archive
            </button>
          )}
          {allowDeleteConversations && (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-300 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
              onClick={() => deleteConversation(menuOpenId)}
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              Delete
            </button>
          )}
        </div>
      )}

      {/* ── Right: active conversation ──────────────────────────────────── */}
      <section
        className={[
          hermesLayout
            ? 'relative flex-col overflow-hidden min-h-0 min-w-0 flex-1 rounded-xl border border-[var(--color-card-border)] bg-black/[0.06]'
            : 'pib-card relative flex-col overflow-hidden min-h-0 min-w-0 flex-1',
          compact || !showConversationList ? '!p-0 !rounded-none !border-0 !bg-transparent' : 'xl:flex max-xl:!p-0 max-xl:!rounded-none max-xl:!border-0 max-xl:!bg-transparent',
          showConversationList && showListOnMobile && !tabletSessionsDrawer ? 'hidden' : 'flex',
        ].join(' ')}
      >
        {/* Header — mobile style (back / title+subtitle / ⋯) on small,
            keeps original sticky look on desktop */}
        <div className="shrink-0 min-w-0 border-b border-[var(--color-card-border)] px-3 py-2 lg:px-4 lg:py-2">
          <div className="flex items-center gap-2">
            {/* Back arrow — mobile only */}
            <button
              ref={mobileSessionsTriggerRef}
              type="button"
              onClick={() => setMobilePane('list')}
              aria-label="Open Sessions"
              className={[
                '-ml-1 h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.06] active:bg-white/[0.1]',
                compact ? 'flex' : 'flex xl:hidden',
              ].join(' ')}
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back_ios_new</span>
            </button>

            {/* Title + participants on one row (desktop); subtitle stacks on mobile only */}
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div className="min-w-0 shrink">
                {activeConversation && renamingId === activeConversation.id ? (
                  <input
                    autoFocus
                    data-testid="conversation-title-rename-input"
                    aria-label="Rename conversation"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void renameConversation(activeConversation.id, renameValue)
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        renameCancelledRef.current = true
                        setRenamingId(null)
                      }
                    }}
                    onBlur={() => {
                      if (!renameCancelledRef.current) void renameConversation(activeConversation.id, renameValue)
                      renameCancelledRef.current = false
                    }}
                    className="h-8 w-full min-w-0 max-w-md border-b border-primary bg-transparent text-[15px] font-medium text-[var(--color-pib-text)] outline-none lg:text-sm"
                  />
                ) : (
                  <button
                    type="button"
                    data-testid="conversation-title"
                    title={activeConversation ? 'Double-click to rename' : undefined}
                    disabled={!activeConversation}
                    onDoubleClick={() => {
                      if (!activeConversation) return
                      setRenamingId(activeConversation.id)
                      setRenameValue(activeConversation.title || '')
                    }}
                    className="block max-w-full truncate text-left text-[15px] font-medium text-[var(--color-pib-text)] disabled:cursor-default lg:text-sm"
                  >
                    {activeConversation?.title || 'New conversation'}
                  </button>
                )}
                {activeConversation?.scope === 'project' && activeConversation.scopeRefId && (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px]">
                    {isCommandSession ? (
                      <span
                        data-testid="command-session-badge"
                        className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-200"
                        title="Kanban task lifecycle events and blocked-task auto-wake feed into this chat"
                      >
                        <span className="material-symbols-outlined text-[12px]" aria-hidden="true">hub</span>
                        Command session
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid="bind-command-session"
                        disabled={commandSessionBusy}
                        onClick={() => { void bindCommandSession() }}
                        className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 font-semibold text-[var(--color-pib-text-muted)] hover:border-primary/40 hover:text-primary disabled:opacity-50"
                        title="Link this chat as the project command room for task updates and blocked-task wake"
                      >
                        <span className="material-symbols-outlined text-[12px]" aria-hidden="true">link</span>
                        {commandSessionBusy ? 'Linking…' : 'Use as command session'}
                      </button>
                    )}
                  </div>
                )}
                {(subtitle || activeConnectionWhere) && (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-pib-text-muted)] lg:hidden">
                    {subtitle && <span className="truncate">{subtitle}</span>}
                    {subtitle && activeConnectionWhere && <span aria-hidden="true">·</span>}
                    {activeConnectionWhere && (
                      <span
                        data-testid="connection-where-chip-mobile"
                        className="inline-flex min-w-0 items-center gap-1 truncate"
                        title={activeConnectionWhere.title}
                      >
                        <span
                          className={[
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            activeConnectionWhere.online === true
                              ? 'bg-emerald-400'
                              : activeConnectionWhere.online === false
                                ? 'bg-amber-400'
                                : 'bg-white/30',
                          ].join(' ')}
                        />
                        <span className="truncate">{activeConnectionWhere.display}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {activeConversation?.participants && activeConversation.participants.length > 0 && !compact && (
                <div className="hidden min-w-0 max-w-[55%] shrink lg:block">
                  <ParticipantBar
                    participants={activeConversation.participants}
                    agentDetails={agentMap}
                    className="justify-end"
                  />
                </div>
              )}
            </div>

            {activeConnectionWhere && (
              <div
                data-testid="connection-where-chip"
                className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-xs text-[var(--color-pib-text-muted)] lg:inline-flex"
                title={activeConnectionWhere.title}
                aria-label={`Connected via ${activeConnectionWhere.display}`}
              >
                <span
                  className={[
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    activeConnectionWhere.online === true
                      ? 'bg-emerald-400'
                      : activeConnectionWhere.online === false
                        ? 'bg-amber-400'
                        : 'bg-white/30',
                  ].join(' ')}
                />
                <span className="material-symbols-outlined text-[13px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                  {activeConnectionWhere.icon}
                </span>
                <span className="max-w-[14rem] truncate text-[var(--color-pib-text)]">
                  {activeConnectionWhere.display}
                </span>
              </div>
            )}

            {activeModelAgentId && !hermesLayout && (
              <div className="hidden min-w-0 shrink-0 lg:block">
                <ModelProviderPicker
                  catalog={modelCatalog}
                  selected={selectedRuntime}
                  loading={modelCatalogLoading}
                  disabled={!activeConversation}
                  compact
                  onSelect={setSelectedRuntime}
                  onRefresh={loadModelCatalog}
                />
              </div>
            )}

            {/* ⋯ menu — rename / export / archive */}
            {activeConversation && (
              <div className="relative shrink-0" data-header-menu>
                <button
                  type="button"
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  aria-label="Conversation options"
                  aria-expanded={headerMenuOpen}
                  className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/[0.06] active:bg-white/[0.1] text-[var(--color-pib-text-muted)] transition-colors"
                >
                  <span className="material-symbols-outlined text-[22px]">more_horiz</span>
                </button>
                {headerMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 min-w-[190px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                      onClick={() => openConversationInNewWindow(activeConversation.id)}
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      Open in new window
                    </button>
                    <button
                      type="button"
                      disabled={exportingChat}
                      className="w-full text-left px-3 py-2 text-sm text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] disabled:opacity-50 flex items-center gap-2"
                      onClick={() => { void exportConversation(activeConversation.id) }}
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      {exportingChat ? 'Exporting…' : 'Export chat'}
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                      onClick={() => {
                        setHeaderMenuOpen(false)
                        setRenamingId(activeConversation.id)
                        setRenameValue(activeConversation.title || '')
                        setMobilePane('list')
                      }}
                    >
                      <span className="material-symbols-outlined text-[16px]">edit</span>
                      Rename
                    </button>
                    {(allowManageConversationAccess || (activeConversation.workspaceContext?.ownerUserId ?? activeConversation.startedBy) === currentUserUid) && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                        onClick={() => {
                          setHeaderMenuOpen(false)
                          setAccessConversation(activeConversation)
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
                        {activeConversation.workspaceContext ? 'Manage access' : 'Manage people'}
                      </button>
                    )}
                    {allowArchiveConversations && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                        onClick={() => {
                          setHeaderMenuOpen(false)
                          archiveConversation(activeConversation.id)
                          setMobilePane('list')
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px]">archive</span>
                        Archive
                      </button>
                    )}
                    {allowDeleteConversations && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                        onClick={() => {
                          setHeaderMenuOpen(false)
                          deleteConversation(activeConversation.id)
                          setMobilePane('list')
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {activeConversation && <ChatContextExperience context={chatContexts} compact={compact} artifactRequest={contextArtifactRequest} focusRequest={contextFocusRequest} execution={runtimeExecution} executionRequest={executionDockRequest} closeRequest={contextCanvasCloseRequest} previewRefreshSignal={contextPreviewRefreshSignal} onActionResolved={handleContextActionResolved} onPresentationChange={handleContextCanvasPresentationChange} onAddContext={openContextPicker} contextPickerExpanded={Boolean(contextMention || contextTypePrompt)} contextPickerControls={contextPickerPanelId} onRemoveContext={(value) => {
          const ref = contextRefs.find((item) => item.type === value.kind && item.id === value.id)
          if (ref) removeContextRef(ref)
        }} />}
        {showAgentWorkbench && <AgentWorkbenchRail
          open={workbenchOpen}
          activeTab={workbenchTab}
          onOpenChange={handleWorkbenchOpenChange}
          onTabChange={(tab) => { if (tab) setWorkbenchTab(tab) }}
          width={workbenchWidth}
          onWidthChange={setWorkbenchWidth}
          runtime={workbenchRuntime}
          terminalEntries={workbenchTerminalEntries}
          fileTree={workbenchFileTree}
          liveFileTree={workbenchLiveFiles.tree}
          filesSource={workbenchLiveFiles.source === 'sync' ? 'sync' : workbenchFileTree.length > 0 ? 'events' : 'none'}
          filesLoading={workbenchFilesLoading}
          filesMessage={workbenchFilesMessage}
          onRefreshFiles={loadWorkbenchFiles}
          selectedFilePath={workbenchSelectedFilePath}
          onSelectFilePath={handleSelectWorkbenchFilePath}
          onExpandDirectory={(path) => { void loadWorkbenchDirectory(path) }}
          filePreview={workbenchFilePreview}
          onSaveFile={saveWorkbenchFile}
          changes={workbenchChanges}
          changesMessage={workbenchChangesMessage}
          changesLoading={workbenchChangesLoading}
          changesSource={workbenchLiveChanges !== null ? 'live' : workbenchEventChanges.length > 0 ? 'events' : 'none'}
          onRefreshChanges={loadWorkbenchChanges}
          browserTargets={workbenchBrowserTargets}
          onAddBrowserNoteToChat={addWorkbenchNoteToComposer}
          browserTunnel={workbenchTunnel}
          onStartBrowserTunnel={startWorkbenchTunnel}
          onApproveBrowserTunnel={approveWorkbenchTunnelSession}
          onKillBrowserTunnel={killWorkbenchTunnel}
          browserAgentSession={workbenchBrowserSession ? { ...workbenchBrowserSession, following: workbenchBrowserFollowing } : workbenchBrowserSession}
          onStartBrowserAgentSession={startWorkbenchBrowserSession}
          onApproveBrowserAgentSession={approveWorkbenchBrowserSession}
          onNavigateBrowserAgentSession={navigateWorkbenchBrowserSession}
          onCaptureBrowserAgentSession={captureWorkbenchBrowserSession}
          onKillBrowserAgentSession={killWorkbenchBrowserSession}
          onClickBrowserAgentSessionAt={clickWorkbenchBrowserSessionAt}
          onTypeBrowserAgentSession={typeInWorkbenchBrowserSession}
          onStartBrowserAgentSessionFollow={startWorkbenchBrowserSessionFollow}
          onStopBrowserAgentSessionFollow={stopWorkbenchBrowserSessionFollow}
          compact={compact}
          onRunTerminalCommand={runWorkbenchTerminalCommand}
          onClearTerminal={clearWorkbenchLocalTerminal}
          terminalRunning={workbenchTerminalRunning}
          localTerminalEntries={workbenchLocalTerminalEntries}
          terminalMode={workbenchTerminalMode}
          onTerminalModeChange={setWorkbenchTerminalMode}
          terminalSession={workbenchSession}
          terminalSessions={[...workbenchSessionHistory, ...(workbenchSession ? [workbenchSession] : [])]}
          onSelectTerminalSession={selectWorkbenchSession}
          onStartTerminalSession={startWorkbenchSession}
          onApproveTerminalSession={approveWorkbenchSession}
          onSendTerminalSessionInput={sendWorkbenchSessionInput}
          onSendTerminalSessionData={sendWorkbenchSessionData}
          onResizeTerminalSession={resizeWorkbenchSession}
          onKillTerminalSession={killWorkbenchSession}
        />}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          onScroll={handleMessagesScroll}
          style={contextCanvasReservedStyle}
          className={`flex-1 min-h-0 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden p-4 transition-[margin] duration-200 ${rightDockOpen ? 'lg:mr-[var(--context-canvas-width)]' : ''}`}
        >
          {loading && <div className="text-xs text-[var(--color-pib-text-muted)]">Loading…</div>}
          {!loading && messages.length === 0 && (
            <div className="text-sm text-[var(--color-pib-text-muted)] py-8 text-center">
              {activeConversation
                ? allowSendMessages ? 'No messages yet. Send one below.' : 'No messages yet.'
                : allowStartConversations ? 'Select or create a conversation to get started.' : 'Select a conversation to view messages.'}
            </div>
          )}

          {messages
            .slice()
            .sort((a, b) => tsSeconds(a.createdAt) - tsSeconds(b.createdAt))
            .map((m) => {
              // Look up agent info for this message author
              const agentDoc =
                m.authorKind === 'agent'
                  ? (agentMap[m.authorId as AgentId] ?? null)
                  : null

              const isPending =
                m.status === 'queued' ||
                m.status === 'pending' ||
                m.status === 'streaming' ||
                m.status === 'waiting_approval'

              return (
                <div key={m.id}>
                  <MessageBubble
                    message={m}
                    currentUserUid={currentUserUid}
                    agentColorKey={agentDoc?.colorKey}
                    agentIconKey={agentDoc?.iconKey}
                    liveEvents={isPending ? (liveEvents[m.id] ?? []) : []}
                    onStopRun={
                      canStopRuns && isPending && m.runId && activeId
                        ? () => stopAgentRun(activeId, m.id)
                        : undefined
                    }
                    onQuoteSelection={addSelectionToComposer}
                    onUiAction={handleUiAction}
                  />
                  {m.acceptedDevice && (
                    <div className="ml-10 mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]" aria-label="Linked computer execution receipt">
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-emerald-300">Accepted by {m.acceptedDevice.machineLabel}</span>
                      <span>Runtime {m.acceptedDevice.runtimeVersion}</span>
                    </div>
                  )}

                  {(projectChat.tasksByResponseMessageId.get(m.id)?.length ?? 0) > 0 && (
                    <LivingTaskBundle
                      tasks={projectChat.tasksByResponseMessageId.get(m.id) ?? []}
                      onTaskAction={handleProjectTaskAction}
                      taskHref={projectTaskHref}
                      canApprove={userRole === 'admin'}
                    />
                  )}
                  {(chatContexts.model?.artifacts.filter((artifact) => artifact.conversationOrigin?.responseMessageId === m.id).length ?? 0) > 0 && (
                    <ContextArtifactBundle
                      artifacts={chatContexts.model?.artifacts.filter((artifact) => artifact.conversationOrigin?.responseMessageId === m.id) ?? []}
                      onActivate={(artifact) => {
                        setContextArtifactRequest({ id: artifact.id, nonce: Date.now() })
                      }}
                    />
                  )}

                  {/* Approval card */}
                  {m.role === 'assistant' &&
                    m.status === 'waiting_approval' &&
                    approvalPending[m.id] && (
                      <div className="mt-2 ml-10 rounded-xl border border-[#f59e0b44] bg-[#1a1500] px-4 py-3 text-sm">
                        <div className="mb-1 font-medium text-[#f59e0b]">
                          Waiting for approval
                        </div>
                        <div className="mb-3 text-[#d4c4a0]">
                          I want to call{' '}
                          <span className="font-mono text-[#93c5fd]">
                            {approvalPending[m.id]!.toolName ?? 'a tool'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => resolveApproval(m.id, 'once')}
                            className="rounded-md bg-[#166534] px-3 py-1.5 text-xs font-medium text-[#86efac] hover:opacity-90"
                          >
                            Allow once
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveApproval(m.id, 'always')}
                            className="rounded-md bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-[#93c5fd] hover:opacity-90"
                          >
                            Allow always
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveApproval(m.id, 'deny')}
                            className="rounded-md bg-[#3b0000] px-3 py-1.5 text-xs font-medium text-[#fca5a5] hover:opacity-90"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )
            })}
          {chatContexts.routineUpdateCount > 0 && (
            <button
              type="button"
              onClick={chatContexts.dismissRoutineUpdates}
              className="ml-0 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/15 px-3 py-2 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] lg:ml-10"
            >
              <span className="material-symbols-outlined text-[14px] text-primary" aria-hidden="true">update</span>
              {chatContexts.routineUpdateCount} routine update{chatContexts.routineUpdateCount === 1 ? '' : 's'}
              <span className="material-symbols-outlined text-[13px]" aria-hidden="true">expand_more</span>
            </button>
          )}
          {projectChat.routineUpdateCount > 0 && (
            <button type="button" onClick={projectChat.dismissRoutineUpdates} className="ml-0 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/15 px-3 py-2 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] lg:ml-10">
              <span className="material-symbols-outlined text-[14px] text-primary" aria-hidden="true">update</span>
              {projectChat.routineUpdateCount} project update{projectChat.routineUpdateCount === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {/* Error bar */}
        {unavailableActiveRuntime && (
          <div role="alert" className="border-t border-red-500/35 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
            <div className="font-semibold text-red-100">{unavailableActiveRuntime.queueable || unavailableActiveRuntime.recovering ? 'Computer reconnecting' : 'Computer unavailable'}</div>
            <div className="mt-0.5">
              {unavailableActiveRuntime.queueable || unavailableActiveRuntime.recovering
                ? `${unavailableActiveRuntime.label} is reconnecting. This session remains linked to it; messages will queue on this computer and resume automatically when it is ready, within the 45-minute queue window.`
                : `${unavailableActiveRuntime.label} is ${unavailableActiveRuntime.offline ? 'offline' : 'unavailable'}. This session remains linked to ${unavailableActiveRuntime.label}. Try again when it is online.`}
            </div>
          </div>
        )}
        {error && (
          <div role="alert" className="px-4 py-2 text-xs text-red-300 border-t border-red-500/30 bg-red-500/10">
            {error}
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={send}
          onDrop={handleAttachmentDrop}
          onDragOver={handleAttachmentDragOver}
          onDragLeave={handleAttachmentDragLeave}
          data-testid="chat-input-drop-zone"
          style={contextCanvasReservedStyle}
          className={[
            hermesLayout
              ? 'shrink-0 min-w-0 flex flex-col gap-1.5 border-t border-[var(--color-card-border)] p-2 transition-[background-color,margin] duration-200'
              : 'shrink-0 min-w-0 flex flex-col gap-2 border-t border-[var(--color-card-border)] p-3 transition-[background-color,margin] duration-200',
            draggingAttachments ? 'bg-primary/10 ring-1 ring-primary/35' : '',
            rightDockOpen ? 'lg:mr-[var(--context-canvas-width)]' : '',
          ].join(' ')}
        >
          {showComposerContextToolbar && (
            <div data-testid="chat-context-toolbar" className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {projectChat.progress && projectChat.activeProjectId && !contextRefs.some((ref) => ref.type === 'project' && ref.id === projectChat.activeProjectId) && (
                  <span
                    data-testid="project-composer-chip"
                    className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-[11px] text-[var(--color-pib-text)]"
                  >
                    <span className="material-symbols-outlined text-[13px]" aria-hidden="true">folder_managed</span>
                    <span className="max-w-[180px] truncate">{projectChat.progress.project.name}</span>
                  </span>
                )}
                {currentPageContext && (
                  <button
                    type="button"
                    onClick={() => {
                      const initiatingConversationId = activeId
                      pinCurrentPageContext().catch((err) => {
                        if (activeConversationIdRef.current !== initiatingConversationId) return
                        setError(err instanceof Error ? err.message : 'Failed to attach current page')
                      })
                    }}
                    disabled={!canUseComposer || sending || contextRefs.some((ref) => contextReferenceKey(ref) === contextReferenceKey(currentPageContext))}
                    title="Use current page as context"
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2.5 text-[11px] font-medium text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] disabled:opacity-45"
                  >
                    <span className="material-symbols-outlined text-[14px]">add_link</span>
                    Use current page
                  </button>
                )}
                {contextRefs.map((ref) => (
                  <span
                    key={contextReferenceKey(ref)}
                    data-testid={ref.type === 'project' && ref.id === projectChat.activeProjectId ? 'project-composer-chip' : undefined}
                    className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-[11px] text-[var(--color-pib-text)]"
                    title={`${ref.type}: ${contextChipLabel(ref)}`}
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {ref.origin === 'current_page' ? 'tab' : 'alternate_email'}
                    </span>
                    <span className="max-w-[180px] truncate">{ref.type}: {contextChipLabel(ref)}</span>
                    <button
                      type="button"
                      onClick={() => removeContextRef(ref)}
                      aria-label={`Remove ${contextChipLabel(ref)} context`}
                      className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  </span>
                ))}
              </div>

              {activeModelAgentId && (
                <div className="ml-auto shrink-0 lg:hidden">
                  <ModelProviderPicker
                    catalog={modelCatalog}
                    selected={selectedRuntime}
                    loading={modelCatalogLoading}
                    disabled={!activeConversation}
                    compact
                    placement="top"
                    onSelect={setSelectedRuntime}
                    onRefresh={loadModelCatalog}
                  />
                </div>
              )}

              {allowAgentParticipants && !hermesLayout && (
                <label className={`${activeModelAgentId ? '' : 'ml-auto '}shrink-0`}>
                  <span className="sr-only">Thinking effort</span>
                  <select
                    value={agentEffort}
                    onChange={(event) => setAgentEffort(event.target.value as AgentEffort | '')}
                    disabled={!canUseComposer || sending}
                    title="Thinking effort"
                    aria-label="Thinking effort"
                    className="h-7 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2.5 text-[11px] font-medium text-[var(--color-pib-text-muted)] outline-none transition-colors hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus:border-primary disabled:opacity-40"
                  >
                    <option value="">Auto</option>
                    {AGENT_EFFORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {slashPrompt && (
            <div className="max-h-[min(60dvh,24rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                Slash commands
              </div>
              {slashCommandOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">No matching commands</div>
              ) : (
                slashCommandOptions.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    aria-label={`Use ${command.token}`}
                    onClick={() => selectSlashCommand(command)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">{command.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{command.label}</span>
                      <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">{command.token} · {command.description}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {contextTypePrompt && (
            <div id={contextPickerPanelId} role="listbox" aria-label="Mention types" className="max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div role="presentation" className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                Mention types
              </div>
              {contextTypeOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">No matching mention types</div>
              ) : (
                contextTypeOptions.map((option, index) => (
                  <button
                    key={option.namespace}
                    id={`${contextPickerPanelId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === contextPickerActiveIndex}
                    tabIndex={-1}
                    aria-label={option.kind === 'agent' ? 'Use @agent:' : `Use @${option.namespace}:`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectContextType(option)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.06] ${index === contextPickerActiveIndex ? 'bg-white/[0.06]' : ''}`}
                  >
                    <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">
                      {option.kind === 'agent' ? 'smart_toy' : 'alternate_email'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{option.label}</span>
                      <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">
                        {option.kind === 'agent' ? '@agent: · hand off to a specialist' : `@${option.namespace}:`}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {contextMention && isAgentComposerMention && (
            <div id={contextPickerPanelId} role="listbox" aria-label="Agents" className="max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div role="presentation" className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                @agent: specialists{mentionRuntimeLabel ? ` · ${mentionRuntimeLabel}` : ''}
              </div>
              {contextSearchLoading && (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">Loading agents…</div>
              )}
              {!contextSearchLoading && agentMentionResults.length === 0 && (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  {contextSearchMessage ?? 'No matching agents'}
                </div>
              )}
              {!contextSearchLoading && agentMentionResults.map((agent, index) => (
                <button
                  key={agent.agentId}
                  id={`${contextPickerPanelId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === contextPickerActiveIndex}
                  tabIndex={-1}
                  aria-label={`Tag @agent:${agent.agentId}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectAgentMention(agent.agentId)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.06] ${index === contextPickerActiveIndex ? 'bg-white/[0.06]' : ''}`}
                >
                  <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">smart_toy</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{agent.label}</span>
                    <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">
                      {agent.summary || `@agent:${agent.agentId}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {contextMention && !isAgentComposerMention && (
            <div id={contextPickerPanelId} role="listbox" aria-label="Context references" className="max-h-[min(60dvh,32rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div role="presentation" className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                @{contextMention.namespace}: references
              </div>
              {contextSearchLoading && (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">Searching…</div>
              )}
              {!contextSearchLoading && contextSearchResults.length === 0 && (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">
                  {contextSearchMessage ?? 'No matching references'}
                </div>
              )}
              {!contextSearchLoading && contextSearchResults.map((ref, index) => (
                <button
                  key={contextReferenceKey(ref)}
                  id={`${contextPickerPanelId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === contextPickerActiveIndex}
                  tabIndex={-1}
                  aria-label={contextChipLabel(ref)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMentionContext(ref)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.06] ${index === contextPickerActiveIndex ? 'bg-white/[0.06]' : ''}`}
                >
                  <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">alternate_email</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{contextChipLabel(ref)}</span>
                    {ref.summary && (
                      <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">{ref.summary}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          {activeQueuedDrafts.length > 0 && (
            <div
              data-testid="queued-composer-drafts"
              className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-xs text-[var(--color-pib-text)]"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                <span>{activeQueuedDrafts.length} queued follow-up{activeQueuedDrafts.length === 1 ? '' : 's'}</span>
                <span>{hasInFlightAgentRun ? 'Will send after this run' : sending ? 'Sending…' : 'Sending next…'}</span>
              </div>
              <div className="space-y-1">
                {activeQueuedDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/10 px-2 py-1.5"
                  >
                    <span className="material-symbols-outlined text-[15px] text-[var(--color-pib-text-muted)]">playlist_add</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px]">
                        {draft.text.trim() || `${draft.attachments.length} attachment${draft.attachments.length === 1 ? '' : 's'}`}
                      </div>
                      {draft.attachments.length > 0 && (
                        <div className="truncate text-[10px] text-[var(--color-pib-text-muted)]">
                          {draft.attachments.map((file) => file.name).join(', ')}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => loadQueuedDraftIntoComposer(draft)}
                      className="rounded-full px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => removeQueuedDraft(draft.id)}
                      aria-label="Remove queued follow-up"
                      className="grid h-6 w-6 place-items-center rounded-full text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {presenceLine && (
            <div
              data-testid="conversation-presence-line"
              className="flex items-center gap-1.5 px-1 text-[11px] text-[var(--color-pib-text-muted)]"
              aria-live="polite"
            >
              <span className="material-symbols-outlined text-[14px] text-emerald-400/90" aria-hidden="true">
                {presenceLine.includes('typing') ? 'edit' : 'visibility'}
              </span>
              <span>{presenceLine}</span>
            </div>
          )}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-full bg-white/8 border border-white/10 px-2.5 py-1 text-xs text-[var(--color-pib-text-muted)]"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {f.type.startsWith('image/') ? 'image' : f.type === 'application/pdf' ? 'picture_as_pdf' : 'attach_file'}
                  </span>
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <span className="opacity-50">({(f.size / 1024).toFixed(0)} KB)</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-0.5 text-[var(--color-pib-text-muted)]/60 hover:text-[var(--color-pib-text)] transition-colors"
                    aria-label="Remove attachment"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Mobile: pill-style composer; Desktop: keep flat textarea + button */}
          <div
            data-testid="chat-input-pill"
            className={[
              'flex min-w-0 items-end gap-2 rounded-3xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-1.5',
              hermesLayout
                ? 'lg:rounded-xl lg:bg-black/[0.08] lg:px-2 lg:py-1'
                : compact ? '' : 'lg:rounded-lg lg:border-0 lg:bg-transparent lg:px-0 lg:py-0',
            ].join(' ')}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx"
              id={attachmentInputId}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                addPendingAttachments(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            {/* Design commands — action menu fallback (mobile) for the "/" surface */}
            <div className="relative self-end shrink-0">
              <button
                type="button"
                onClick={() => setDesignMenuOpen((open) => !open)}
                title="Design commands (polish, typeset, layout, colorize, audit, …)"
                aria-label="Design commands"
                aria-expanded={designMenuOpen}
                aria-haspopup="menu"
                disabled={!canUseComposer || sending}
                className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.08] transition-colors aria-disabled:opacity-40 shrink-0 cursor-pointer aria-disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[20px]">palette</span>
              </button>
              {designMenuOpen && (
                <div
                  role="menu"
                  aria-label="Design commands"
                  className="absolute bottom-full right-0 z-30 mb-2 max-h-[min(60dvh,28rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl"
                >
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                    Design commands
                  </div>
                  {DESIGN_COMMANDS.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      role="menuitem"
                      aria-label={`Insert ${command.token}`}
                      onClick={() => insertDesignCommand(command)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.06]"
                    >
                      <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">{command.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{command.label}</span>
                        <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">{command.token} · {command.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Attach */}
            <label
              htmlFor={!canUseComposer || sending ? undefined : attachmentInputId}
              role="button"
              tabIndex={!canUseComposer || sending ? -1 : 0}
              onKeyDown={(e: KeyboardEvent<HTMLLabelElement>) => {
                if (!canUseComposer || sending) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              title={activeConversation ? 'Attach file' : 'Attach file and start a new conversation'}
              aria-label="Attach file"
              aria-disabled={!canUseComposer || sending}
              className="self-end flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.08] transition-colors aria-disabled:opacity-40 shrink-0 cursor-pointer aria-disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[20px]">attach_file</span>
            </label>

            <VoiceInputButton
              disabled={!canUseComposer || sending || !activeConversation}
              onTranscript={addVoiceTranscriptToComposer}
              className="self-end"
            />

            <textarea
              ref={composerRef}
              aria-label="Message"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={contextPickerOpen}
              aria-controls={contextPickerOpen ? contextPickerPanelId : undefined}
              aria-activedescendant={contextPickerActiveOptionId}
              value={input}
              onChange={(e) => {
                composerEditRevisionRef.current += 1
                suppressContextPickerKeyUpRef.current = false
                setInput(e.target.value)
                setHistoryCursor(null)
                historyDraftRef.current = ''
                updateMentionFromComposer(e.target.value, e.target.selectionStart ?? e.target.value.length)
                requestAnimationFrame(() => resizeComposer())
              }}
              onClick={(e) => updateMentionFromComposer(input, e.currentTarget.selectionStart ?? input.length)}
              onKeyUp={(e) => {
                if (e.key === 'Escape' && suppressContextPickerKeyUpRef.current) {
                  suppressContextPickerKeyUpRef.current = false
                  return
                }
                updateMentionFromComposer(input, e.currentTarget.selectionStart ?? input.length)
              }}
              onKeyDown={(e) => {
                if (handleContextPickerKeyDown(e)) return
                if (e.key === 'Escape' && (contextMention || contextTypePrompt || slashPrompt || designMenuOpen)) {
                  e.preventDefault()
                  if (designMenuOpen) {
                    setDesignMenuOpen(false)
                    return
                  }
                  const contextPicker = contextMention ?? contextTypePrompt
                  const insertedSeparator = contextPickerInsertedSeparatorRef.current
                  if (contextPicker && insertedSeparator !== undefined) {
                    setInput((latestInput) => removeMentionToken(latestInput, contextPicker, insertedSeparator))
                  }
                  contextPickerInsertedSeparatorRef.current = undefined
                  suppressContextPickerKeyUpRef.current = true
                  setContextMention(null)
                  setContextTypePrompt(null)
                  setSlashPrompt(null)
                  setContextSearchResults([])
                  return
                }
                if (e.key === 'ArrowUp' && navigateComposerHistory(e, -1)) return
                if (e.key === 'ArrowDown' && navigateComposerHistory(e, 1)) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(e as unknown as FormEvent)
                }
              }}
              placeholder={
                unavailableActiveRuntime?.queueable
                  ? 'Computer reconnecting — messages will queue'
                  : unavailableActiveRuntime
                  ? 'Computer unavailable'
                  : !allowSendMessages
                  ? 'Replies disabled for your role'
                  : hasInFlightAgentRun
                    ? 'Queue a follow-up while Pip is running'
                  : activeConversation
                    ? 'Send a message'
                    : allowStartConversations
                      ? allowAgentParticipants ? 'Message Pip' : 'Create or select a conversation first'
                      : 'Select a conversation first'
              }
              disabled={!canUseComposer || sending}
              rows={1}
              className={[
                'min-h-[40px] max-h-[160px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-[15px] placeholder:text-[var(--color-pib-text-muted)] disabled:opacity-60 focus:outline-none',
                compact ? '' : hermesLayout ? 'lg:min-h-[36px] lg:px-2 lg:py-1.5 lg:text-sm' : 'lg:text-sm lg:rounded-lg lg:border lg:border-[var(--color-card-border)] lg:bg-[var(--color-card)] lg:px-3 lg:py-2 lg:min-h-[36px]',
              ].join(' ')}
            />
            <button
              type="submit"
              disabled={!canUseComposer || sending || (!input.trim() && attachments.length === 0)}
              aria-label="Send message"
              className={[
                'self-end flex items-center justify-center w-9 h-9 rounded-full bg-primary text-on-primary disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0',
                compact ? '' : 'lg:w-auto lg:h-auto lg:rounded-lg lg:px-4 lg:py-2 lg:text-sm lg:font-medium',
              ].join(' ')}
            >
              <span className={['material-symbols-outlined text-[20px]', compact ? '' : 'lg:hidden'].join(' ')}>
                {sending ? 'hourglass_empty' : hasInFlightAgentRun ? 'playlist_add' : 'arrow_upward'}
              </span>
              {!compact && <span className="hidden lg:inline">{sending ? 'Sending…' : hasInFlightAgentRun ? 'Queue' : 'Send'}</span>}
            </button>
          </div>

          {hermesLayout && (
            <div
              data-testid="hermes-runtime-control-bar"
              className="flex min-h-8 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-card-border)] bg-black/[0.08] px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${hasInFlightAgentRun ? 'bg-amber-300' : 'bg-emerald-300'}`} />
                  {activeRuntimeMessage?.status?.replace('_', ' ') ?? (hasInFlightAgentRun ? 'running' : 'idle')}
                </span>
                {canStopActiveRun && activeRuntimeMessage?.id && activeId && (
                  <button
                    type="button"
                    onClick={() => stopAgentRun(activeId, activeRuntimeMessage.id)}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-red-400/25 bg-red-500/10 px-2 text-[11px] font-medium text-red-200 hover:bg-red-500/15"
                  >
                    <span className="material-symbols-outlined text-[13px]">stop_circle</span>
                    Stop
                  </button>
                )}
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2">
                  <span className="material-symbols-outlined text-[13px]">playlist_add</span>
                  {activeQueuedDrafts.length} queued
                </span>
                <label className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1.5 sm:px-2">
                  <span className="material-symbols-outlined text-[13px]">shield_lock</span>
                  <span className="sr-only">Approval mode</span>
                  <select
                    value={approvalMode}
                    onChange={(event) => {
                      const next = cleanApprovalMode(event.target.value) ?? 'ask'
                      setApprovalMode(next)
                    }}
                    disabled={!canUseComposer || sending}
                    title={APPROVAL_MODE_OPTIONS.find((option) => option.value === approvalMode)?.description}
                    aria-label="Approval mode"
                    className="max-w-[9.5rem] bg-transparent text-[11px] font-medium text-[var(--color-pib-text-muted)] outline-none disabled:opacity-40"
                  >
                    {APPROVAL_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} title={option.description}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                {activeModelAgentId && (
                  <ModelProviderPicker
                    catalog={modelCatalog}
                    selected={selectedRuntime}
                    loading={modelCatalogLoading}
                    disabled={!activeConversation}
                    compact
                    placement="top"
                    onSelect={setSelectedRuntime}
                    onRefresh={loadModelCatalog}
                  />
                )}
                {allowAgentParticipants && (
                  <label className="shrink-0">
                    <span className="sr-only">Runtime thinking effort</span>
                    <select
                      value={agentEffort}
                      onChange={(event) => setAgentEffort(event.target.value as AgentEffort | '')}
                      disabled={!canUseComposer || sending}
                      title="Thinking effort"
                      aria-label="Runtime thinking effort"
                      className="h-7 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2 text-[11px] font-medium text-[var(--color-pib-text-muted)] outline-none transition-colors hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus:border-primary disabled:opacity-40"
                    >
                      <option value="">Auto effort</option>
                      {AGENT_EFFORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {showAgentWorkbench && (
                  <button
                    type="button"
                    data-testid="hermes-agent-workbench-toggle"
                    aria-label={workbenchOpen ? 'Close agent workbench' : 'Open agent workbench'}
                    aria-pressed={workbenchOpen}
                    onClick={() => {
                      if (workbenchOpen) handleWorkbenchOpenChange(false)
                      else openWorkbenchTab(workbenchTab)
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2 text-[11px] font-medium text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
                  >
                    <span className="material-symbols-outlined text-[13px]">dock_to_left</span>
                    Workbench
                  </button>
                )}
                {runtimeExecution && <button
                  type="button"
                  data-testid="hermes-runtime-inspector-toggle"
                  aria-label="Open runtime inspector"
                  onClick={() => setExecutionDockRequest((value) => value + 1)}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2 text-[11px] font-medium text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
                >
                  <span className="material-symbols-outlined text-[13px]">developer_board</span>
                  Inspector
                </button>}
              </div>
            </div>
          )}
        </form>

      </section>

      {accessConversation && (
        <ConversationAccessDialog
          conversation={accessConversation}
          onClose={() => setAccessConversation(null)}
          onUpdated={(updated) => {
            setConversations((current) => current.map((conversation) =>
              conversation.id === updated.id ? updated : conversation,
            ))
            setAccessConversation(updated)
          }}
        />
      )}

      {/* ── New conversation modal ──────────────────────────────────────── */}
      {showNewModal && (
        <AccessibleDialog
          label="New conversation"
          onClose={closeNewConversation}
          className="flex h-[min(80dvh,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] w-full max-w-md flex-col overflow-hidden overscroll-none rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] shadow-2xl [overflow-anchor:none] sm:max-h-[calc(100dvh-2rem)]"
        >
            {/* Modal header — always pinned; body scrolls underneath */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-4 py-3 sm:px-5 sm:py-4">
              <h2 id="new-conversation-title" className="text-sm font-medium text-[var(--color-pib-text)]">New conversation</h2>
              <button
                type="button"
                onClick={closeNewConversation}
                className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal body — only this region scrolls (not the backdrop / whole card) */}
            <div data-testid="new-conversation-scroll-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain [overflow-anchor:none] p-4 sm:p-5">
              {/* Optional title */}
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] block mb-1.5">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Q3 campaign planning"
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)] outline-none focus:border-primary/60"
                />
              </div>

              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] block mb-1.5">
                  Conversation context
                </label>
                {companyCoworkLocked ? (
                  <div
                    data-testid="locked-company-cowork-context"
                    className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">folder</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">
                        {selectedCompanyName || orgName || 'Company Cowork'}
                      </p>
                      <p className="text-[11px] text-[var(--color-pib-text-muted)]">
                        Company Cowork folder · pick VPS or Mac below
                      </p>
                    </div>
                  </div>
                ) : (
                  <select
                    aria-label="Conversation context"
                    value={newScope}
                    onChange={(e) => setNewConversationScope(e.target.value as ConversationScope)}
                    className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                  >
                    {availableConversationContexts.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {(newScope === 'workspace' || newScope === 'company' || newScope === 'project') && (
                <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  {!(companyCoworkLocked && newScope === 'company') && (
                  <div>
                    <label className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      {newScope === 'project'
                        ? 'Project folder'
                        : newScope === 'company' ? 'Company Cowork folder' : 'Organisation root'}
                    </label>
                    {newScope === 'project' ? (
                      <div className="flex items-center gap-2">
                        <select
                          aria-label="Project folder"
                          value={selectedProjectId}
                          onChange={(e) => setSelectedProjectId(e.target.value)}
                          disabled={workspacesLoading || workspaceProjects.length === 0}
                          className="min-w-0 flex-1 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60 disabled:opacity-60"
                        >
                          {workspaceProjects.length === 0 ? (
                            <option value="">{workspacesLoading ? 'Loading projects…' : 'No projects available'}</option>
                          ) : workspaceProjects.map((project) => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={openProjectSetupWizard}
                          className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 text-xs font-medium text-primary hover:bg-primary/15"
                        >
                          New project
                        </button>
                      </div>
                    ) : newScope === 'company' ? (
                      <CompanyPicker
                        currentCompanyId={selectedCompanyId}
                        currentCompanyName={selectedCompanyName}
                        ariaLabel="Search accessible companies"
                        allowCreate={false}
                        onChange={({ companyId, companyName }) => {
                          setSelectedCompanyId(companyId ?? '')
                          setSelectedCompanyName(companyName ?? '')
                        }}
                      />
                    ) : (
                      <select
                        aria-label="Organisation root"
                        value={selectedWorkspaceId}
                        onChange={(e) => { workspaceRuntimeExplicitRef.current = false; setSelectedWorkspaceId(e.target.value); setSelectedWorkspaceRuntime('') }}
                        disabled={workspacesLoading || organisationWorkspaces.length === 0}
                        className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60 disabled:opacity-60"
                      >
                        {organisationWorkspaces.length === 0 ? (
                          <option value="">{workspacesLoading ? 'Loading Workspaces…' : 'No Workspaces available'}</option>
                        ) : organisationWorkspaces.map((workspace) => (
                          <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.orgName}</option>
                        ))}
                      </select>
                    )}
                    {selectedWorkspace && (
                      <div className="mt-1 truncate text-[11px] text-[var(--color-pib-text-muted)]">
                        {newScope === 'project'
                          ? 'Company project folder on the selected computer'
                          : newScope === 'company'
                            ? 'Top-level CRM company Cowork folder'
                            : 'Current organisation root folder'}
                      </div>
                    )}
                  </div>
                  )}
                  <div>
                    <label htmlFor="workspace-runtime" className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      {showMappedFolderRuntimeChoices ? 'Computer / mapped folder' : 'Computer'}
                    </label>
                    <select
                      id="workspace-runtime"
                      aria-label={showMappedFolderRuntimeChoices ? 'Computer / mapped folder' : 'Computer'}
                      value={selectedWorkspaceRuntime}
                      onChange={(e) => { workspaceRuntimeExplicitRef.current = true; setSelectedWorkspaceRuntime(e.target.value) }}
                      className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                    >
                      {!workspaceRuntimeTargets.some((runtime) => (
                        runtime.selectable || workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime
                      )) ? (
                        <option value="" disabled>{newScope === 'project'
                          ? workspaceRuntimeTargets.length > 0
                            ? 'No ready project computers available'
                            : 'No linked computers available'
                          : 'No computers available'}</option>
                      ) : workspaceRuntimeTargets
                        .filter((runtime) => (
                          runtime.selectable || workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime
                        ))
                        .map((runtime) => {
                          const selectionKey = workspaceRuntimeSelectionKey(runtime)
                          const status = runtime.isLocal
                            ? runtime.isFresh && runtime.isHealthy
                              ? runtime.ageSeconds != null
                                ? ` · online ${runtime.ageSeconds < 60 ? 'now' : `${Math.floor(runtime.ageSeconds / 60)}m ago`}`
                                : ' · online'
                              : ' · Computer unavailable'
                            : ''
                          return (
                            <option key={selectionKey} value={selectionKey} disabled={!runtime.selectable}>
                              {workspaceRuntimeOptionLabel(runtime, {
                                includeMapping: showMappedFolderRuntimeChoices,
                              })}{status}
                            </option>
                          )
                        })}
                    </select>
                    {workspaceRuntimeExplicitRef.current && workspaceRuntimeTargets.some(runtime => (
                      workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime && !runtime.selectable
                    )) && (
                      <p role="alert" className="mt-2 text-xs text-red-300">
                        {workspaceRuntimeTargets.find(runtime => workspaceRuntimeSelectionKey(runtime) === selectedWorkspaceRuntime)?.label ?? 'This computer'} is unavailable. Select another computer or try again when it is online.
                      </p>
                    )}
                    <div className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      {showMappedFolderRuntimeChoices
                        ? 'Only healthy computers authorised for the current organisation can run files here. When a computer has more than one mapped folder, each mapping appears as its own choice.'
                        : newScope === 'company'
                          ? companyCoworkLocked
                            ? 'Defaults to this organisation’s VPS Cowork copy. Switch to Mac or another computer anytime.'
                            : 'Pick VPS or Mac. The company Cowork folder is already chosen above.'
                          : 'Pick a linked computer. The project folder is already chosen above.'}
                    </div>
                    {newScope === 'project' && selectedProjectId && workspaceRuntimeTargets.length === 0 && (
                      <p role="status" className="mt-2 text-xs text-amber-200">
                        Link a location to this project before starting a session.
                      </p>
                    )}
                    {newScope === 'project' && selectedProjectId && workspaceRuntimeTargets.length > 0
                      && !workspaceRuntimeTargets.some((runtime) => runtime.selectable) && (
                      <p role="status" className="mt-2 text-xs text-amber-200">
                        No linked computer currently has a ready project folder. Wait for sync to finish or bring a linked computer online.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Workstream role
                    </label>
                    <select
                      aria-label="Workstream role"
                      value={newConversationWorkforceBlueprintId || 'auto'}
                      onChange={(e) => {
                        setNewConversationWorkforceBlueprintId(e.target.value === 'auto' ? '' : e.target.value)
                      }}
                      className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                    >
                      <option value="auto">Auto (profile)</option>
                      {WORKFORCE_BLUEPRINT_OPTIONS.map((blueprint) => (
                        <option key={blueprint.id} value={blueprint.id}>
                          {blueprint.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      Select a workstream to get role-specific agent recommendations for this chat.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Visibility
                    </label>
                    <select
                      value={selectedWorkspaceShareMode}
                      onChange={(e) => {
                        selectedWorkspaceShareModeTouchedRef.current = true
                        setSelectedWorkspaceShareMode(e.target.value as 'private' | 'shared' | 'org')
                      }}
                      className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                    >
                      <option value="private">Private · only me</option>
                      <option value="shared">Shared · selected participants</option>
                      <option value="org" disabled={!scopedConversationShareModeSupportsOrg}>
                        Organisation · all Workspace members
                      </option>
                    </select>
                    <div className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      {scopedConversationShareModeSupportsOrg
                        ? 'Organisation visibility is default for shared workspace runtimes.'
                        : 'This runtime is private-only. Pick a shared workspace runtime for Organisation visibility.'}
                    </div>
                  </div>
                  {newScope === 'project' && showProjectSetupWizard && (
                    <section
                      role="region"
                      aria-label="New project"
                      className="space-y-3 rounded-lg border border-primary/25 bg-[var(--color-card)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">New project</h3>
                          <p className="mt-0.5 text-[11px] text-[var(--color-pib-text-muted)]">Choose the project first, then link its approved locations.</p>
                        </div>
                        <button
                          type="button"
                          aria-label="Close project setup"
                          onClick={() => setShowProjectSetupWizard(false)}
                          className="rounded p-1 text-[var(--color-pib-text-muted)] hover:bg-white/5 hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[17px]">close</span>
                        </button>
                      </div>

                      {!projectSetupResult ? (
                        <>
                          <fieldset className="grid gap-1.5">
                            <legend className="sr-only">Project setup type</legend>
                            {([
                              ['existing_folder', 'Link existing project'],
                              ['standard', 'Create new project'],
                            ] as const).map(([mode, label]) => (
                              <label key={mode} className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-card-border)] px-2.5 py-2 text-xs text-[var(--color-pib-text)]">
                                <input
                                  type="radio"
                                  name="project-setup-mode"
                                  value={mode}
                                  checked={projectSetupMode === mode}
                                  onChange={() => {
                                    setProjectSetupMode(mode)
                                    setProjectSetupError(null)
                                  }}
                                />
                                {label}
                              </label>
                            ))}
                          </fieldset>

                          <label className="block text-xs text-[var(--color-pib-text)]">
                            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Company</span>
                            <CompanyPicker
                              currentCompanyId={projectSetupCompanyId}
                              currentCompanyName={projectSetupCompanyName}
                              orgScope={{ orgId }}
                              ariaLabel="Search accessible companies"
                              allowCreate={false}
                              onChange={({ companyId, companyName }) => {
                                setProjectSetupExistingProjects([])
                                setProjectSetupLibraryLoading(Boolean(companyId))
                                setProjectSetupCompanyId(companyId ?? '')
                                setProjectSetupCompanyName(companyName ?? '')
                                if (companyName) setProjectSetupName(companyName)
                                setProjectSetupError(null)
                              }}
                            />
                          </label>

                          {projectSetupMode === 'existing_folder' && projectSetupCompanyId && (
                            <div className="space-y-1.5">
                              {projectSetupLibraryLoading ? (
                                <p className="text-xs text-[var(--color-pib-text-muted)]">Checking this company&apos;s projects…</p>
                              ) : projectSetupExistingProjects.map((project) => (
                                <div key={project.id} className="flex items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-[var(--color-pib-text)]">{project.name}</p>
                                    <p className="text-[11px] text-[var(--color-pib-text-muted)]">Existing Cowork project for {projectSetupCompanyName}</p>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={project.added ? `${project.name} is already in my projects` : `Add ${project.name} to my projects`}
                                    disabled={project.added || Boolean(projectSetupAddingProjectId)}
                                    onClick={() => void addExistingProjectToSidebar(project)}
                                    className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-on-primary disabled:opacity-50"
                                  >
                                    {project.added ? 'Already added' : projectSetupAddingProjectId === project.id ? 'Adding…' : 'Add project'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <label className="block text-xs text-[var(--color-pib-text)]">
                            <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Project name</span>
                            <input
                              type="text"
                              value={projectSetupName}
                              onChange={(event) => setProjectSetupName(event.target.value)}
                              className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60"
                            />
                          </label>

                          {projectSetupMode !== 'full_client' && (
                            <label className="block text-xs text-[var(--color-pib-text)]">
                              <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Current organisation runtime access</span>
                              <select
                                value={projectSetupWorkspaceId}
                                onChange={(event) => {
                                  setProjectSetupWorkspaceId(event.target.value)
                                  setProjectSetupLocationIds([])
                                }}
                                disabled={organisationWorkspaces.length === 0}
                                className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60 disabled:opacity-60"
                              >
                                {organisationWorkspaces.length === 0 ? <option value="">No mapped Workspaces</option> : organisationWorkspaces.map((workspace) => (
                                  <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.orgName}</option>
                                ))}
                              </select>
                              <span className="mt-1 block text-[11px] text-[var(--color-pib-text-muted)]">
                                This authorises the computer from the current organisation. The selected CRM company determines the Cowork folder.
                              </span>
                            </label>
                          )}

                          {projectSetupMode === 'existing_folder' && !projectSetupLibraryLoading && projectSetupExistingProjects.length === 0 && (
                            <>
                              <label className="block text-xs text-[var(--color-pib-text)]">
                                <span className="mb-1 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Registered folder</span>
                                <select
                                  value={projectSetupWorkspaceFolderId}
                                  onChange={(event) => setProjectSetupWorkspaceFolderId(event.target.value)}
                                  disabled={registeredWorkspaceFoldersLoading || registeredWorkspaceFolders.length === 0}
                                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60 disabled:opacity-60"
                                >
                                  {registeredWorkspaceFolders.length === 0 ? (
                                    <option value="">{registeredWorkspaceFoldersLoading ? 'Loading registered folders…' : 'No registered folders'}</option>
                                  ) : registeredWorkspaceFolders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                      {folder.name}{folder.syncStatus ? ` · ${humanizeProjectSetupValue(folder.syncStatus)}` : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {!registeredWorkspaceFoldersLoading && registeredWorkspaceFolders.length === 0 && (
                                <p className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                                  A folder must first be registered and mapped to this organisation Workspace.
                                </p>
                              )}
                              <fieldset className="space-y-1.5">
                                <legend className="mb-1 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Project locations</legend>
                                {projectSetupLocationOptions.length === 0 ? (
                                  <p className="text-xs text-amber-100">No authorised computers are mapped to this Workspace.</p>
                                ) : projectSetupLocationOptions.map((location) => (
                                  <label key={location.key} className={`flex items-center justify-between gap-2 rounded-md border border-[var(--color-card-border)] px-2.5 py-2 text-xs text-[var(--color-pib-text)] ${location.selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                                    <span className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        aria-label={`${location.label} · ${location.selectable ? 'online' : 'Computer unavailable'}`}
                                        checked={projectSetupLocationIds.includes(location.locationId)}
                                        disabled={!location.selectable}
                                        onChange={(event) => setProjectSetupLocationIds((current) => event.target.checked
                                          ? Array.from(new Set([...current, location.locationId]))
                                          : current.filter((locationId) => locationId !== location.locationId))}
                                      />
                                      {location.label}
                                    </span>
                                    <span>{location.selectable ? 'Online' : 'Computer unavailable'}</span>
                                  </label>
                                ))}
                              </fieldset>
                            </>
                          )}

                          {projectSetupMode === 'standard' && (
                            <fieldset className="space-y-1.5">
                              <legend className="mb-1 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Project locations</legend>
                              {projectSetupDuplicateName && (
                                <p className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                                  A project with this name already exists for the company. Add that project instead or use a different name.
                                </p>
                              )}
                              {projectSetupLocationOptions.length === 0 ? (
                                <p className="text-xs text-amber-100">No authorised computers are mapped to this Workspace.</p>
                              ) : projectSetupLocationOptions.map((location) => {
                                const isCanonicalVps = location.locationId === projectSetupCanonicalVps?.locationId
                                return (
                                  <label key={location.key} className={`flex items-center justify-between gap-2 rounded-md border border-[var(--color-card-border)] px-2.5 py-2 text-xs text-[var(--color-pib-text)] ${location.selectable && !isCanonicalVps ? 'cursor-pointer' : 'cursor-not-allowed'} ${location.selectable ? '' : 'opacity-60'}`}>
                                    <span className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        aria-label={`${location.label} · ${isCanonicalVps ? 'Canonical VPS' : location.selectable ? 'online' : 'Computer unavailable'}`}
                                        checked={projectSetupLocationIds.includes(location.locationId)}
                                        disabled={!location.selectable || isCanonicalVps}
                                        onChange={(event) => setProjectSetupLocationIds((current) => event.target.checked
                                          ? [...current, location.locationId]
                                          : current.filter((locationId) => locationId !== location.locationId))}
                                      />
                                      {location.label}
                                    </span>
                                    <span className={location.selectable ? 'text-emerald-300' : 'text-amber-200'}>
                                      {isCanonicalVps ? 'Canonical VPS · Online' : location.selectable ? 'Online' : 'Computer unavailable'}
                                    </span>
                                  </label>
                                )
                              })}
                              {!projectSetupCanonicalVps && (
                                <p className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                                  A verified online organisation VPS is required before creating a standard project.
                                </p>
                              )}
                              <p className="text-[11px] text-[var(--color-pib-text-muted)]">The company folder on the organisation VPS is always linked. Select every additional computer that should keep this project in sync.</p>
                            </fieldset>
                          )}

                          {projectSetupMode === 'full_client' && (
                            <div className="space-y-2.5">
                              <p className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
                                Client Manager will create the PiB client organisation, Cowork workspace, Obsidian knowledge domain, standard folders, project instructions, and mappings. It uses PiB&apos;s fixed named agents and does not create a per-client Hermes profile.
                              </p>
                              <label className="block text-xs text-[var(--color-pib-text)]">
                                <span className="mb-1 block">Client name</span>
                                <input type="text" value={projectSetupClientName} onChange={(event) => setProjectSetupClientName(event.target.value)} className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60" />
                              </label>
                              <label className="block text-xs text-[var(--color-pib-text)]">
                                <span className="mb-1 block">Client domain</span>
                                <input type="text" value={projectSetupDomainSlug} onChange={(event) => setProjectSetupDomainSlug(event.target.value)} placeholder="client-name" className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60" />
                              </label>
                              <label className="block text-xs text-[var(--color-pib-text)]">
                                <span className="mb-1 block">Agent name</span>
                                <input type="text" value={projectSetupAgentName} onChange={(event) => setProjectSetupAgentName(event.target.value)} className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60" />
                              </label>
                            </div>
                          )}

                          {projectSetupError && (
                            <p role="alert" className="rounded-md border border-red-400/25 bg-red-500/10 px-2.5 py-2 text-xs text-red-200">{projectSetupError}</p>
                          )}
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handleProjectSetup()}
                              disabled={!projectSetupCanSubmit}
                              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
                            >
                              {projectSetupSubmitting ? 'Creating project…' : 'Create project'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-md border border-[var(--color-card-border)] bg-white/[0.03] p-3">
                            <div className="text-sm font-medium text-[var(--color-pib-text)]">{projectSetupResult.projectName}</div>
                            <div className="mt-1 text-xs font-semibold text-primary">{projectSetupStateLabel(projectSetupResult.plan.state)}</div>
                          </div>
                          {(projectSetupResult.plan.actions?.length ?? 0) > 0 && (
                            <ul className="space-y-1.5" aria-label="Project setup actions">
                              {projectSetupResult.plan.actions?.map((action, index) => (
                                <li key={`${action.type ?? 'action'}-${index}`} className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-card-border)] px-2.5 py-2 text-xs">
                                  <span className="text-[var(--color-pib-text)]">{humanizeProjectSetupValue(action.type ?? 'pending action')}</span>
                                  {action.status && <span className="text-[var(--color-pib-text-muted)]">{humanizeProjectSetupValue(action.status)}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="text-xs text-[var(--color-pib-text-muted)]">
                            {projectSetupResult.mode === 'full_client'
                              ? 'The client workspace was created in its own organisation. Open it to link locations and start sessions.'
                              : projectSetupResult.plan.syncCompleted === true
                                ? 'Sync is confirmed.'
                                : 'Sync is not yet confirmed. The canonical online location can be used while secondary computers finish syncing.'}
                          </p>
                          {projectSetupResult.mode !== 'full_client' && !projectSetupHasAvailableLocation && (
                            <p className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                              No linked location is currently available. A session can start after a linked computer comes online and the Workspace refreshes.
                            </p>
                          )}
                          <div className="flex justify-end">
                            {projectSetupResult.mode === 'full_client' ? (
                              projectSetupResult.organizationSlug ? (
                                <a
                                  href={`/admin/org/${encodeURIComponent(projectSetupResult.organizationSlug)}/messages`}
                                  className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary hover:opacity-90"
                                >
                                  Open client Messages
                                </a>
                              ) : (
                                <button type="button" disabled className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary opacity-50">
                                  Client Messages unavailable
                                </button>
                              )
                            ) : (
                              <button
                                type="button"
                                onClick={() => setShowProjectSetupWizard(false)}
                                disabled={!projectSetupHasAvailableLocation}
                                className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
                              >
                                Continue to session
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}

              {/* Participants after context + machine so agents match the selected runtime */}
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] block mb-1.5">
                  Participants (max 12)
                </label>
                {newScope === 'general' && allowAgentParticipants && (
                  <p className="mb-2 px-0.5 text-[11px] text-[var(--color-pib-text-muted)]">
                    General chat uses Partners platform agents for this organisation. Workspace, company, and project chats list agents from the computer you pick above.
                  </p>
                )}
                {runtimeRequiredForNewConversation && newConversationAgentGate.mode === 'runtime' && allowAgentParticipants && (
                  <p className="mb-2 px-0.5 text-[11px] text-[var(--color-pib-text-muted)]">
                    Showing agents available on the selected computer.
                  </p>
                )}
                {/*
                  Cap the pick list height so the sticky Start footer stays on-screen.
                  Selected chips live inside the picker above the agent rows (not sticky)
                  to avoid scroll-anchor jumps when the first agent is toggled.
                */}
                <div data-testid="new-conversation-participants-scroll" className="max-h-[min(36dvh,220px)] overflow-y-auto overscroll-contain [overflow-anchor:none] sm:max-h-[280px]">
                  <ParticipantPicker
                    orgId={orgId}
                    onSelect={setNewParticipants}
                    initialAgentIds={newInitialAgentIds}
                    showAgents={allowAgentParticipants}
                    allowedAgentIds={newConversationAgentGate.allowedAgentIds}
                    agentsUnavailableReason={newConversationAgentGate.reason}
                    runtimeTargetId={selectedWorkspaceRuntimeTarget?.id ?? null}
                    workforceBlueprintId={newConversationWorkforceBlueprintId || null}
                  />
                </div>
              </div>

              {modalError && (
                <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {modalError}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:py-4">
              <button
                type="button"
                onClick={closeNewConversation}
                className="rounded-lg px-4 py-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateConversation}
                disabled={!allowStartConversations || creatingConv || newParticipants.length === 0 || ((newScope === 'workspace' || newScope === 'company' || newScope === 'project') && !selectedWorkspaceRuntimeIsValid) || (newScope === 'workspace' && !selectedWorkspaceId) || (newScope === 'company' && (!selectedCompanyId || !selectedWorkspaceId)) || (newScope === 'project' && (!selectedProjectId || !selectedWorkspaceId || projectSetupBlocksSession))}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50 hover:opacity-90"
              >
                {creatingConv
                  ? (newScope === 'company' || newScope === 'project'
                    ? 'Setting up Cowork folder…'
                    : 'Creating…')
                  : 'Start conversation'}
              </button>
            </div>
        </AccessibleDialog>
      )}
      {accessProject && (
        <AccessibleDialog
          label={`Project access for ${accessProject.name}`}
          onClose={() => setAccessProject(null)}
          className="w-full max-w-6xl rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4 shadow-2xl sm:p-6"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="pib-label">Messages project</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--color-pib-text)]">Link client organisation to {accessProject.name}</h2>
            </div>
            <button type="button" autoFocus onClick={() => setAccessProject(null)} className="pib-btn-secondary text-xs">Close</button>
          </div>
          <ProjectPeopleAccessPanel projectId={accessProject.id} orgId={orgId} />
        </AccessibleDialog>
      )}
    </div>
  )
}
