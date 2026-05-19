'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEvent } from '@/lib/hermes/types'

type Role = 'user' | 'assistant' | 'system' | 'tool'

type ChatMessage = {
  id: string
  role: Role
  content: string
  status?: 'pending' | 'streaming' | 'completed' | 'failed' | 'waiting_approval'
  runId?: string
  error?: string
  events?: ChatEvent[]
  createdAt?: { seconds?: number; _seconds?: number } | string
}

type Conversation = {
  id: string
  orgId: string
  profile: string
  title: string
  lastMessagePreview?: string
  lastMessageAt?: { seconds?: number; _seconds?: number } | string
  archived?: boolean
}

type Props = {
  orgId: string
  profileEnabled: boolean
  projectId?: string
  projectName?: string
}

const POLL_INTERVAL = 1500

function timestampSeconds(ts: ChatMessage['createdAt']) {
  if (!ts) return 0
  if (typeof ts === 'string') return Date.parse(ts) / 1000
  return ts.seconds ?? ts._seconds ?? 0
}

export default function HermesChat({ orgId, profileEnabled, projectId, projectName }: Props) {
  const apiBase = `/api/v1/admin/hermes/profiles/${orgId}/conversations`
  const listQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const [liveEvents, setLiveEvents] = useState<Record<string, ChatEvent[]>>({})
  const liveEventsRef = useRef<Record<string, ChatEvent[]>>({})
  useEffect(() => { liveEventsRef.current = liveEvents }, [liveEvents])
  const [approvalPending, setApprovalPending] = useState<Record<string, { runId: string; toolName?: string }>>({})
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameCancelledRef = useRef(false)

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  )

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}${listQuery}`)
      if (!res.ok) throw new Error(`load conversations: ${res.status}`)
      const body = await res.json()
      const list: Conversation[] = body.data?.conversations ?? []
      setConversations(list)
      if (!activeId && list.length) setActiveId(list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conversations')
    }
  }, [apiBase, activeId, listQuery])

  const loadMessages = useCallback(
    async (convId: string) => {
      setLoading(true)
      try {
        const res = await fetch(`${apiBase}/${convId}/messages`)
        if (!res.ok) throw new Error(`load messages: ${res.status}`)
        const body = await res.json()
        setMessages(body.data?.messages ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load messages')
      } finally {
        setLoading(false)
      }
    },
    [apiBase],
  )

  useEffect(() => {
    if (profileEnabled) loadConversations()
  }, [profileEnabled, loadConversations])

  useEffect(() => {
    if (activeId) loadMessages(activeId)
  }, [activeId, loadMessages])

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!menuOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-conv-menu]')) { setMenuOpenId(null); setMenuPosition(null) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenId])

  const newConversation = useCallback(async () => {
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (projectId) {
        payload.projectId = projectId
        if (projectName) payload.title = projectName
      }
      const res = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(`new conversation: ${res.status}`)
      const body = await res.json()
      const conv: Conversation = body.data?.conversation
      setConversations((prev) => [conv, ...prev])
      setActiveId(conv.id)
      setMessages([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create conversation')
    }
  }, [apiBase, projectId, projectName])

  const subscribeEvents = useCallback(
    (orgIdInner: string, msgId: string, runId: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      const es = new EventSource(`/api/v1/admin/hermes/profiles/${orgIdInner}/runs/${encodeURIComponent(runId)}/events`)
      eventSourceRef.current = es
      es.onmessage = (e) => {
        try {
          const ev: ChatEvent = JSON.parse(e.data)
          setLiveEvents((prev) => ({ ...prev, [msgId]: [...(prev[msgId] || []), ev] }))
          if (ev.event === 'assistant.text_delta' && ev.delta) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, status: 'streaming', content: `${m.content ?? ''}${ev.delta}` }
                  : m,
              ),
            )
          }
        } catch {}
      }
      es.onerror = () => {
        es.close()
        if (eventSourceRef.current === es) eventSourceRef.current = null
      }
    },
    [],
  )

  const pollFinalize = useCallback(
    async (convId: string, msgId: string, runId: string, attempts = 0) => {
      if (attempts > 120) {
        setError('Run timed out waiting for completion')
        return
      }
      try {
        const events = liveEventsRef.current[msgId] ?? []
        const res = await fetch(`${apiBase}/${convId}/messages/${msgId}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, events }),
        })
        const body = await res.json()
        if (body.data?.pending) {
          pollRef.current = setTimeout(() => pollFinalize(convId, msgId, runId, attempts + 1), POLL_INTERVAL)
          return
        }
        if (body.data?.waitingForApproval) {
          if (eventSourceRef.current) {
            eventSourceRef.current.close()
            eventSourceRef.current = null
          }
          const lastEvent = events[events.length - 1]
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, status: 'waiting_approval', runId } : m)),
          )
          setApprovalPending((prev) => ({
            ...prev,
            [msgId]: { runId, toolName: lastEvent?.tool },
          }))
          return
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
        await loadMessages(convId)
        await loadConversations()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Finalize failed')
      }
    },
    [apiBase, loadMessages, loadConversations],
  )

  const resolveApproval = useCallback(
    async (msgId: string, choice: 'once' | 'always' | 'deny') => {
      const pending = approvalPending[msgId]
      if (!pending) return
      try {
        const res = await fetch(
          `/api/v1/admin/hermes/profiles/${orgId}/runs/${encodeURIComponent(pending.runId)}/approval`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) },
        )
        if (!res.ok) throw new Error(`approval failed: ${res.status}`)
        setApprovalPending((prev) => { const next = { ...prev }; delete next[msgId]; return next })
        setMessages((prev) =>
          prev.map((m) => (m.id === msgId ? { ...m, status: 'pending' } : m)),
        )
        if (activeId) pollFinalize(activeId, msgId, pending.runId)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Approval failed')
      }
    },
    [approvalPending, orgId, activeId, pollFinalize],
  )

  const renameConversation = useCallback(
    async (convId: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      setRenamingId(null)
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, title: trimmed } : c)),
      )
      await fetch(`/api/v1/admin/hermes/profiles/${orgId}/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      }).catch(() => {/* optimistic — ignore errors silently */})
    },
    [orgId],
  )

  const archiveConversation = useCallback(
    async (convId: string) => {
      setMenuOpenId(null)
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      if (activeId === convId) setActiveId(null)
      await fetch(`/api/v1/admin/hermes/profiles/${orgId}/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      }).catch(() => {/* optimistic */})
    },
    [orgId, activeId],
  )

  const send = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!input.trim() || sending || !profileEnabled) return
      setError(null)
      setSending(true)
      let convId = activeId
      try {
        if (!convId) {
          const createPayload: Record<string, unknown> = { title: input.slice(0, 80) }
          if (projectId) createPayload.projectId = projectId
          const r = await fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createPayload) })
          const b = await r.json()
          convId = b.data?.conversation?.id
          if (!convId) throw new Error('Failed to create conversation')
          setConversations((prev) => [b.data.conversation, ...prev])
          setActiveId(convId)
        }
        const content = input
        setInput('')
        const nowSec = Date.now() / 1000
        const optimisticUser: ChatMessage = { id: `tmp-user-${Date.now()}`, role: 'user', content, status: 'completed', createdAt: { seconds: nowSec } }
        const optimisticAssistant: ChatMessage = { id: `tmp-assistant-${Date.now()}`, role: 'assistant', content: '', status: 'pending', createdAt: { seconds: nowSec + 0.001 } }
        setMessages((prev) => [...prev, optimisticUser, optimisticAssistant])
        const res = await fetch(`${apiBase}/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Send failed')
        const newAssistantId = body.data?.assistantMessage?.id
        const runId = body.data?.runId
        await loadMessages(convId)
        if (newAssistantId && runId) {
          subscribeEvents(orgId, newAssistantId, runId)
          pollFinalize(convId, newAssistantId, runId)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Send failed')
      } finally {
        setSending(false)
      }
    },
    [activeId, apiBase, input, sending, profileEnabled, loadMessages, pollFinalize, projectId, subscribeEvents, orgId],
  )

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current)
    if (eventSourceRef.current) eventSourceRef.current.close()
  }, [])

  if (!profileEnabled) {
    return (
      <div className="pib-card text-sm text-on-surface-variant">
        Save and enable a Hermes profile link above to start chatting.
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr] min-h-[600px]">
      <aside className="pib-card flex flex-col gap-2 p-3">
        <button onClick={newConversation} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:opacity-90">
          + New chat
        </button>
        <div className="text-xs text-on-surface-variant mt-2 px-1">Conversations</div>
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[520px]">
          {conversations.length === 0 && (
            <div className="text-xs text-on-surface-variant px-2 py-3">No chats yet. Start one.</div>
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
                      if (e.key === 'Escape') { renameCancelledRef.current = true; setRenamingId(null) }
                    }}
                    onBlur={() => {
                      if (!renameCancelledRef.current) renameConversation(c.id, renameValue)
                      renameCancelledRef.current = false
                    }}
                    className="flex-1 min-w-0 bg-transparent border-b border-primary text-sm text-on-surface outline-none"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors pr-8 ${
                    c.id === activeId
                      ? 'bg-[var(--color-card-active,rgba(255,255,255,0.08))] text-on-surface'
                      : 'text-on-surface-variant hover:bg-[var(--color-card-hover,rgba(255,255,255,0.04))]'
                  }`}
                >
                  <div className="line-clamp-1">{c.title || 'Untitled'}</div>
                  {c.lastMessagePreview && (
                    <div className="line-clamp-1 text-xs text-on-surface-variant mt-0.5">{c.lastMessagePreview}</div>
                  )}
                </button>
              )}

              {/* ⋯ hover button */}
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
                  className={`absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/conv:flex items-center justify-center w-6 h-6 rounded text-on-surface-variant hover:text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.08))] ${menuOpenId === c.id ? '!flex' : ''}`}
                  aria-label="Conversation options"
                >
                  ⋯
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* conversation dropdown — rendered fixed so it escapes the sidebar scroll container */}
      {menuOpenId && menuPosition && (
        <div
          data-conv-menu
          style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left }}
          className="z-50 min-w-[128px] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface,#1c1c1c)] py-1 shadow-xl"
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))]"
            onClick={() => {
              const conv = conversations.find((c) => c.id === menuOpenId)
              setMenuOpenId(null)
              setMenuPosition(null)
              if (conv) { setRenamingId(conv.id); setRenameValue(conv.title || '') }
            }}
          >
            ✏️ Rename
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[var(--color-card-hover,rgba(255,255,255,0.06))]"
            onClick={() => { archiveConversation(menuOpenId); setMenuPosition(null) }}
          >
            📦 Archive
          </button>
        </div>
      )}

      <section className="pib-card flex flex-col">
        <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-4 py-2 text-sm">
          <div className="text-on-surface font-medium">{activeConversation?.title || 'New chat'}</div>
          <div className="text-xs text-on-surface-variant">Hermes</div>
        </div>
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px]">
          {loading && <div className="text-xs text-on-surface-variant">Loading…</div>}
          {!loading && messages.length === 0 && (
            <div className="text-sm text-on-surface-variant py-8 text-center">
              Send a task or question. Your agent has access to skills, files, terminal (per capability switches).
            </div>
          )}
          {messages.sort((a, b) => timestampSeconds(a.createdAt) - timestampSeconds(b.createdAt)).map((m) => {
            return (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] ${m.role === 'user' ? '' : 'w-full'}`}>
                  {m.role === 'assistant' && (() => {
                    const displayEvents = liveEvents[m.id]?.length ? liveEvents[m.id] : (m.events ?? [])
                    if (!displayEvents.length) return null
                    const isLive = m.status === 'pending' || m.status === 'streaming' || m.status === 'waiting_approval'
                    if (isLive) {
                      return (
                        <div className="mb-1 space-y-1 text-xs text-on-surface-variant">
                          {displayEvents.slice(-5).map((ev, i) => (
                            <div key={i} className="flex items-baseline gap-2 rounded-md bg-[var(--color-card,rgba(255,255,255,0.03))] px-2 py-1">
                              <span className="font-mono opacity-70">{ev.event ?? 'event'}</span>
                              {ev.tool && <span className="text-primary">{ev.tool}</span>}
                              {ev.preview && <span className="truncate opacity-80">{ev.preview}</span>}
                            </div>
                          ))}
                        </div>
                      )
                    }
                    return (
                      <details className="mb-2 text-xs text-on-surface-variant group/details">
                        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[var(--color-card,rgba(255,255,255,0.03))]">
                          <span className="group-open/details:hidden">▶</span>
                          <span className="hidden group-open/details:inline">▼</span>
                          <span>{displayEvents.length} tool call{displayEvents.length !== 1 ? 's' : ''}</span>
                        </summary>
                        <div className="mt-1 space-y-0.5 pl-3 border-l border-[var(--color-card-border)]">
                          {displayEvents.map((ev, i) => {
                            const ts = ev.timestamp ? new Date(ev.timestamp * 1000).toISOString().slice(11, 19) : null
                            const toolLabel = ev.tool || ev.event
                            return (
                              <div key={i} className="flex items-center gap-2 py-0.5">
                                {ts && <span className="font-mono opacity-40 shrink-0">{ts}</span>}
                                {toolLabel && <span className="text-primary font-mono shrink-0">{toolLabel}</span>}
                                {ev.preview && <span className="truncate opacity-70">{ev.preview}</span>}
                              </div>
                            )
                          })}
                        </div>
                      </details>
                    )
                  })()}
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-primary text-on-primary'
                        : m.status === 'failed'
                        ? 'bg-red-500/15 text-red-200 border border-red-500/40'
                        : 'bg-[var(--color-card-active,rgba(255,255,255,0.06))] text-on-surface'
                    }`}
                  >
                    {m.status === 'pending' && !m.content && <span className="opacity-70 italic">Thinking…</span>}
                    {m.status === 'waiting_approval' && !m.content && <span className="opacity-70 italic">Paused — awaiting tool approval…</span>}
                    {m.content || (m.status === 'failed' && m.error)}
                  </div>
                  {m.role === 'assistant' && m.status === 'waiting_approval' && approvalPending[m.id] && (
                    <div className="mt-2 rounded-xl border border-[#f59e0b44] bg-[#1a1500] px-4 py-3 text-sm">
                      <div className="mb-1 font-medium text-[#f59e0b]">⏸ Waiting for approval</div>
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
              </div>
            )
          })}
        </div>
        {error && <div className="px-4 py-2 text-xs text-red-300 border-t border-red-500/30 bg-red-500/10">{error}</div>}
        <form onSubmit={send} className="flex gap-2 border-t border-[var(--color-card-border)] p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(e as unknown as FormEvent)
              }
            }}
            placeholder="Send a message — Enter to send, Shift+Enter for new line"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="self-end rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50 hover:opacity-90"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </section>
    </div>
  )
}
