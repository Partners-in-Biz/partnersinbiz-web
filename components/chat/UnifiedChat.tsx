'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEvent } from '@/lib/hermes/types'
import MessageBubble, { type ConversationAttachment, type ConversationMessage } from './MessageBubble'
import ParticipantBar from './ParticipantBar'
import ParticipantPicker, { type SelectedParticipant } from './ParticipantPicker'
import ConversationListItem, { type Conversation } from './ConversationListItem'

type AgentId = 'pip' | 'theo' | 'maya' | 'sage' | 'nora'

interface AgentTeamDoc {
  agentId: AgentId
  name: string
  role: string
  persona: string
  iconKey: string
  colorKey: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  defaultModel: string
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
}

export interface UnifiedChatProps {
  orgId: string
  currentUserUid: string
  currentUserDisplayName: string
  orgName?: string
  projectId?: string
  scope?: 'general' | 'project' | 'task' | 'campaign'
  scopeRefId?: string
  initialConvId?: string
  initialAgentId?: AgentId
  autoCreateScopedConversation?: boolean
  autoCreateTitle?: string
  allowDeleteConversations?: boolean
  allowAgentParticipants?: boolean
  compact?: boolean
}

const POLL_INTERVAL = 1500
const HUMAN_CHAT_REFRESH_INTERVAL = 3000

async function uploadConversationAttachment(convId: string, file: File): Promise<ConversationAttachment> {
  const form = new FormData()
  form.append('file', file)

  const res = await fetch(`/api/v1/conversations/${convId}/attachments`, {
    method: 'POST',
    body: form,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.data?.url) {
    throw new Error(body.error || `Upload failed: ${file.name}`)
  }

  return {
    id: body.data.id,
    name: body.data.name ?? file.name,
    url: body.data.url,
    contentType: body.data.contentType ?? file.type,
    sizeBytes: body.data.sizeBytes ?? file.size,
    ...(body.data.storagePath ? { storagePath: body.data.storagePath } : {}),
  }
}

function tsSeconds(ts: ConversationMessage['createdAt']): number {
  if (!ts) return 0
  if (typeof ts === 'string') return Date.parse(ts) / 1000
  return (ts as { seconds?: number; _seconds?: number }).seconds ??
    (ts as { seconds?: number; _seconds?: number })._seconds ?? 0
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
  const [creatingConv, setCreatingConv] = useState(false)

  // Attachment state
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
  // Tracks which assistant message IDs we've already started polling for (prevents duplicates)
  const resumedRunsRef = useRef<Set<string>>(new Set())
  const autoCreateRef = useRef(false)

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

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
    initialAgentId,
    scope,
    scopeRefId,
    orgId,
    autoCreateTitle,
  ])

  // ── Load messages ─────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (convId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    try {
      const res = await fetch(`/api/v1/conversations/${convId}/messages`)
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
    if (!activeId) return
    if ((activeConversation?.participantAgentIds?.length ?? 0) > 0) return

    const interval = window.setInterval(() => {
      void loadMessages(activeId, { silent: true })
    }, HUMAN_CHAT_REFRESH_INTERVAL)

    return () => window.clearInterval(interval)
  }, [activeConversation?.participantAgentIds?.length, activeId, loadMessages])

  // Auto-scroll on new messages
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
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
      if (attempts > 400) {
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
        const body = await res.json()
        const status: string | undefined = body.data?.status

        // Non-2xx from finalize API (e.g. 502 upstream) — keep polling, don't bail
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
    const knownAgentIds: AgentId[] = ['pip', 'theo', 'maya', 'sage', 'nora']
    for (const m of messages) {
      if (
        m.role === 'assistant' &&
        (m.status === 'pending' || m.status === 'streaming') &&
        m.runId &&
        !resumedRunsRef.current.has(m.id)
      ) {
        resumedRunsRef.current.add(m.id)
        const agentId: AgentId = knownAgentIds.includes(m.authorId as AgentId)
          ? (m.authorId as AgentId)
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
    [activeId],
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
      if (scope) payload.scope = scope
      if (scopeRefId) payload.scopeRefId = scopeRefId
      if (projectId) payload.scopeRefId = projectId

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create conversation')
    } finally {
      setCreatingConv(false)
    }
  }, [creatingConv, newParticipants, newTitle, orgId, projectId, scope, scopeRefId])

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if ((!input.trim() && attachments.length === 0) || sending) return
      setError(null)
      setSending(true)
      let convId = activeId

      try {
        // Auto-create a conversation if none selected.
        let createdWithAgent = false
        if (!convId) {
          const participants = allowAgentParticipants
            ? [{ kind: 'agent' as const, agentId: 'pip' as const }]
            : []
          const payload: Record<string, unknown> = {
            orgId,
            participants,
            title: input.slice(0, 80),
          }
          if (scope) payload.scope = scope
          if (scopeRefId) payload.scopeRefId = scopeRefId
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
        let content = input
        if (uploadedAttachments.length > 0) {
          const attNote = uploadedAttachments
            .map((attachment) => `Attachment: ${attachment.name} (${(attachment.sizeBytes / 1024).toFixed(1)} KB)`)
            .join('\n')
          content = content.trim() ? `${content}\n\n${attNote}` : attNote
        }
        setInput('')
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
          body: JSON.stringify({ content, attachments: uploadedAttachments }),
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
      sending,
      allowAgentParticipants,
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
    ],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  const scopeLabel = scope && scope !== 'general'
    ? scope.charAt(0).toUpperCase() + scope.slice(1)
    : 'Default'
  const subtitle = [orgName, scopeLabel].filter(Boolean).join(' · ')
  const showListOnMobile = mobilePane === 'list'

  return (
    <div
      className={
        compact
          ? 'flex h-full min-h-0 flex-1 overflow-hidden'
          : 'flex lg:grid lg:gap-4 lg:grid-cols-[280px_1fr] flex-1 min-h-0 overflow-hidden'
      }
    >
      {/* ── Left: conversation list ─────────────────────────────────────── */}
      <aside
        className={[
          'pib-card min-h-0 flex-col gap-2 overflow-hidden flex-1 p-3',
          compact ? '!rounded-none !border-0 !bg-transparent' : 'lg:flex max-lg:!rounded-none max-lg:!border-0 max-lg:!bg-transparent',
          showListOnMobile ? 'flex' : 'hidden',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:opacity-90 flex items-center justify-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          New conversation
        </button>

        <div className="text-xs text-on-surface-variant mt-2 px-1">Conversations</div>

        <div className={['flex flex-col gap-0.5 overflow-y-auto flex-1 min-h-0', compact ? '' : 'lg:max-h-[520px]'].join(' ')}>
          {conversations.length === 0 && (
            <div className="text-xs text-on-surface-variant px-2 py-3">
              No conversations yet. Start one.
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
                      setMenuPosition({ top: rect.bottom + 4, left: rect.right - 128 })
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
          className="z-50 min-w-[128px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl"
        >
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
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))] flex items-center gap-2"
            onClick={() => archiveConversation(menuOpenId)}
          >
            <span className="material-symbols-outlined text-[14px]">archive</span>
            Archive
          </button>
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
          'pib-card flex-col overflow-hidden min-h-0 flex-1',
          compact ? '!p-0 !rounded-none !border-0 !bg-transparent' : 'lg:flex max-lg:!p-0 max-lg:!rounded-none max-lg:!border-0 max-lg:!bg-transparent',
          showListOnMobile ? 'hidden' : 'flex',
        ].join(' ')}
      >
        {/* Header — mobile style (back / title+subtitle / ⋯) on small,
            keeps original sticky look on desktop */}
        <div className="shrink-0 border-b border-[var(--color-card-border)] px-3 py-2.5 lg:px-4 lg:py-3">
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
                  <div className="absolute right-0 top-full mt-1 z-30 min-w-[160px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl">
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
              <ParticipantBar participants={activeConversation.participants} />
            </div>
          )}
        </div>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
        >
          {loading && <div className="text-xs text-on-surface-variant">Loading…</div>}
          {!loading && messages.length === 0 && (
            <div className="text-sm text-on-surface-variant py-8 text-center">
              {activeConversation
                ? 'No messages yet. Send one below.'
                : 'Select or create a conversation to get started.'}
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
          className="shrink-0 flex flex-col gap-2 border-t border-[var(--color-card-border)] p-3"
        >
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
            className={[
              'flex items-end gap-2 rounded-3xl border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-1.5',
              compact ? '' : 'lg:rounded-lg lg:border-0 lg:bg-transparent lg:px-0 lg:py-0',
            ].join(' ')}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                setAttachments((prev) => [...prev, ...files].slice(0, 5))
                e.target.value = ''
              }}
            />
            {/* Attach */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || !activeConversation}
              title="Attach file"
              aria-label="Attach file"
              className="self-end flex items-center justify-center w-9 h-9 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-white/[0.08] transition-colors disabled:opacity-40 shrink-0"
            >
              <span className="material-symbols-outlined text-[20px]">attach_file</span>
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(e as unknown as FormEvent)
                }
              }}
              placeholder={
                activeConversation
                  ? 'Send a message'
                  : allowAgentParticipants
                    ? 'Message Pip'
                    : 'Create or select a conversation first'
              }
              disabled={sending}
              rows={1}
              className={[
                'flex-1 resize-none bg-transparent px-1 py-2 text-[15px] placeholder:text-on-surface-variant disabled:opacity-60 focus:outline-none min-h-[40px] max-h-[160px]',
                compact ? '' : 'lg:text-sm lg:rounded-lg lg:border lg:border-[var(--color-card-border)] lg:bg-[var(--color-card)] lg:px-3 lg:py-2 lg:min-h-0',
              ].join(' ')}
            />
            <button
              type="submit"
              disabled={sending || (!input.trim() && attachments.length === 0)}
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
                disabled={creatingConv || newParticipants.length === 0}
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
