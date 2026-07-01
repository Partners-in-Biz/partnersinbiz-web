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
import VoiceInputButton from './VoiceInputButton'

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
  orgName?: string
  projectId?: string
  scope?: 'general' | 'project' | 'task' | 'campaign' | 'company' | 'contact'
  scopeRefId?: string
  initialConvId?: string
  initialAgentId?: AgentId
  autoCreateScopedConversation?: boolean
  autoCreateTitle?: string
  allowDeleteConversations?: boolean
  allowAgentParticipants?: boolean
  allowStartConversations?: boolean
  allowSendMessages?: boolean
  allowArchiveConversations?: boolean
  currentPageContext?: ContextReferenceSeed | null
  compact?: boolean
}

const POLL_INTERVAL = 1500
const MAX_RUN_POLL_ATTEMPTS = Math.ceil((90 * 60 * 1000) / POLL_INTERVAL)
const HUMAN_CHAT_REFRESH_INTERVAL = 3000
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_PENDING_ATTACHMENTS = 5
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

export default function UnifiedChat({
  orgId,
  currentUserUid,
  currentUserDisplayName,
  orgName,
  projectId,
  scope,
  scopeRefId,
  initialConvId,
  initialAgentId,
  autoCreateScopedConversation = false,
  autoCreateTitle,
  allowDeleteConversations = false,
  allowAgentParticipants = true,
  allowStartConversations = true,
  allowSendMessages = true,
  allowArchiveConversations = true,
  currentPageContext,
  compact = false,
}: UnifiedChatProps) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextRefs, setContextRefs] = useState<ContextReference[]>([])
  const [contextMention, setContextMention] = useState<ActiveContextMention | null>(null)
  const [contextTypePrompt, setContextTypePrompt] = useState<ActiveContextTypePrompt | null>(null)
  const [slashPrompt, setSlashPrompt] = useState<ActiveSlashCommandPrompt | null>(null)
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<SlashCommandDefinition | null>(null)
  const [contextSearchResults, setContextSearchResults] = useState<ContextReference[]>([])
  const [contextSearchLoading, setContextSearchLoading] = useState(false)
  const [agentEffort, setAgentEffort] = useState<AgentEffort | ''>('')

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

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameCancelledRef = useRef(false)

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newParticipants, setNewParticipants] = useState<SelectedParticipant[]>([])
  const [newScope, setNewScope] = useState<'general' | 'project' | 'task' | 'campaign' | 'company' | 'contact'>(
    scope ?? (projectId ? 'project' : 'general'),
  )
  const [creatingConv, setCreatingConv] = useState(false)

  // Attachment state
  const [attachments, setAttachments] = useState<File[]>([])
  const [draggingAttachments, setDraggingAttachments] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentInputId = useId()

  // Mobile pane navigation: which pane is visible on small screens
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation'>('list')

  // Mobile header "…" menu
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)

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
  // Tracks which assistant message IDs we've already started polling for (prevents duplicates)
  const resumedRunsRef = useRef<Set<string>>(new Set())
  const autoCreateRef = useRef(false)

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )
  const canUseComposer = allowSendMessages && (Boolean(activeConversation) || allowStartConversations)
  const contextTypeOptions = useMemo(
    () => (contextTypePrompt ? filterContextReferenceMentionOptions(contextTypePrompt.query) : []),
    [contextTypePrompt],
  )
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

  // ── Load conversations ────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/conversations?${listQuery}`)
      if (!res.ok) throw new Error(`load conversations: ${res.status}`)
      const body = await res.json()
      const list: Conversation[] = body.data?.conversations ?? []
      setConversations(list)
      if (!activeId && list.length) {
        const preferred = initialConvId && list.find((c) => c.id === initialConvId)
        setActiveId(preferred ? initialConvId! : list[0].id)
      } else if (
        !activeId &&
        list.length === 0 &&
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
    coerceContextRef,
  ])

  // ── Load messages ─────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (convId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    try {
      let res: Response
      try {
        res = await fetch(`/api/v1/conversations/${convId}/messages`)
      } catch {
        res = await fetch(`/api/v1/chat-feed/${convId}`)
      }
      if (!res.ok && (res.status === 404 || res.status === 403 || res.status >= 500)) {
        const fallback = await fetch(`/api/v1/chat-feed/${convId}`)
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

    const res = await fetch(`/api/v1/conversations/${activeId}/context`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, refs: localRefs }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error ?? `context update failed: ${res.status}`)
    const next = ((body?.data?.contextRefs ?? []) as ContextReference[]).map(coerceContextRef)
    setContextRefs(next)
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeId ? { ...conversation, contextRefs: next } : conversation,
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
    patchContextRefs('remove', [ref]).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to remove context')
    })
  }, [patchContextRefs])

  const selectMentionContext = useCallback((ref: ContextReference) => {
    patchContextRefs('add', [ref])
      .then(() => {
        if (contextMention) {
          setInput((prev) => removeMentionToken(prev, contextMention))
        }
        setContextMention(null)
        setContextTypePrompt(null)
        setContextSearchResults([])
        requestAnimationFrame(() => composerRef.current?.focus())
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to attach context')
      })
  }, [contextMention, patchContextRefs])

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
    [activeId, allowArchiveConversations],
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
    [activeId, allowDeleteConversations, conversations, loadConversations, loadMessages],
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
  const handleCreateConversation = useCallback(async () => {
    if (creatingConv) return
    if (!allowStartConversations) {
      setError('Starting new conversations is disabled for your organisation role.')
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
      if (newScope === scope && scopeRefId) payload.scopeRefId = scopeRefId
      if (newScope === 'project' && projectId) payload.scopeRefId = projectId
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
      setNewTitle('')
      setNewParticipants([])
      setNewScope(scope ?? (projectId ? 'project' : 'general'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create conversation')
    } finally {
      setCreatingConv(false)
    }
  }, [allowStartConversations, creatingConv, newParticipants, newTitle, newScope, orgId, projectId, scope, scopeRefId, contextRefs])

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(
    async (e: FormEvent) => {
	      e.preventDefault()
	      if ((!input.trim() && attachments.length === 0) || sending) return
	      if (!allowSendMessages) {
	        setError('Replies are disabled for your organisation role.')
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
        let refsForSend = contextRefs
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
      sending,
      contextRefs,
      pinCurrentPageContext,
	      allowAgentParticipants,
	      allowStartConversations,
	      allowSendMessages,
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
    ],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  const scopeLabel = scope && scope !== 'general'
    ? scope.charAt(0).toUpperCase() + scope.slice(1)
    : 'Default'
  const subtitle = [orgName, scopeLabel].filter(Boolean).join(' · ')
  const availableConversationContexts = [
    { value: 'general' as const, label: `Workspace-wide${orgName ? `: ${orgName}` : ''}` },
    ...(projectId ? [{ value: 'project' as const, label: `Current project: ${projectId}` }] : []),
    ...(scope && scope !== 'general' && scope !== 'project'
      ? [{ value: scope, label: `Current ${scope}: ${scopeRefId ?? 'selected item'}` }]
      : []),
  ]
  const showListOnMobile = mobilePane === 'list'

  return (
    <div
      className={
        compact
          ? 'flex h-full min-h-0 min-w-0 flex-1 overflow-hidden'
          : 'flex h-full min-h-0 min-w-0 flex-1 overflow-hidden lg:grid lg:gap-4 lg:grid-cols-[280px_1fr]'
      }
    >
      {/* ── Left: conversation list ─────────────────────────────────────── */}
      <aside
        className={[
          'pib-card min-h-0 min-w-0 flex-col gap-2 overflow-hidden flex-1 p-3',
          compact ? '!rounded-none !border-0 !bg-transparent' : 'lg:flex max-lg:!rounded-none max-lg:!border-0 max-lg:!bg-transparent',
          showListOnMobile ? 'flex' : 'hidden',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={() => {
            if (!allowStartConversations) {
              setError('Starting new conversations is disabled for your organisation role.')
              return
            }
            setShowNewModal(true)
          }}
          disabled={!allowStartConversations}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:opacity-90 flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New conversation
        </button>

        <div className="text-xs text-on-surface-variant mt-2 px-1">Conversations</div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {conversations.length === 0 && (
            <div className="text-xs text-on-surface-variant px-2 py-3">
              {allowStartConversations ? 'No conversations yet. Start one.' : 'No conversations yet.'}
            </div>
          )}
          {conversations.filter((c) => !c.archived).map((c) => (
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
                    className="flex-1 min-w-0 bg-transparent border-b border-primary text-sm text-on-surface outline-none"
                  />
                </div>
              ) : (
                <ConversationListItem
                  conversation={c}
                  active={c.id === activeId}
                  onClick={() => {
                    setActiveId(c.id)
                    setMobilePane('conversation')
                  }}
                  currentUserUid={currentUserUid}
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
                  className={`absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/conv:flex items-center justify-center w-6 h-6 rounded text-on-surface-variant hover:text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.08))] ${
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
      </aside>

      {/* Context menu — rendered fixed to escape scroll container */}
      {menuOpenId && menuPosition && (
        <div
          data-conv-menu
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
          className="z-50 min-w-[176px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl"
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
            onClick={() => openConversationInNewWindow(menuOpenId)}
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            Open in new window
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
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
          {allowArchiveConversations && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
              onClick={() => archiveConversation(menuOpenId)}
            >
              <span className="material-symbols-outlined text-[14px]">archive</span>
              Archive
            </button>
          )}
          {allowDeleteConversations && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
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
          'pib-card flex-col overflow-hidden min-h-0 min-w-0 flex-1',
          compact ? '!p-0 !rounded-none !border-0 !bg-transparent' : 'lg:flex max-lg:!p-0 max-lg:!rounded-none max-lg:!border-0 max-lg:!bg-transparent',
          showListOnMobile ? 'hidden' : 'flex',
        ].join(' ')}
      >
        {/* Header — mobile style (back / title+subtitle / ⋯) on small,
            keeps original sticky look on desktop */}
        <div className="shrink-0 min-w-0 border-b border-[var(--color-card-border)] px-3 py-2.5 lg:px-4 lg:py-3">
          <div className="flex items-center gap-2">
            {/* Back arrow — mobile only */}
            <button
              type="button"
              onClick={() => setMobilePane('list')}
              aria-label="Back to conversations"
              className={[
                '-ml-1 items-center justify-center w-9 h-9 rounded-full hover:bg-white/[0.06] active:bg-white/[0.1] text-on-surface-variant transition-colors shrink-0',
                compact ? 'flex' : 'lg:hidden flex',
              ].join(' ')}
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back_ios_new</span>
            </button>

            {/* Title + subtitle */}
            <div className="flex-1 min-w-0">
              <div className="text-on-surface font-medium text-[15px] lg:text-sm truncate">
                {activeConversation?.title || 'New conversation'}
              </div>
              {subtitle && (
                <div className="lg:hidden text-[11px] text-on-surface-variant truncate mt-0.5">
                  {subtitle}
                </div>
              )}
            </div>

            {/* ⋯ menu — mobile only (rename/archive) */}
            {activeConversation && (
              <div className="lg:hidden relative shrink-0" data-header-menu>
                <button
                  type="button"
                  onClick={() => setHeaderMenuOpen((v) => !v)}
                  aria-label="Conversation options"
                  className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/[0.06] active:bg-white/[0.1] text-on-surface-variant transition-colors"
                >
                  <span className="material-symbols-outlined text-[22px]">more_horiz</span>
                </button>
                {headerMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 min-w-[190px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl">
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
                      onClick={() => openConversationInNewWindow(activeConversation.id)}
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      Open in new window
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
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

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          className="flex-1 min-h-0 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden p-4"
        >
          {loading && <div className="text-xs text-on-surface-variant">Loading…</div>}
          {!loading && messages.length === 0 && (
            <div className="text-sm text-on-surface-variant py-8 text-center">
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
        </div>

        {/* Error bar */}
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
            'shrink-0 min-w-0 flex flex-col gap-2 border-t border-[var(--color-card-border)] p-3 transition-colors',
            draggingAttachments ? 'bg-primary/10 ring-1 ring-primary/35' : '',
          ].join(' ')}
        >
          {(currentPageContext || contextRefs.length > 0 || allowAgentParticipants) && (
            <div data-testid="chat-context-toolbar" className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {currentPageContext && (
                  <button
                    type="button"
                    onClick={() => {
                      pinCurrentPageContext().catch((err) => {
                        setError(err instanceof Error ? err.message : 'Failed to attach current page')
                      })
                    }}
                    disabled={!canUseComposer || sending || contextRefs.some((ref) => contextReferenceKey(ref) === contextReferenceKey(currentPageContext))}
                    title="Use current page as context"
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2.5 text-[11px] font-medium text-on-surface-variant transition-colors hover:bg-white/[0.08] hover:text-on-surface disabled:opacity-45"
                  >
                    <span className="material-symbols-outlined text-[14px]">add_link</span>
                    Use current page
                  </button>
                )}
                {contextRefs.map((ref) => (
                  <span
                    key={contextReferenceKey(ref)}
                    className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 text-[11px] text-on-surface"
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
                      className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  </span>
                ))}
              </div>

              {allowAgentParticipants && (
                <label className="ml-auto shrink-0">
                  <span className="sr-only">Thinking effort</span>
                  <select
                    value={agentEffort}
                    onChange={(event) => setAgentEffort(event.target.value as AgentEffort | '')}
                    disabled={!canUseComposer || sending}
                    title="Thinking effort"
                    aria-label="Thinking effort"
                    className="h-7 rounded-full border border-[var(--color-card-border)] bg-white/[0.04] px-2.5 text-[11px] font-medium text-on-surface-variant outline-none transition-colors hover:bg-white/[0.08] hover:text-on-surface focus:border-primary disabled:opacity-40"
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
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-on-surface-variant">
                Slash commands
              </div>
              {slashCommandOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-on-surface-variant">No matching commands</div>
              ) : (
                slashCommandOptions.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    aria-label={`Use ${command.token}`}
                    onClick={() => selectSlashCommand(command)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-on-surface transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">{command.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{command.label}</span>
                      <span className="block truncate text-[11px] text-on-surface-variant">{command.token} · {command.description}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {contextTypePrompt && (
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-on-surface-variant">
                Reference types
              </div>
              {contextTypeOptions.length === 0 ? (
                <div className="px-2 py-2 text-xs text-on-surface-variant">No matching reference types</div>
              ) : (
                contextTypeOptions.map((option) => (
                  <button
                    key={option.namespace}
                    type="button"
                    aria-label={`Use @${option.namespace}:`}
                    onClick={() => selectContextType(option)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-on-surface transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">alternate_email</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{option.label}</span>
                      <span className="block truncate text-[11px] text-on-surface-variant">@{option.namespace}:</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {contextMention && (
            <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-1 shadow-xl">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-on-surface-variant">
                @{contextMention.namespace}: references
              </div>
              {contextSearchLoading && (
                <div className="px-2 py-2 text-xs text-on-surface-variant">Searching…</div>
              )}
              {!contextSearchLoading && contextSearchResults.length === 0 && (
                <div className="px-2 py-2 text-xs text-on-surface-variant">No matching references</div>
              )}
              {!contextSearchLoading && contextSearchResults.map((ref) => (
                <button
                  key={contextReferenceKey(ref)}
                  type="button"
                  onClick={() => selectMentionContext(ref)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-on-surface transition-colors hover:bg-white/[0.06]"
                >
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant">alternate_email</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{contextChipLabel(ref)}</span>
                    {ref.summary && (
                      <span className="block truncate text-[11px] text-on-surface-variant">{ref.summary}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-full bg-white/8 border border-white/10 px-2.5 py-1 text-xs text-on-surface-variant"
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {f.type.startsWith('image/') ? 'image' : f.type === 'application/pdf' ? 'picture_as_pdf' : 'attach_file'}
                  </span>
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <span className="opacity-50">({(f.size / 1024).toFixed(0)} KB)</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-0.5 text-on-surface-variant/60 hover:text-on-surface transition-colors"
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
              compact ? '' : 'lg:rounded-lg lg:border-0 lg:bg-transparent lg:px-0 lg:py-0',
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
              className="self-end flex items-center justify-center w-9 h-9 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-white/[0.08] transition-colors aria-disabled:opacity-40 shrink-0 cursor-pointer aria-disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[20px]">attach_file</span>
            </label>

            <VoiceInputButton
              disabled={!allowSendMessages || sending || !activeConversation}
              onTranscript={addVoiceTranscriptToComposer}
              className="self-end"
            />

            <textarea
              ref={composerRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                updateMentionFromComposer(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }}
              onClick={(e) => updateMentionFromComposer(input, e.currentTarget.selectionStart ?? input.length)}
              onKeyUp={(e) => updateMentionFromComposer(input, e.currentTarget.selectionStart ?? input.length)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && (contextMention || contextTypePrompt || slashPrompt)) {
                  setContextMention(null)
                  setContextTypePrompt(null)
                  setSlashPrompt(null)
                  setContextSearchResults([])
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(e as unknown as FormEvent)
                }
              }}
              placeholder={
                !allowSendMessages
                  ? 'Replies disabled for your role'
                  : activeConversation
                    ? 'Send a message'
                    : allowStartConversations
                      ? allowAgentParticipants ? 'Message Pip' : 'Create or select a conversation first'
                      : 'Select a conversation first'
              }
              disabled={!canUseComposer || sending}
              rows={1}
              className={[
                'min-h-[40px] max-h-[160px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] placeholder:text-on-surface-variant disabled:opacity-60 focus:outline-none',
                compact ? '' : 'lg:text-sm lg:rounded-lg lg:border lg:border-[var(--color-card-border)] lg:bg-[var(--color-card)] lg:px-3 lg:py-2 lg:min-h-0',
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
                {sending ? 'hourglass_empty' : 'arrow_upward'}
              </span>
              {!compact && <span className="hidden lg:inline">{sending ? 'Sending…' : 'Send'}</span>}
            </button>
          </div>
        </form>
      </section>

      {/* ── New conversation modal ──────────────────────────────────────── */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewModal(false)
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
              <h2 className="text-sm font-medium text-on-surface">New conversation</h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal body */}
            <div className="p-5 space-y-4">
              {/* Optional title */}
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant block mb-1.5">
                  Title (optional)
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Q3 campaign planning"
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:border-primary/60"
                />
              </div>

              {/* Participant picker */}
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant block mb-1.5">
                  Participants (max 5)
                </label>
                <div className="max-h-[300px] overflow-y-auto">
                  <ParticipantPicker
                    orgId={orgId}
                    onSelect={setNewParticipants}
                    showAgents={allowAgentParticipants}
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant block mb-1.5">
                  Conversation context
                </label>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value as 'general' | 'project' | 'task' | 'campaign' | 'company' | 'contact')}
                  className="w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-on-surface outline-none focus:border-primary/60"
                >
                  {availableConversationContexts.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {error}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-5 py-4">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="rounded-lg px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateConversation}
                disabled={!allowStartConversations || creatingConv || newParticipants.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50 hover:opacity-90"
              >
                {creatingConv ? 'Creating…' : 'Start conversation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
