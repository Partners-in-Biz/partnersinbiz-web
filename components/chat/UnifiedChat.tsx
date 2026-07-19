'use client'

import { DragEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChatEvent, ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import { AGENT_IDS, type AgentSkillPolicyState } from '@/lib/agents/types'
import { AGENT_EFFORT_OPTIONS, type AgentEffort } from '@/lib/agents/runRouting'
import {
  extractCurrentPageContextCommand,
  filterContextReferenceMentionOptions,
  findActiveContextMention,
  findActiveContextTypePrompt,
  removeMentionToken,
  removeMentionTokenFromLatest,
  replaceTypePromptToken,
  type ActiveContextMention,
  type ActiveContextTypePrompt,
  type ContextReferenceMentionOption,
} from '@/lib/context-references/composer'
import {
  contextReferenceKey,
  MAX_CONTEXT_REFS,
  type ContextReference,
  type ContextReferenceSeed,
} from '@/lib/context-references/types'
import {
  buildSlashCommandPayload,
  filterSlashCommands,
  findActiveSlashCommandPrompt,
  parseLeadingSlashCommand,
  replaceSlashCommandToken,
  type ActiveSlashCommandPrompt,
  type SlashCommandDefinition,
  type SlashCommandPayload,
} from '@/lib/chat/slash-commands'
import MessageBubble, { type ConversationAttachment, type ConversationMessage } from './MessageBubble'
import ParticipantBar from './ParticipantBar'
import ParticipantPicker, { type SelectedParticipant } from './ParticipantPicker'
import ConversationListItem, { type Conversation } from './ConversationListItem'
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
import { ProjectPeopleAccessPanel } from '@/components/projects/ProjectPeopleAccessPanel'
import { AccessibleDialog } from '@/components/linked-computers/AccessibleOverlay'
import { CompanyPicker } from '@/components/crm/CompanyPicker'

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
  initialConvId?: string
  initialAgentId?: AgentId
  autoCreateScopedConversation?: boolean
  autoCreateTitle?: string
  allowDeleteConversations?: boolean
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
  /** A secondary pane reuses the chat surface without duplicating the session rail. */
  showConversationList?: boolean
  /** Backward-compatible presentation control for the Hermes session catalogue. */
  conversationRailMode?: 'expanded' | 'collapsed'
  onConversationRailModeChange?: (mode: 'expanded' | 'collapsed') => void
  onContextCanvasPresentationChange?: (state: { open: boolean; mode: 'single' | 'dual' }) => void
}

const POLL_INTERVAL = 1500
const MAX_RUN_POLL_ATTEMPTS = Math.ceil((90 * 60 * 1000) / POLL_INTERVAL)
const HUMAN_CHAT_REFRESH_INTERVAL = 3000
const WORKSPACE_CATALOGUE_REFRESH_INTERVAL = 30_000
const PROJECT_SYNC_STATUS_REFRESH_INTERVAL = 5_000
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_PENDING_ATTACHMENTS = 5
const MAX_COMPOSER_HISTORY_ENTRIES = 30
const MAX_QUEUED_COMPOSER_DRAFTS = 8
const COMPOSER_HISTORY_STORAGE_PREFIX = 'pib.messages.composerHistory.v1'
const PINNED_CONVERSATIONS_STORAGE_PREFIX = 'pib.messages.pinnedConversations.v1'
const EXPANDED_SESSION_GROUPS_STORAGE_PREFIX = 'pib.messages.expandedSessionGroups.v1'
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

function buildHermesSessionSections(conversations: Conversation[], pinnedIds: string[]) {
  const pinnedSet = new Set(pinnedIds)
  const visible = conversations.filter((conversation) =>
    !conversation.archived && !isProjectConversation(conversation) && !isCompanyConversation(conversation))
  const pinned = visible.filter((conversation) => pinnedSet.has(conversation.id))
  const unpinned = visible.filter((conversation) => !pinnedSet.has(conversation.id))
  const workspaces = unpinned.filter((conversation) => conversation.scope === 'workspace')
  const workspaceIds = new Set(workspaces.map((conversation) => conversation.id))
  const agents = unpinned.filter((conversation) => !workspaceIds.has(conversation.id) && isAgentConversation(conversation))
  const agentIds = new Set(agents.map((conversation) => conversation.id))
  const recent = unpinned.filter((conversation) => !workspaceIds.has(conversation.id) && !agentIds.has(conversation.id))

  return [
    { id: 'pinned', label: 'Pinned', conversations: pinned },
    { id: 'workspaces', label: 'Workspaces', conversations: workspaces },
    { id: 'agents', label: 'Agents', conversations: agents },
    { id: 'recent', label: 'Recent', conversations: recent },
  ].filter((section) => section.conversations.length > 0)
}

function buildHermesCompanyGroups(
  conversations: Conversation[],
  filter: string,
) {
  const groups = new Map<string, { id: string; name: string; conversations: Conversation[] }>()
  for (const conversation of conversations) {
    if (conversation.archived) continue
    const company = conversationCompanyIdentity(conversation)
    if (!company) continue
    const group = groups.get(company.id) ?? { ...company, conversations: [] }
    group.conversations.push(conversation)
    groups.set(company.id, group)
  }

  const query = filter.trim().toLocaleLowerCase()
  if (!query) return Array.from(groups.values())
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

function buildHermesProjectGroups(
  conversations: Conversation[],
  projects: WorkspaceProjectSummary[],
  filter: string,
) {
  const groups = new Map<string, { id: string; name: string; locations?: WorkspaceProjectLocationSummary[]; conversations: Conversation[] }>()
  for (const project of projects) {
    groups.set(project.id, {
      id: project.id,
      name: project.name,
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
  if (
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('networkerror') ||
    lower.includes('err_access_denied') ||
    lower.includes('authentication required') ||
    lower.includes('deployment protection')
  ) {
    return `Upload blocked before the app could receive ${fileName}. This usually means the preview deployment is protected or the request was blocked by the browser. Open the logged-in production app or use an approved preview bypass, then try again.`
  }
  return raw || `Upload failed: ${fileName}`
}

export function shouldStopFinalizePollingForStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404
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
  allowManageConversationAccess = false,
  allowAgentParticipants = true,
  allowStartConversations = true,
  allowSendMessages = true,
  allowArchiveConversations = true,
  currentPageContext,
  preferCurrentPageContext = false,
  onContextActionResolved,
  compact = false,
  layoutVariant = 'classic',
  activeConversationId,
  onActiveConversationChange,
  onConversationsChange,
  showConversationList = true,
  conversationRailMode = 'expanded',
  onConversationRailModeChange,
  onContextCanvasPresentationChange,
}: UnifiedChatProps) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [uncontrolledActiveId, setUncontrolledActiveId] = useState<string | null>(null)
  const activeId = activeConversationId === undefined ? uncontrolledActiveId : activeConversationId
  const activeConversationIdRef = useRef(activeId)
  activeConversationIdRef.current = activeId
  const setActiveId = useCallback((value: string | null) => {
    if (activeConversationId === undefined) setUncontrolledActiveId(value)
    onActiveConversationChange?.(value)
  }, [activeConversationId, onActiveConversationChange])
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [contextCanvasOpen, setContextCanvasOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextRefs, setContextRefs] = useState<ContextReference[]>([])
  const [contextMention, setContextMention] = useState<ActiveContextMention | null>(null)
  const [contextTypePrompt, setContextTypePrompt] = useState<ActiveContextTypePrompt | null>(null)
  const [slashPrompt, setSlashPrompt] = useState<ActiveSlashCommandPrompt | null>(null)
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<SlashCommandDefinition | null>(null)
  const [contextSearchResults, setContextSearchResults] = useState<ContextReference[]>([])
  const [contextSearchLoading, setContextSearchLoading] = useState(false)
  const [contextPickerActiveIndex, setContextPickerActiveIndex] = useState(0)
  const [agentEffort, setAgentEffort] = useState<AgentEffort | ''>('')
  const [modelCatalog, setModelCatalog] = useState<MessageModelCatalog | null>(null)
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false)
  const [selectedRuntime, setSelectedRuntime] = useState<ModelRuntimeSelection | null>(null)
  const [composerHistory, setComposerHistory] = useState<string[]>([])
  const [historyCursor, setHistoryCursor] = useState<number | null>(null)
  const [queuedDraftsByConversation, setQueuedDraftsByConversation] = useState<Record<string, QueuedComposerDraft[]>>({})
  const [executionDockRequest, setExecutionDockRequest] = useState(0)
  const [contextArtifactRequest, setContextArtifactRequest] = useState<{ id: string; nonce: number }>()
  const [pinnedConversationIds, setPinnedConversationIds] = useState<string[]>(() => readPinnedConversationIds(orgId))
  const [expandedSessionGroupKeys, setExpandedSessionGroupKeys] = useState<string[]>(() => readExpandedSessionGroupKeys(orgId))

  useEffect(() => {
    onConversationsChange?.(conversations)
  }, [conversations, onConversationsChange])

  // Agent map for looking up colorKey / iconKey for bubbles
  const [agentMap, setAgentMap] = useState<Record<AgentId, AgentTeamDoc>>({} as Record<AgentId, AgentTeamDoc>)

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
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [accessConversation, setAccessConversation] = useState<Conversation | null>(null)

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameCancelledRef = useRef(false)

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newParticipants, setNewParticipants] = useState<SelectedParticipant[]>([])
  const [newScope, setNewScope] = useState<ConversationScope>(
    scope ?? (projectId ? 'project' : 'general'),
  )
  const [workspaces, setWorkspaces] = useState<OrgWorkspaceSummary[]>([])
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectSummary[]>([])
  const [workspaceRuntimeTargetsByWorkspace, setWorkspaceRuntimeTargetsByWorkspace] = useState<Record<string, WorkspaceRuntimePresence[]>>({})
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [workspaceCatalogueLoaded, setWorkspaceCatalogueLoaded] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '')
  const [selectedCompanyId, setSelectedCompanyId] = useState('')
  const [selectedCompanyName, setSelectedCompanyName] = useState('')
  const [selectedWorkspaceRuntime, setSelectedWorkspaceRuntime] = useState<string>('')
  const workspaceRuntimeExplicitRef = useRef(false)
  const [selectedWorkspaceShareMode, setSelectedWorkspaceShareMode] = useState<'private' | 'shared' | 'org'>('private')
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
  const [draggingAttachments, setDraggingAttachments] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentInputId = useId()
  const contextPickerPanelId = useId()

  // Mobile pane navigation: which pane is visible on small screens
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation'>(initialConvId ? 'conversation' : 'list')
  const [sessionsOverlayViewport, setSessionsOverlayViewport] = useState(false)
  const [tabletSessionsDrawer, setTabletSessionsDrawer] = useState(false)

  // Mobile header "…" menu
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
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
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
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
    () => conversations.find((conversation) => {
      if (conversation.id !== activeId) return false
      const project = conversationProjectIdentity(conversation)
      return layoutVariant !== 'hermes' || compact || !project || linkedProjectIds.has(project.id)
    }) ?? null,
    [conversations, activeId, compact, layoutVariant, linkedProjectIds],
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
    false,
  )
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
      message.role === 'assistant' && (
        message.status === 'pending' ||
        message.status === 'streaming' ||
        message.status === 'waiting_approval' ||
        Boolean(message.runId)
      ),
    ) ?? null
  }, [messages])
  const activeRuntimeEvents = activeRuntimeMessage ? (liveEvents[activeRuntimeMessage.id] ?? []) : []
  const hasInFlightAgentRun = useMemo(
    () => messages.some((message) =>
      message.role === 'assistant' && (
        message.status === 'pending' ||
        message.status === 'streaming' ||
        message.status === 'waiting_approval'
      ),
    ),
    [messages],
  )
  const activeQueuedDrafts = activeId ? (queuedDraftsByConversation[activeId] ?? []) : []
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId],
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
      if (newScope !== 'project') return catalogue
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
    },
    [newScope, selectedWorkspaceId, selectedWorkspaceProject, workspaceRuntimeTargetsByWorkspace],
  )
  const selectedWorkspaceRuntimeIsValid = workspaceRuntimeTargets.some(runtime => runtime.id === selectedWorkspaceRuntime && runtime.selectable)
  useEffect(() => {
    if (workspaceRuntimeTargets.length === 0) {
      if (newScope === 'project' && selectedWorkspaceRuntime) {
        workspaceRuntimeExplicitRef.current = false
        setSelectedWorkspaceRuntime('')
      }
      return
    }
    if (!workspaceRuntimeExplicitRef.current && !workspaceRuntimeTargets.some((runtime) => runtime.id === selectedWorkspaceRuntime && runtime.selectable)) {
      setSelectedWorkspaceRuntime(workspaceRuntimeTargets.find((runtime) => runtime.selectable)?.id ?? '')
    }
  }, [newScope, selectedWorkspaceRuntime, workspaceRuntimeTargets])
  const projectLocationOptions = useMemo<ProjectLocationOption[]>(() => workspaces.flatMap((workspace) => (
    workspaceRuntimeTargetsByWorkspace[workspace.workspaceId] ?? []
  ).map((runtime) => ({
    key: `${workspace.workspaceId}:${runtime.id}`,
    runtimeTargetId: runtime.id,
    locationId: projectRuntimeLocationId(runtime),
    ...(runtime.mappingId ? { mappingId: runtime.mappingId } : {}),
    workspaceId: workspace.workspaceId,
    workspaceLabel: workspace.orgName,
    label: projectRuntimeLabel(runtime),
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
        key: `${runtimeWorkspaceId}:${locationId}`,
        runtimeTargetId: runtime.id,
        locationId,
        ...(runtime.mappingId ? { mappingId: runtime.mappingId } : {}),
        workspaceId: runtimeWorkspaceId,
        workspaceLabel: workspace.orgName,
        label: projectRuntimeLabel(runtime),
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
  const activeRuntimeLabel = activeWorkspaceContext?.runtimeLabel
    ?? (activeWorkspaceContext?.runtimeTarget === 'local'
      ? 'Local'
      : activeWorkspaceContext?.runtimeTarget === 'vps'
        ? 'VPS'
        : activeWorkspaceContext?.runtimeTarget)
  const activeRuntimePresence = activeWorkspaceContext
    ? (workspaceRuntimeTargetsByWorkspace[activeWorkspaceContext.workspaceId] ?? []).find(
        runtime => runtime.id === activeWorkspaceContext.runtimeTarget
          || runtime.legacyRuntimeTargetIds?.includes(activeWorkspaceContext.runtimeTarget),
      )
    : undefined
  const unavailableActiveRuntime = useMemo(
    () => activeWorkspaceContext && workspaceCatalogueLoaded && (!activeRuntimePresence || !activeRuntimePresence.selectable)
      ? {
          label: activeRuntimePresence?.label || activeRuntimeLabel || 'This computer',
          offline: !activeRuntimePresence || !activeRuntimePresence.isFresh || !activeRuntimePresence.isHealthy,
        }
      : undefined,
    [activeRuntimeLabel, activeRuntimePresence, activeWorkspaceContext, workspaceCatalogueLoaded],
  )
  const canUseComposer = allowSendMessages && (Boolean(activeConversation) || allowStartConversations) && !unavailableActiveRuntime
  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => {
      if (conversation.archived) return false
      const project = conversationProjectIdentity(conversation)
      return layoutVariant !== 'hermes' || compact || !project || linkedProjectIds.has(project.id)
    }),
    [compact, conversations, layoutVariant, linkedProjectIds],
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
    () => buildHermesCompanyGroups(visibleConversations, conversationFilter),
    [conversationFilter, visibleConversations],
  )
  const hermesProjectGroups = useMemo(
    () => buildHermesProjectGroups(visibleConversations, workspaceProjects, conversationFilter),
    [conversationFilter, visibleConversations, workspaceProjects],
  )
  const hasHermesRailItems = hermesCompanyGroups.length > 0 || hermesProjectGroups.length > 0 || hermesSessionSections.length > 0
  useEffect(() => {
    if (!activeId || layoutVariant !== 'hermes') return
    const company = hermesCompanyGroups.find((group) => group.conversations.some((conversation) => conversation.id === activeId))
    const project = hermesProjectGroups.find((group) => group.conversations.some((conversation) => conversation.id === activeId))
    const groupKey = company ? `company:${company.id}` : project ? `project:${project.id}` : null
    if (!groupKey) return
    setExpandedSessionGroupKeys((current) => {
      if (current.includes(groupKey)) return current
      const next = [...current, groupKey]
      writeExpandedSessionGroupKeys(orgId, next)
      return next
    })
  }, [activeId, hermesCompanyGroups, hermesProjectGroups, layoutVariant, orgId])
  const menuConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === menuOpenId) ?? null,
    [conversations, menuOpenId],
  )
  const contextTypeOptions = useMemo(
    () => (contextTypePrompt ? filterContextReferenceMentionOptions(contextTypePrompt.query) : []),
    [contextTypePrompt],
  )
  const contextPickerOpen = Boolean(contextTypePrompt || contextMention)
  const contextPickerOptionCount = contextTypePrompt
    ? contextTypeOptions.length
    : contextMention && !contextSearchLoading
      ? contextSearchResults.length
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
  const slashCommandOptions = useMemo(
    () => (slashPrompt ? filterSlashCommands(slashPrompt.query) : []),
    [slashPrompt],
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
    return params.toString()
  }, [orgId, projectId, scope, scopeRefId])

  // ── Load agents (for colorKey lookup) ─────────────────────────────────────
  useEffect(() => {
    fetch(`/api/v1/orgs/${orgId}/visible-agents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body?.data) return
        const map = {} as Record<AgentId, AgentTeamDoc>
        for (const agent of body.data as AgentTeamDoc[]) {
          map[agent.agentId] = agent
        }
        setAgentMap(map)
      })
      .catch(() => {})
  }, [orgId])

  useEffect(() => {
    let cancelled = false
    let hasLoaded = false
    setWorkspaceCatalogueLoaded(false)

    const loadWorkspaceCatalogue = async (showLoading: boolean): Promise<WorkspaceCatalogueSnapshot | null> => {
      if (showLoading) setWorkspacesLoading(true)
      try {
        const response = await fetch(`/api/v1/workspaces?${new URLSearchParams({
          orgId,
          agentId: workspaceCatalogueAgentId,
        }).toString()}`)
        const body = response.ok ? await response.json() : null
        if (cancelled || !body?.data) return null
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
        setWorkspaceCatalogueLoaded(true)
        const initialWorkspaceId = next[0]?.workspaceId || ''
        setSelectedWorkspaceId((current) => current || initialWorkspaceId)
        setSelectedProjectId((current) => current || projectId || projects[0]?.id || '')
        setSelectedWorkspaceRuntime((current) => {
          if (workspaceRuntimeExplicitRef.current) return current
          const initialRuntimes = runtimeTargetsByWorkspace[initialWorkspaceId] ?? runtimes
          const currentTarget = initialRuntimes.find((runtime) => runtime.id === current)
          if (currentTarget?.selectable) return current
          return initialRuntimes.find((runtime) => runtime.selectable)?.id ?? ''
        })
        return snapshot
      } catch {
        if (!cancelled && !hasLoaded) {
          setWorkspaces([])
          setWorkspaceProjects([])
          setWorkspaceRuntimeTargetsByWorkspace({})
        }
        return null
      } finally {
        if (!cancelled && showLoading) setWorkspacesLoading(false)
      }
    }

    refreshWorkspaceCatalogueRef.current = () => loadWorkspaceCatalogue(false)
    void loadWorkspaceCatalogue(true)
    const interval = window.setInterval(() => {
      void loadWorkspaceCatalogue(false)
    }, WORKSPACE_CATALOGUE_REFRESH_INTERVAL)
    return () => {
      cancelled = true
      refreshWorkspaceCatalogueRef.current = async () => null
      window.clearInterval(interval)
    }
  }, [orgId, projectId, workspaceCatalogueAgentId])

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
    if (forProjectId) {
      setNewScope('project')
      setSelectedProjectId(forProjectId)
    }
    setShowNewModal(true)
  }, [allowStartConversations])

  const openNewCompanyConversation = useCallback((companyId: string, companyName: string) => {
    if (!allowStartConversations) {
      setError('Starting new conversations is disabled for your organisation role.')
      return
    }
    setNewScope('company')
    setSelectedCompanyId(companyId)
    setSelectedCompanyName(companyName)
    setShowNewModal(true)
  }, [allowStartConversations])

  const closeNewConversation = useCallback(() => {
    setShowNewModal(false)
    setShowProjectSetupWizard(false)
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
    setNewScope('project')
    setShowNewModal(true)
    openProjectSetupWizard()
  }, [allowStartConversations, openProjectSetupWizard])

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
        if (previous && catalog.models.some((model) => model.model === previous.model && model.provider === previous.provider)) {
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
        setActiveId(preferred ? initialConvId! : relatedId ?? (preferCurrentPageContext ? null : nextList[0].id))
      } else if (
        !activeId &&
        nextList.length === 0 &&
        autoCreateScopedConversation &&
        allowStartConversations &&
        initialAgentId &&
        scope &&
        scopeRefId &&
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
      setError(e instanceof Error ? e.message : 'Failed to load conversations')
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
    setActiveId,
  ])

  // ── Load messages ─────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (convId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
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
      setMessages(body.data?.messages ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => { loadConversations() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeId) loadMessages(activeId)
  }, [activeId, loadMessages])

  useEffect(() => {
    setContextRefs((activeConversation?.contextRefs ?? []).map(coerceContextRef))
  }, [activeConversation?.id, activeConversation?.contextRefs, coerceContextRef])

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
      setContextSearchLoading(false)
      return
    }

    const controller = new AbortController()
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
    fetch(`/api/v1/context-references/search?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body?.data?.refs) {
          setContextSearchResults([])
          return
        }
        setContextSearchResults((body.data.refs as ContextReference[]).map(coerceContextRef))
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setContextSearchResults([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextSearchLoading(false)
      })

    return () => controller.abort()
  }, [contextMention, coerceContextRef, currentPageContext?.id, currentPageContext?.type, orgId])

  useEffect(() => {
    if (!activeId) return
    if ((activeConversation?.participantAgentIds?.length ?? 0) > 0) return

    const interval = window.setInterval(() => {
      void loadMessages(activeId, { silent: true })
    }, HUMAN_CHAT_REFRESH_INTERVAL)

    return () => window.clearInterval(interval)
  }, [activeConversation?.participantAgentIds?.length, activeId, loadMessages])

  // Auto-scroll on new messages. Run after the browser has laid out the loaded
  // message list so returning to an existing chat lands at the latest message,
  // not at the top with a stale pre-layout scrollHeight.
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

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
  }, [messages])

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

  // Close header menu when switching conversations
  useEffect(() => { setHeaderMenuOpen(false) }, [activeId])

  // Cleanup polling + SSE on unmount
  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current)
    Object.values(eventSourcesRef.current).forEach((es) => es.close())
  }, [])

  // ── SSE event stream ─────────────────────────────────────────────────────
  const startEventStream = useCallback(
    (msgId: string, runId: string, agentId: AgentId) => {
      eventSourcesRef.current[msgId]?.close()
      const url = `/api/v1/admin/agents/${agentId}/runs/${encodeURIComponent(runId)}/events`
      const es = new EventSource(url)
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as ChatEvent
          setLiveEvents((prev) => ({
            ...prev,
            [msgId]: [...(prev[msgId] ?? []), data],
          }))
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
                  ? { ...m, status: 'streaming', content: `${m.content ?? ''}${data.delta}` }
                  : m,
              ),
            )
          }
        } catch { /* ignore parse errors */ }
      }
      es.onerror = () => {
        // SSE disconnects normally when run ends — just clean up
        es.close()
        delete eventSourcesRef.current[msgId]
      }
      eventSourcesRef.current[msgId] = es
    },
    [],
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
      if (attempts > MAX_RUN_POLL_ATTEMPTS) {
        closeEventStream(msgId)
        // Update the pending message to show a timeout notice without killing it
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, status: 'failed', error: 'Run timed out — the agent may still be working. Refresh to check.', content: '' }
              : m,
          ),
        )
        return
      }

      // Show elapsed time hint in the bubble after 30s
      if (attempts === 20) {
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
        const data = body.data as { status?: string } | undefined
        const status: string | undefined = data?.status

        if (!res.ok && shouldStopFinalizePollingForStatus(res.status)) {
          closeEventStream(msgId)
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
          return
        }

        // Retry transient non-2xx finalize API errors (e.g. 502 upstream), but do not retry terminal auth/not-found cases.
        if (!res.ok && status !== 'failed') {
          scheduleFinalizePoll(convId, msgId, runId, agentId, attempts)
          return
        }

        if (!status || status === 'running') {
          pollFailuresRef.current[msgId] = 0
          scheduleFinalizePoll(convId, msgId, runId, agentId, attempts)
          return
        }

        if (status === 'waiting_approval') {
          const lastEvent = events[events.length - 1]
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, status: 'waiting_approval', runId } : m)),
          )
          setApprovalPending((prev) => ({
            ...prev,
            [msgId]: { runId, agentId, toolName: lastEvent?.tool },
          }))
          return
        }

        // completed or failed — close stream and reload
        closeEventStream(msgId)
        await loadMessages(convId)
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
    },
    [loadMessages, loadConversations, closeEventStream, scheduleFinalizePoll],
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
        (m.status === 'pending' || m.status === 'streaming') &&
        m.runId &&
        !resumedRunsRef.current.has(m.id)
      ) {
        resumedRunsRef.current.add(m.id)
        const dispatchedAgentId = m.dispatchAgentId ?? m.authorId
        const agentId: AgentId = knownAgentIds.includes(dispatchedAgentId as AgentId)
          ? (dispatchedAgentId as AgentId)
          : 'pip'
        startEventStream(m.id, m.runId, agentId)
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
          startEventStream(msgId, pending.runId, pending.agentId)
          pollFinalize(activeId, msgId, pending.runId, pending.agentId)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Approval failed')
      }
    },
    [approvalPending, activeId, pollFinalize, startEventStream],
  )

  const handleUiAction = useCallback(
    async (message: ConversationMessage, action: ChatUiAction) => {
      const actionType = String(action.type).toLowerCase()
      if (actionType === 'open' || actionType === 'download' || actionType === 'copy') return

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
        const endpoint = typeof action.endpoint === 'string' && action.endpoint.startsWith('/api/')
          ? action.endpoint
          : `/api/v1/admin/agents/${agentId}/runs/${encodeURIComponent(runId)}/actions`
        const res = await fetch(endpoint, {
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
          startEventStream(message.id, runId, agentId)
          pollFinalize(activeId, message.id, runId, agentId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    },
    [activeId, initialAgentId, pollFinalize, startEventStream],
  )

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
    return true
  }, [activeId, composerHistory, contextMention, contextTypePrompt, focusComposerToEnd, historyCursor, input, orgId, slashPrompt, updateMentionFromComposer])

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
        requestAnimationFrame(() => composerRef.current?.focus())
      })
      .catch((err) => {
        if (activeConversationIdRef.current !== conversationIdAtSelection) return
        setError(err instanceof Error ? err.message : 'Failed to attach context')
      })
  }, [activeId, contextMention, input, patchContextRefs])

  const selectContextType = useCallback((option: ContextReferenceMentionOption) => {
    if (!contextTypePrompt) return
    const nextInput = replaceTypePromptToken(input, contextTypePrompt, option.namespace)
    const caret = contextTypePrompt.start + option.namespace.length + 2
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
    } else if (contextMention) {
      const ref = contextSearchResults[activeIndex]
      if (ref) selectMentionContext(ref)
    }
    return true
  }, [contextMention, contextPickerActiveIndex, contextPickerOpen, contextPickerOptionCount, contextSearchResults, contextTypeOptions, contextTypePrompt, selectContextType, selectMentionContext])

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

  // ── Stop agent run ───────────────────────────────────────────────────────
  const stopAgentRun = useCallback(
    async (convId: string, msgId: string) => {
      if (!allowDeleteConversations) return
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
    [allowDeleteConversations, closeEventStream, loadConversations, loadMessages],
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
      let availableLocation: { workspaceId: string; runtimeTargetId: string } | undefined
      for (const [workspaceId, targets] of Object.entries(refreshedTargets)) {
        const runtime = targets.find((candidate) => candidate.selectable && linkedLocationIds.includes(projectRuntimeLocationId(candidate)))
        if (runtime) {
          availableLocation = { workspaceId, runtimeTargetId: runtime.id }
          break
        }
      }
      if (availableLocation) {
        workspaceRuntimeExplicitRef.current = true
        setSelectedWorkspaceId(availableLocation.workspaceId)
        setSelectedWorkspaceRuntime(availableLocation.runtimeTargetId)
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
      setError('Starting new conversations is disabled for your organisation role.')
      return
    }
    if ((newScope === 'workspace' || newScope === 'company' || newScope === 'project') && !selectedWorkspaceRuntimeIsValid) {
      setError('Select an available runtime for this Workspace before starting the conversation.')
      return
    }
    if (newScope === 'project' && projectSetupBlocksSession) {
      setError('This project does not yet have an available linked location.')
      return
    }
    setCreatingConv(true)
    setError(null)
    try {
      const participants = newParticipants.map((p) =>
        p.kind === 'agent'
          ? { kind: 'agent' as const, agentId: p.agentId }
          : { kind: 'user' as const, uid: p.uid },
      )
      const payload: Record<string, unknown> = {
        orgId,
        participants,
      }
      if (newTitle.trim()) payload.title = newTitle.trim()
      if (newScope !== 'general') payload.scope = newScope
      if (newScope === 'workspace') {
        if (!selectedWorkspaceId) throw new Error('Select a Workspace before starting a Workspace chat.')
        payload.workspaceId = selectedWorkspaceId
        payload.runtimeTarget = selectedWorkspaceRuntime
        payload.shareMode = selectedWorkspaceShareMode
      }
      if (newScope === 'company') {
        if (!selectedCompanyId) throw new Error('Select a company before starting a company Cowork chat.')
        if (!selectedWorkspaceId) throw new Error('No organisation runtime Workspace is available for this company.')
        payload.scopeRefId = selectedCompanyId
        payload.workspaceId = selectedWorkspaceId
        payload.runtimeTarget = selectedWorkspaceRuntime
        payload.shareMode = selectedWorkspaceShareMode
      }
      if (newScope === 'project') {
        if (!selectedProjectId) throw new Error('Select a project before starting a project chat.')
        if (!selectedWorkspaceId) throw new Error('No organisation Workspace is available for this project.')
        payload.scopeRefId = selectedProjectId
        payload.workspaceId = selectedWorkspaceId
        payload.runtimeTarget = selectedWorkspaceRuntime
        payload.shareMode = selectedWorkspaceShareMode
      }
      if (newScope === scope && scopeRefId) payload.scopeRefId = scopeRefId
      if (newScope === 'project' && projectId && !payload.scopeRefId) payload.scopeRefId = projectId
      if (contextRefs.length > 0) payload.contextRefs = contextRefs

      const res = await fetch('/api/v1/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body.error ?? `create conversation: ${res.status}`)
      }
      const conv: Conversation = body.data?.conversation
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      setMobilePane('conversation')
      setMessages([])
      setShowNewModal(false)
      setShowProjectSetupWizard(false)
      setNewTitle('')
      setNewParticipants([])
      setNewScope(scope ?? (projectId ? 'project' : 'general'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create conversation')
    } finally {
      setCreatingConv(false)
    }
  }, [allowStartConversations, creatingConv, newParticipants, newTitle, newScope, orgId, projectId, projectSetupBlocksSession, scope, scopeRefId, contextRefs, selectedWorkspaceId, selectedWorkspaceRuntime, selectedWorkspaceRuntimeIsValid, selectedWorkspaceShareMode, selectedProjectId, selectedCompanyId, setActiveId])

  const send = useCallback(
    async (e: FormEvent) => {

	      e.preventDefault()
	      if (!input.trim() && attachments.length === 0) return
	      if (sending) return
	      if (!allowSendMessages) {
	        setError('Replies are disabled for your organisation role.')
	        return
	      }
	      if (unavailableActiveRuntime) {
	        setError('Computer unavailable')
	        return
	      }
	      if (hasInFlightAgentRun) {
	        queueCurrentComposerDraft()
	        return
	      }
	      setError(null)
      setSending(true)
      let convId = activeId

      try {
        const currentPageCommand = extractCurrentPageContextCommand(input)
        const parsedSlashCommand = parseLeadingSlashCommand(input)
        const activeSlashCommand = selectedSlashCommand ?? parsedSlashCommand?.command ?? null
        const slashArgs = parsedSlashCommand?.args ?? ''
        const slashPayload: SlashCommandPayload | null = activeSlashCommand
          ? buildSlashCommandPayload(activeSlashCommand, slashArgs)
          : null
        const shouldUseCurrentPage =
          currentPageCommand.shouldUseCurrentPage || activeSlashCommand?.id === 'use-current-page'
        const messageText = currentPageCommand.shouldUseCurrentPage
          ? currentPageCommand.content
          : activeSlashCommand?.id === 'use-current-page'
            ? slashArgs
            : activeSlashCommand
              ? slashArgs || activeSlashCommand.description
              : input
        let refsForSend = preferCurrentPageContext && currentPageContext && !convId
          ? [coerceContextRef(currentPageContext)]
          : contextRefs
        if (shouldUseCurrentPage) {
          refsForSend = await pinCurrentPageContext()
          if (!messageText.trim() && attachments.length === 0) {
            setInput('')
            setContextMention(null)
            setContextTypePrompt(null)
            setSlashPrompt(null)
            setSelectedSlashCommand(null)
            return
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
          if (scope) payload.scope = scope
          if (scopeRefId) payload.scopeRefId = scopeRefId
          if (refsForSend.length > 0) payload.contextRefs = refsForSend
          const r = await fetch('/api/v1/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const b = await r.json()
          convId = b.data?.conversation?.id as string | undefined ?? null
          if (!convId) throw new Error('Failed to create conversation')
          createdWithAgent = participants.length > 0
          setConversations((prev) => [b.data.conversation, ...prev])
          setActiveId(convId)
          setMobilePane('conversation')
        }

        const uploadedAttachments = attachments.length > 0
          ? await Promise.all(attachments.map((file) => uploadConversationAttachment(convId!, file)))
          : []

        // Build content: keep file names in the text preview, store URLs separately.
        let content = messageText
        if (uploadedAttachments.length > 0) {
          const attNote = uploadedAttachments
            .map((attachment) => `Attachment: ${attachment.name} (${(attachment.sizeBytes / 1024).toFixed(1)} KB)`)
            .join('\n')
          content = content.trim() ? `${content}\n\n${attNote}` : attNote
        }
        rememberComposerPrompt(convId!, input)
        setInput('')
        setContextMention(null)
        setContextTypePrompt(null)
        setSlashPrompt(null)
        setSelectedSlashCommand(null)
        setContextSearchResults([])
        setAttachments([])
        const nowSec = Date.now() / 1000
        const shouldExpectAgentReply =
          createdWithAgent ||
          (activeConversation?.participantAgentIds?.length ?? 0) > 0
        const runtimeForSend = modelCatalog?.canSelect && selectedRuntime?.model ? selectedRuntime : null

        // Optimistic messages
        const optimisticUser: ConversationMessage = {
          id: `tmp-user-${Date.now()}`,
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
              id: `tmp-assistant-${Date.now()}`,
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
        setMessages((prev) => [...prev, optimisticUser, ...optimisticAgent])

        const res = await fetch(`/api/v1/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            attachments: uploadedAttachments,
            contextRefs: refsForSend,
            ...(slashPayload ? { slashCommand: slashPayload } : {}),
            ...(agentEffort ? { agentEffort } : {}),
            ...(runtimeForSend?.model ? { model: runtimeForSend.model } : {}),
            ...(runtimeForSend?.provider ? { provider: runtimeForSend.provider } : {}),
          }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Send failed')

        const newAssistantId: string | undefined = body.data?.assistantMessage?.id
        const runId: string | undefined = body.data?.runId
        const runDocId: string | undefined = body.data?.runDocId
        const dispatchAgentId: AgentId | undefined = body.data?.dispatchAgentId

        // Reload real messages (replaces optimistic)
        await loadMessages(convId)

        if (newAssistantId && runId) {
          const agentParticipant = conversations
            .find((c) => c.id === convId)
            ?.participants.find((p) => p.kind === 'agent')
          const agentId: AgentId =
            dispatchAgentId ?? (agentParticipant?.kind === 'agent' ? agentParticipant.agentId : 'pip')
          void runDocId
          // Open SSE stream to receive live tool-call events
          startEventStream(newAssistantId, runId, agentId)
          pollFinalize(convId, newAssistantId, runId, agentId)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Send failed')
      } finally {
        setSending(false)
      }
    },
    [
      activeId,
      input,
      attachments,
      agentEffort,
      selectedRuntime,
      modelCatalog?.canSelect,
      sending,
      hasInFlightAgentRun,
      queueCurrentComposerDraft,
      rememberComposerPrompt,
      contextRefs,
      preferCurrentPageContext,
      currentPageContext,
      coerceContextRef,
      pinCurrentPageContext,
	      allowAgentParticipants,
	      allowStartConversations,
	      allowSendMessages,
	      unavailableActiveRuntime,
	      orgId,
      currentUserUid,
      currentUserDisplayName,
      scope,
      scopeRefId,
      loadMessages,
      pollFinalize,
      startEventStream,
      conversations,
      activeConversation?.participantAgentIds?.length,
      selectedSlashCommand,
      setActiveId,
    ],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  const scopeLabel = scope && scope !== 'general'
    ? scope.charAt(0).toUpperCase() + scope.slice(1)
    : 'Default'
  const subtitle = [orgName, scopeLabel].filter(Boolean).join(' · ')
  const availableConversationContexts = [
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
    allowDeleteConversations &&
    activeRuntimeMessage?.runId &&
    activeId &&
    (activeRuntimeMessage?.status === 'pending' ||
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
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={railCollapsed ? 'hidden' : 'contents'}>
        <div className="mb-1 flex min-h-11 items-center justify-between xl:hidden"><div><p className="text-[10px] font-label uppercase tracking-[0.2em] text-[var(--color-pib-text-muted)]">Messages</p><h2 className="text-base font-semibold text-[var(--color-pib-text)]">Browse sessions</h2></div>{activeConversation && <button ref={mobileSessionsCloseRef} type="button" aria-label="Close sessions" onClick={closeSessions} className="grid h-11 w-11 place-items-center rounded-full text-[var(--color-pib-text-muted)] hover:bg-white/[0.07]"><span aria-hidden="true" className="material-symbols-outlined">close</span></button>}</div>
        <button
          type="button"
          onClick={() => openNewConversation()}
          disabled={!allowStartConversations}
          className={hermesLayout
            ? 'flex h-11 items-center justify-center gap-1.5 rounded-md border border-[var(--color-card-border)] bg-white/[0.05] px-2 text-xs font-medium text-[var(--color-pib-text)] hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 xl:h-8'
            : 'rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:opacity-90 flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45'}
        >
          <span className={`material-symbols-outlined ${hermesLayout ? 'text-[14px]' : 'text-[16px]'}`} aria-hidden="true">add</span>
          New conversation
        </button>

        {hermesLayout && (
          <button
            type="button"
            aria-label="Create new project"
            onClick={openNewProject}
            disabled={!allowStartConversations}
            className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-45 xl:h-9"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">create_new_folder</span>
            New project
          </button>
        )}

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
              <div className="mb-1 flex items-center justify-between px-1 text-xs font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
                <span>Cowork folders</span>
                <span className="font-mono text-xs tracking-normal text-[var(--color-pib-text-muted)]/55">{hermesCompanyGroups.length}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                {hermesCompanyGroups.map((company) => {
                  const groupKey = `company:${company.id}`
                  const sessionsExpanded = Boolean(conversationFilter.trim()) || expandedSessionGroupKeys.includes(groupKey)
                  const sessionsRegionId = `company-sessions-${company.id}`
                  return (
                    <div
                      key={company.id}
                      data-testid={`hermes-company-${company.id}`}
                      className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] p-1"
                    >
                    <div className="flex min-w-0 items-center gap-1 px-1 py-1">
                      <button
                        type="button"
                        aria-expanded={sessionsExpanded}
                        aria-controls={sessionsRegionId}
                        aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} sessions for ${company.name}`}
                        onClick={() => toggleSessionGroup(groupKey)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0"
                      >
                        <span className="material-symbols-outlined shrink-0 text-[16px] text-primary" aria-hidden="true">folder</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-pib-text)]">{company.name}</span>
                        <span className="font-mono text-xs text-[var(--color-pib-text-muted)]/70">{company.conversations.length}</span>
                        <span className="material-symbols-outlined shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                          {sessionsExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Start session in ${company.name}`}
                        title={`Start session in ${company.name}`}
                        disabled={!allowStartConversations}
                        onClick={() => openNewCompanyConversation(company.id, company.name)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 xl:h-8 xl:w-8"
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                      </button>
                    </div>
                    {sessionsExpanded && <div id={sessionsRegionId} className="ml-2 flex min-w-0 flex-col gap-0.5 border-l border-white/[0.06] pl-1">
                      {company.conversations.map((c) => (
                        <div key={c.id} className="relative group/conv">
                          {renamingId === c.id ? (
                            <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                              <input
                                autoFocus
                                value={renameValue}
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
                                if (menuOpenId === c.id) {
                                  setMenuOpenId(null)
                                  setMenuPosition(null)
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setMenuPosition({ top: rect.bottom + 4, left: rect.right - 176 })
                                  setMenuOpenId(c.id)
                                }
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
              <div className="mb-1 flex items-center justify-between px-1 text-xs font-label uppercase tracking-[0.16em] text-[var(--color-pib-text-muted)]/75">
                <span>Projects</span>
                <span className="font-mono text-xs tracking-normal text-[var(--color-pib-text-muted)]/55">{hermesProjectGroups.length}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                {hermesProjectGroups.map((project) => {
                  const groupKey = `project:${project.id}`
                  const sessionsExpanded = Boolean(conversationFilter.trim()) || expandedSessionGroupKeys.includes(groupKey)
                  const sessionsRegionId = `project-sessions-${project.id}`
                  return (
                    <div
                      key={project.id}
                      data-testid={`hermes-project-${project.id}`}
                      className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.025] p-1"
                    >
                    <div className="flex min-w-0 items-center gap-1 px-1 py-1">
                      <button
                        type="button"
                        aria-expanded={sessionsExpanded}
                        aria-controls={sessionsRegionId}
                        aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} sessions for ${project.name}`}
                        onClick={() => toggleSessionGroup(groupKey)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0"
                      >
                        <span className="material-symbols-outlined shrink-0 text-[16px] text-primary" aria-hidden="true">folder_managed</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-pib-text)]">{project.name}</span>
                        <span className="font-mono text-xs text-[var(--color-pib-text-muted)]/70">{project.conversations.length}</span>
                        <span className="material-symbols-outlined shrink-0 text-[16px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                          {sessionsExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Manage locations for ${project.name}`}
                        title={`Manage locations for ${project.name}`}
                        onClick={() => managedProject?.id === project.id
                          ? setManagedProject(null)
                          : openProjectLocationManager({ id: project.id, name: project.name })}
                        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8 xl:w-8 ${managedProject?.id === project.id ? 'bg-white/[0.08] text-primary' : 'text-[var(--color-pib-text-muted)]'}`}
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">devices</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Start session for ${project.name}`}
                        title={`Start session for ${project.name}`}
                        disabled={!allowStartConversations}
                        onClick={() => openNewConversation(project.id)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-40 xl:h-8 xl:w-8"
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Link client organisation to ${project.name}`}
                        title={`Link client organisation to ${project.name}`}
                        onClick={() => setAccessProject({ id: project.id, name: project.name })}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8 xl:w-8"
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">group_add</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${project.name} from my projects`}
                        title={`Remove ${project.name} from my projects`}
                        onClick={() => void removeProjectFromSidebar(project.id)}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-red-200 focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-8 xl:w-8"
                      >
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">remove</span>
                      </button>
                    </div>
                    {(project.locations?.length ?? 0) > 0 && (
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
                              <span className="truncate">
                                {machineType} · {location.label} · {runtimeStatus}
                              </span>
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
                                {managedProjectLocations.map((location) => (
                                  <div key={location.replicaId} className="flex min-w-0 flex-wrap items-center gap-1 rounded border border-white/[0.06] px-2 py-2 text-xs">
                                    <span className="min-w-0 flex-1 truncate text-[var(--color-pib-text)]">
                                      {location.label} · {!location.authenticatedRuntime
                                        ? 'Pairing required'
                                        : location.availability === 'online' ? 'online' : 'Computer unavailable'}
                                    </span>
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
                                ))}
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
                                managedUnlinkedLocationCandidates.map((candidate) => (
                                  <label key={candidate.key} className="flex min-h-11 min-w-0 items-center gap-2 rounded border border-white/[0.06] px-2 py-2 text-xs text-[var(--color-pib-text)] xl:min-h-0">
                                    <input
                                      type="checkbox"
                                      aria-label={`${candidate.label} · ${candidate.selectable ? 'online' : 'Computer unavailable'}`}
                                      checked={selectedManagedProjectLocationKeys.includes(candidate.key)}
                                      disabled={!candidate.selectable || projectLocationsMutating}
                                      onChange={(event) => setSelectedManagedProjectLocationKeys((current) => event.target.checked
                                        ? [...current, candidate.key]
                                        : current.filter((key) => key !== candidate.key))}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                                    <span className={candidate.selectable ? 'text-emerald-200' : 'text-amber-100'}>
                                      {candidate.selectable ? 'Online' : 'Computer unavailable'}
                                    </span>
                                  </label>
                                ))
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
                      <div id={sessionsRegionId} className="ml-2 flex min-w-0 flex-col gap-0.5 border-l border-white/[0.06] pl-1">
                        {project.conversations.map((c) => (
                          <div key={c.id} className="relative group/conv">
                            {renamingId === c.id ? (
                              <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                                <input
                                  autoFocus
                                  value={renameValue}
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
                                  if (menuOpenId === c.id) {
                                    setMenuOpenId(null)
                                    setMenuPosition(null)
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setMenuPosition({ top: rect.bottom + 4, left: rect.right - 176 })
                                    setMenuOpenId(c.id)
                                  }
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
                            if (menuOpenId === c.id) {
                              setMenuOpenId(null)
                              setMenuPosition(null)
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setMenuPosition({ top: rect.bottom + 4, left: rect.right - 176 })
                              setMenuOpenId(c.id)
                            }
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
                      if (menuOpenId === c.id) {
                        setMenuOpenId(null)
                        setMenuPosition(null)
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setMenuPosition({ top: rect.bottom + 4, left: rect.right - 176 })
                        setMenuOpenId(c.id)
                      }
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

      {/* Context menu — rendered fixed to escape scroll container */}
      {menuOpenId && menuPosition && (
        <div
          data-conv-menu
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
          className="z-50 min-w-[176px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl"
        >
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] xl:min-h-0"
            onClick={() => openConversationInNewWindow(menuOpenId)}
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            Open in new window
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
          {menuConversation?.workspaceContext && (allowManageConversationAccess || (menuConversation.workspaceContext.ownerUserId ?? menuConversation.startedBy) === currentUserUid) && (
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
              Manage access
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
        <div className="shrink-0 min-w-0 border-b border-[var(--color-card-border)] px-3 py-2.5 lg:px-4 lg:py-3">
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

            {/* Title + subtitle */}
            <div className="flex-1 min-w-0">
              <div className="text-[var(--color-pib-text)] font-medium text-[15px] lg:text-sm truncate">
                {activeConversation?.title || 'New conversation'}
              </div>
              {subtitle && (
                <div className="lg:hidden text-[11px] text-[var(--color-pib-text-muted)] truncate mt-0.5">
                  {subtitle}
                </div>
              )}
            </div>

            {activeWorkspaceContext && activeRuntimeLabel && (
              <div
                className="hidden shrink-0 pib-pill pib-pill-blue !gap-1 lg:flex"
                title={`${activeWorkspaceContext.orgName} · ${activeRuntimeLabel}`}
              >
                <span className="material-symbols-outlined text-[13px]">folder_managed</span>
                {activeRuntimeLabel}
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

            {/* ⋯ menu — mobile only (rename/archive) */}
            {activeConversation && (
              <div className="lg:hidden relative shrink-0" data-header-menu>
                <button
                  type="button"
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  aria-label="Conversation options"
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
                    {activeConversation.workspaceContext && (allowManageConversationAccess || (activeConversation.workspaceContext.ownerUserId ?? activeConversation.startedBy) === currentUserUid) && (
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-[var(--color-pib-text)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                        onClick={() => {
                          setHeaderMenuOpen(false)
                          setAccessConversation(activeConversation)
                        }}
                      >
                        <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
                        Manage access
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

          {/* Participant bar — desktop only (kept) */}
          {activeConversation?.participants && activeConversation.participants.length > 0 && !compact && (
            <div className="hidden lg:block mt-1.5">
              <ParticipantBar participants={activeConversation.participants} agentDetails={agentMap} />
            </div>
          )}
        </div>

        {activeConversation && <ChatContextExperience context={chatContexts} compact={compact} artifactRequest={contextArtifactRequest} execution={runtimeExecution} executionRequest={executionDockRequest} onActionResolved={handleContextActionResolved} onOpenChange={setContextCanvasOpen} onPresentationChange={onContextCanvasPresentationChange} onAddContext={openContextPicker} contextPickerExpanded={Boolean(contextMention || contextTypePrompt)} contextPickerControls={contextPickerPanelId} onRemoveContext={(value) => {
          const ref = contextRefs.find((item) => item.type === value.kind && item.id === value.id)
          if (ref) removeContextRef(ref)
        }} />}

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          className={`flex-1 min-h-0 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden p-4 transition-[margin] duration-200 ${contextCanvasOpen ? 'lg:mr-[42%] xl:mr-[min(42%,560px)]' : ''}`}
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
                      allowDeleteConversations && isPending && m.runId && activeId
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
            <div className="font-semibold text-red-100">Computer unavailable</div>
            <div className="mt-0.5">
              {unavailableActiveRuntime.label} is {unavailableActiveRuntime.offline ? 'offline' : 'unavailable'}. This session remains linked to {unavailableActiveRuntime.label}. Try again when it is online.
            </div>
          </div>
        )}
        {error && (
          <div className="px-4 py-2 text-xs text-red-300 border-t border-red-500/30 bg-red-500/10">
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
          className={[
            hermesLayout
              ? 'shrink-0 min-w-0 flex flex-col gap-1.5 border-t border-[var(--color-card-border)] p-2 transition-[background-color,margin] duration-200'
              : 'shrink-0 min-w-0 flex flex-col gap-2 border-t border-[var(--color-card-border)] p-3 transition-[background-color,margin] duration-200',
            draggingAttachments ? 'bg-primary/10 ring-1 ring-primary/35' : '',
            contextCanvasOpen ? 'lg:mr-[42%] xl:mr-[min(42%,560px)]' : '',
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
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
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
            <div id={contextPickerPanelId} role="listbox" aria-label="Reference types" className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div role="presentation" className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                Reference types
              </div>
              {contextTypeOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">No matching reference types</div>
              ) : (
                contextTypeOptions.map((option, index) => (
                  <button
                    key={option.namespace}
                    id={`${contextPickerPanelId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === contextPickerActiveIndex}
                    tabIndex={-1}
                    aria-label={`Use @${option.namespace}:`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectContextType(option)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.06] ${index === contextPickerActiveIndex ? 'bg-white/[0.06]' : ''}`}
                  >
                    <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-text-muted)]">alternate_email</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{option.label}</span>
                      <span className="block truncate text-[11px] text-[var(--color-pib-text-muted)]">@{option.namespace}:</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {contextMention && (
            <div id={contextPickerPanelId} role="listbox" aria-label="Context references" className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div role="presentation" className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                @{contextMention.namespace}: references
              </div>
              {contextSearchLoading && (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">Searching…</div>
              )}
              {!contextSearchLoading && contextSearchResults.length === 0 && (
                <div className="px-2 py-2 text-xs text-[var(--color-pib-text-muted)]">No matching references</div>
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
                {hasInFlightAgentRun && <span>Will wait for this run</span>}
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
                if (e.key === 'Escape' && (contextMention || contextTypePrompt || slashPrompt)) {
                  e.preventDefault()
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
                unavailableActiveRuntime
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
                'min-h-[40px] max-h-[160px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] placeholder:text-[var(--color-pib-text-muted)] disabled:opacity-60 focus:outline-none',
                compact ? '' : hermesLayout ? 'lg:min-h-0 lg:px-2 lg:py-2 lg:text-sm' : 'lg:text-sm lg:rounded-lg lg:border lg:border-[var(--color-card-border)] lg:bg-[var(--color-card)] lg:px-3 lg:py-2 lg:min-h-0',
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
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2">
                  <span className="material-symbols-outlined text-[13px]">playlist_add</span>
                  {activeQueuedDrafts.length} queued
                </span>
                <span className="hidden h-6 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 sm:inline-flex">
                  <span className="material-symbols-outlined text-[13px]">shield_lock</span>
                  Ask approvals
                </span>
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
                {canStopActiveRun && activeRuntimeMessage?.id && activeId && (
                  <button
                    type="button"
                    onClick={() => stopAgentRun(activeId, activeRuntimeMessage.id)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-red-400/25 bg-red-500/10 px-2 text-[11px] font-medium text-red-200 hover:bg-red-500/15"
                  >
                    <span className="material-symbols-outlined text-[13px]">stop_circle</span>
                    Stop
                  </button>
                )}
                {runtimeExecution && <button
                  type="button"
                  data-testid="hermes-runtime-inspector-toggle"
                  aria-label="Open execution in context dock"
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
          className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
        >
            {/* Modal header */}
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

            {/* Modal body */}
            <div data-testid="new-conversation-scroll-body" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
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

              {/* Participant picker */}
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] block mb-1.5">
                  Participants (max 5)
                </label>
                <div className="sm:max-h-[300px] sm:overflow-y-auto">
                  <ParticipantPicker
                    orgId={orgId}
                    onSelect={setNewParticipants}
                    showAgents={allowAgentParticipants}
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] block mb-1.5">
                  Conversation context
                </label>
                <select
                  aria-label="Conversation context"
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value as ConversationScope)}
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                >
                  {availableConversationContexts.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {(newScope === 'workspace' || newScope === 'company' || newScope === 'project') && (
                <div className="grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:grid-cols-[minmax(0,1fr)_160px]">
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
                        value={selectedWorkspaceId}
                        onChange={(e) => { workspaceRuntimeExplicitRef.current = false; setSelectedWorkspaceId(e.target.value); setSelectedWorkspaceRuntime('') }}
                        disabled={workspacesLoading || workspaces.length === 0}
                        className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60 disabled:opacity-60"
                      >
                        {workspaces.length === 0 ? (
                          <option value="">{workspacesLoading ? 'Loading Workspaces…' : 'No Workspaces available'}</option>
                        ) : workspaces.map((workspace) => (
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
                  <div>
                    <label htmlFor="workspace-runtime" className="mb-1.5 block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Runtime
                    </label>
                    <select
                      id="workspace-runtime"
                      aria-label="Runtime"
                      value={selectedWorkspaceRuntime}
                      onChange={(e) => { workspaceRuntimeExplicitRef.current = true; setSelectedWorkspaceRuntime(e.target.value) }}
                      className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                    >
                      {!workspaceRuntimeTargets.some((runtime) => runtime.selectable || runtime.id === selectedWorkspaceRuntime) ? (
                        <option value="" disabled>{newScope === 'project'
                          ? workspaceRuntimeTargets.length > 0
                            ? 'No ready project computers available'
                            : 'No linked computers available'
                          : 'No computers available'}</option>
                      ) : workspaceRuntimeTargets
                        .filter((runtime) => runtime.selectable || runtime.id === selectedWorkspaceRuntime)
                        .map((runtime) => {
                          const status = runtime.isLocal
                            ? runtime.isFresh && runtime.isHealthy
                              ? runtime.ageSeconds != null
                                ? ` · online ${runtime.ageSeconds < 60 ? 'now' : `${Math.floor(runtime.ageSeconds / 60)}m ago`}`
                                : ' · online'
                              : ' · Computer unavailable'
                            : ''
                          return (
                            <option key={runtime.id} value={runtime.id} disabled={!runtime.selectable}>
                              {runtime.label}{status}
                            </option>
                          )
                        })}
                    </select>
                    {workspaceRuntimeExplicitRef.current && workspaceRuntimeTargets.some(runtime => runtime.id === selectedWorkspaceRuntime && !runtime.selectable) && (
                      <p role="alert" className="mt-2 text-xs text-red-300">
                        {workspaceRuntimeTargets.find(runtime => runtime.id === selectedWorkspaceRuntime)?.label ?? 'This computer'} is unavailable. Select another computer or try again when it is online.
                      </p>
                    )}
                    <div className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      Only healthy computers authorised for the current organisation can run files here.
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
                      Visibility
                    </label>
                    <select
                      value={selectedWorkspaceShareMode}
                      onChange={(e) => setSelectedWorkspaceShareMode(e.target.value as 'private' | 'shared' | 'org')}
                      className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-primary/60"
                    >
                      <option value="private">Private · only me</option>
                      <option value="shared">Shared · selected participants</option>
                      <option value="org">Organisation · all Workspace members</option>
                    </select>
                    <div className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      Private is the default. Organisation conversations are visible to every member with Workspace access.
                    </div>
                  </div>
                  {newScope === 'project' && showProjectSetupWizard && (
                    <section
                      role="region"
                      aria-label="New project"
                      className="space-y-3 rounded-lg border border-primary/25 bg-[var(--color-card)] p-3 sm:col-span-2"
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
                                disabled={workspaces.length === 0}
                                className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] px-3 py-2 text-sm outline-none focus:border-primary/60 disabled:opacity-60"
                              >
                                {workspaces.length === 0 ? <option value="">No mapped Workspaces</option> : workspaces.map((workspace) => (
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

              {error && (
                <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {error}
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
                {creatingConv ? 'Creating…' : 'Start conversation'}
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
