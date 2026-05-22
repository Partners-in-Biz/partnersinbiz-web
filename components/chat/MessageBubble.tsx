'use client'

/* eslint-disable @next/next/no-img-element -- Conversation attachments use arbitrary Firebase Storage URLs. */

import { useEffect, useRef, useState } from 'react'
import type { ChatEvent } from '@/lib/hermes/types'
import { copyToClipboard } from '@/lib/utils/clipboard'

// Matches Phase 1 ConversationMessage shape
export interface ConversationMessage {
  id: string
  conversationId: string
  role: string
  content: string
  attachments?: ConversationAttachment[]
  runId?: string
  status?: string
  error?: string
  events?: unknown[]
  toolName?: string
  authorKind: 'user' | 'agent' | 'system'
  authorId: string
  authorDisplayName: string
  dispatchAgentId?: string
  createdAt?: { seconds?: number; _seconds?: number } | string
}

export interface ConversationAttachment {
  id: string
  name: string
  url: string
  contentType: string
  sizeBytes: number
  storagePath?: string
}

// colorKey → tailwind background + text classes
const AGENT_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  violet:  { bg: 'bg-violet-600/20',  text: 'text-violet-300',  dot: 'bg-violet-400' },
  sky:     { bg: 'bg-sky-600/20',     text: 'text-sky-300',     dot: 'bg-sky-400' },
  amber:   { bg: 'bg-amber-600/20',   text: 'text-amber-300',   dot: 'bg-amber-400' },
  emerald: { bg: 'bg-emerald-600/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  rose:    { bg: 'bg-rose-600/20',    text: 'text-rose-300',    dot: 'bg-rose-400' },
}

const DEFAULT_COLOR = { bg: 'bg-white/10', text: 'text-white', dot: 'bg-white/40' }

interface MessageBubbleProps {
  message: ConversationMessage
  currentUserUid: string
  agentColorKey?: string
  agentIconKey?: string
  liveEvents?: ChatEvent[]
  onStopRun?: () => void
  onQuoteSelection?: (text: string) => void
}

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

function useElapsed(active: boolean): number {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    if (!active) return
    const startedAt = Date.now()
    const reset = setTimeout(() => setSecs(0), 0)
    const tick = setInterval(() => {
      setSecs(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => {
      clearTimeout(reset)
      clearInterval(tick)
    }
  }, [active])

  return active ? secs : 0
}

// Categorize tool-call events into a short human summary like
// "Ran 6 commands, read 2 files, wrote 1 file".
function summarizeEvents(events: ChatEvent[]): string {
  if (events.length === 0) return ''
  let commands = 0, read = 0, wrote = 0, searched = 0, web = 0, other = 0
  for (const ev of events) {
    const t = (ev.tool ?? ev.event ?? '').toLowerCase()
    if (!t) { other++; continue }
    if (/(^|_)(read|view|cat|glob|ls|list)(_|$)/.test(t)) read++
    else if (/(bash|exec|shell|command|^run$|run_)/.test(t)) commands++
    else if (/(write|edit|update|create|patch|save)/.test(t)) wrote++
    else if (/(grep|search|find)/.test(t)) searched++
    else if (/(web|fetch|http|url)/.test(t)) web++
    else other++
  }
  const parts: string[] = []
  const plur = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (commands) parts.push(`ran ${plur(commands, 'command')}`)
  if (read) parts.push(`read ${plur(read, 'file')}`)
  if (wrote) parts.push(`wrote ${plur(wrote, 'file')}`)
  if (searched) parts.push(`searched ${plur(searched, 'time')}`)
  if (web) parts.push(`fetched ${plur(web, 'page')}`)
  if (!parts.length) parts.push(plur(other, 'action'))
  const joined = parts.join(', ')
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

function eventLabel(event: ChatEvent): string {
  switch (event.event) {
    case 'assistant.text_delta':
      return 'Drafting response'
    case 'tool.started':
      return event.activity ?? 'Using a tool'
    case 'tool.completed':
      return event.error ? 'Tool returned an error' : 'Tool completed'
    case 'task.created':
      return 'Planning work'
    case 'task.updated':
      return event.title ? `Updating ${event.title}` : 'Updating task list'
    case 'approval.required':
      return 'Waiting for approval'
    case 'reasoning.summary':
      return 'Reasoning summary available'
    case 'heartbeat':
      return 'Still polling run'
    case 'run.completed':
      return 'Finalising response'
    case 'run.failed':
      return 'Run failed'
    default:
      return event.activity ?? event.preview ?? 'Working'
  }
}

function currentActivity(events: ChatEvent[], elapsed: number): { label: string; detail?: string } {
  const meaningful = events.filter((event) => event.event !== 'assistant.text_delta')
  const latest = meaningful.at(-1) ?? events.at(-1)
  if (!latest) {
    return elapsed >= 90
      ? { label: 'No event for 90s', detail: 'Still polling run...' }
      : { label: 'Planning work', detail: 'Waiting for the first agent event...' }
  }
  const timestamp = latest.timestamp && latest.timestamp > 10_000_000_000
    ? latest.timestamp / 1000
    : latest.timestamp
  const age = timestamp ? Math.max(0, Math.floor(Date.now() / 1000 - timestamp)) : 0
  if (age >= 90) return { label: 'No event for 90s', detail: 'Still polling run...' }
  return {
    label: eventLabel(latest),
    detail: latest.tool ?? latest.preview,
  }
}

function taskRows(events: ChatEvent[]): Array<{ key: string; title: string; status: string }> {
  const rows = new Map<string, { key: string; title: string; status: string }>()
  for (const event of events) {
    if (event.event !== 'task.created' && event.event !== 'task.updated') continue
    const todos = Array.isArray(event.todos) ? event.todos : []
    if (todos.length > 0) {
      todos.forEach((todo, index) => {
        const record = todo && typeof todo === 'object' ? todo as Record<string, unknown> : {}
        const title = typeof record.content === 'string'
          ? record.content
          : typeof record.title === 'string'
            ? record.title
            : `Task ${index + 1}`
        const status = typeof record.status === 'string' ? record.status : 'pending'
        rows.set(`${index}:${title}`, { key: `${index}:${title}`, title, status })
      })
      continue
    }
    const title = event.title ?? event.preview
    if (!title) continue
    rows.set(title, { key: title, title, status: event.status ?? 'in_progress' })
  }
  return Array.from(rows.values()).slice(0, 6)
}

function reasoningSummary(events: ChatEvent[]): string | null {
  const event = [...events].reverse().find((item) => item.event === 'reasoning.summary' && (item.text || item.preview))
  return event?.text ?? event?.preview ?? null
}

function isImageAttachment(attachment: ConversationAttachment): boolean {
  return attachment.contentType.toLowerCase().startsWith('image/')
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function copyableText(message: ConversationMessage): string {
  return message.content || message.error || ''
}

export default function MessageBubble({
  message: m,
  currentUserUid,
  agentColorKey,
  agentIconKey,
  liveEvents = [],
  onStopRun,
  onQuoteSelection,
}: MessageBubbleProps) {
  const [previewAttachment, setPreviewAttachment] = useState<ConversationAttachment | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectionAction, setSelectionAction] = useState<{
    text: string
    left: number
    top: number
  } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const isMine = m.authorId === currentUserUid
  const isTool = m.role === 'tool'
  const isPending = m.status === 'pending' || m.status === 'streaming'
  const isWaiting = m.status === 'waiting_approval'
  const isFailed = m.status === 'failed'
  const elapsed = useElapsed(isPending || isWaiting)
  const textToCopy = copyableText(m)

  const copyMessage = async () => {
    if (!textToCopy.trim()) return
    await copyToClipboard(textToCopy)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  useEffect(() => {
    if (!selectionAction) return

    const dismiss = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (target && contentRef.current?.contains(target)) return
      setSelectionAction(null)
    }
    const dismissOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectionAction(null)
    }

    document.addEventListener('mousedown', dismiss)
    document.addEventListener('touchstart', dismiss)
    document.addEventListener('keyup', dismissOnKey)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('touchstart', dismiss)
      document.removeEventListener('keyup', dismissOnKey)
    }
  }, [selectionAction])

  const handleTextSelection = () => {
    if (!onQuoteSelection || !contentRef.current) return
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()
    if (!selection || !selectedText) {
      setSelectionAction(null)
      return
    }
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (!range || !contentRef.current.contains(range.commonAncestorContainer)) {
      setSelectionAction(null)
      return
    }
    const rect = range.getBoundingClientRect()
    const hostRect = contentRef.current.getBoundingClientRect()
    setSelectionAction({
      text: selectedText,
      left: Math.max(54, rect.left - hostRect.left + rect.width / 2),
      top: Math.max(6, rect.top - hostRect.top - 42),
    })
  }

  const addSelectionToChat = () => {
    if (!selectionAction) return
    onQuoteSelection?.(selectionAction.text)
    setSelectionAction(null)
    window.getSelection()?.removeAllRanges()
  }

  const copyAction = textToCopy.trim() ? (
    <button
      type="button"
      onClick={copyMessage}
      className={[
        'mt-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px]',
        'text-on-surface-variant opacity-0 shadow-sm backdrop-blur transition group-hover/message:opacity-100',
        'hover:border-primary/50 hover:text-on-surface focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/50',
      ].join(' ')}
      aria-label="Copy message"
      title="Copy message"
    >
      <span className="material-symbols-outlined text-[13px]">
        {copied ? 'check' : 'content_copy'}
      </span>
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  ) : null

  const selectionPopover = selectionAction ? (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        addSelectionToChat()
      }}
      className="absolute z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-[#2d2d2d] px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-black/30 transition hover:bg-[#3a3a3a] focus:outline-none focus:ring-2 focus:ring-primary/60"
      style={{ left: selectionAction.left, top: selectionAction.top }}
    >
      <span className="material-symbols-outlined text-[14px]">add_comment</span>
      Add to chat
    </button>
  ) : null

  // Tool pill — no avatar, compact
  if (isTool) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs text-on-surface-variant font-mono">
          <span className="material-symbols-outlined text-[14px] text-primary">build</span>
          <span>{m.toolName ?? 'tool'}</span>
          {m.content && <span className="opacity-60 truncate max-w-[240px]">{m.content}</span>}
        </div>
      </div>
    )
  }

  const color = agentColorKey ? (AGENT_COLOR[agentColorKey] ?? DEFAULT_COLOR) : DEFAULT_COLOR
  const displayEvents: ChatEvent[] = liveEvents.length
    ? liveEvents
    : ((m.events ?? []) as ChatEvent[])
  const activity = currentActivity(displayEvents, elapsed)
  const tasks = taskRows(displayEvents)
  const safeReasoning = reasoningSummary(displayEvents)
  const attachments = m.attachments ?? []
  const attachmentList = attachments.length > 0 ? (
    <div className="mt-2 grid gap-2">
      {attachments.map((attachment) => {
        const image = isImageAttachment(attachment)
        const size = formatBytes(attachment.sizeBytes)
        if (image) {
          return (
            <button
              key={attachment.id}
              type="button"
              aria-label={`Open ${attachment.name}`}
              onClick={() => setPreviewAttachment(attachment)}
              className="group relative block overflow-hidden rounded-xl border border-white/15 bg-black/20 text-left transition hover:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/60"
            >
              <img
                src={attachment.url}
                alt={attachment.name}
                className="max-h-52 w-full min-w-[220px] object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-black/70 px-3 py-2 text-xs text-white opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
                <span className="min-w-0 truncate">{attachment.name}</span>
                {size && <span className="shrink-0 text-white/70">{size}</span>}
              </span>
            </button>
          )
        }

        return (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/10 px-3 py-2 text-xs transition hover:border-primary/70"
          >
            <span className="material-symbols-outlined text-[16px]">attach_file</span>
            <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
            {size && <span className="shrink-0 opacity-60">{size}</span>}
          </a>
        )
      })}
    </div>
  ) : null
  const previewDialog = previewAttachment ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={previewAttachment.name}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={() => setPreviewAttachment(null)}
    >
      <div className="max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{previewAttachment.name}</p>
            <p className="text-xs text-white/60">{formatBytes(previewAttachment.sizeBytes)}</p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewAttachment(null)}
            aria-label="Close image preview"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <img
          src={previewAttachment.url}
          alt={previewAttachment.name}
          className="max-h-[82vh] max-w-full rounded-lg object-contain"
        />
      </div>
    </div>
  ) : null

  // User's own message — float right, no avatar
  if (isMine) {
    return (
      <>
        <div className="flex justify-end">
          <div className="group/message max-w-[85%] lg:max-w-[80%] text-right">
            <div ref={contentRef} className="relative inline-block text-left">
              {selectionPopover}
              <div
                onMouseUp={handleTextSelection}
                className="rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] lg:text-sm whitespace-pre-wrap bg-[var(--color-card-active,rgba(255,255,255,0.08))] lg:bg-primary lg:text-on-primary text-on-surface"
              >
              {m.content}
              {attachmentList}
              </div>
            </div>
            <div className="flex justify-end">{copyAction}</div>
          </div>
        </div>
        {previewDialog}
      </>
    )
  }

  // Other (agent or another user)
  const isAgent = m.authorKind === 'agent'
  const eventSummary = displayEvents.length > 0 ? summarizeEvents(displayEvents) : ''

  return (
    <div className="flex justify-start gap-2.5 w-full lg:gap-2.5">
      {/* Avatar — hidden on mobile for cleaner prose-style look */}
      <div className="shrink-0 mt-0.5 hidden lg:block">
        {isAgent ? (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${color.bg}`}>
            <span className={`material-symbols-outlined text-[16px] ${color.text}`}>
              {agentIconKey ?? 'smart_toy'}
            </span>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 text-xs font-bold text-on-surface">
            {initials(m.authorDisplayName)}
          </div>
        )}
      </div>

      {/* Bubble content */}
      <div className="group/message max-w-full lg:max-w-[78%] flex-1 min-w-0">
        {/* Author label — hidden on mobile */}
        <p className={`hidden lg:block text-[10px] font-medium mb-1 ${isAgent ? color.text : 'text-on-surface-variant'}`}>
          {m.authorDisplayName}
        </p>

        {/* Live events (while pending/streaming/waiting) */}
        {(isPending || isWaiting) && (
          <div className="mb-1 space-y-1">
            <div className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                    <span className="inline-flex gap-0.5 text-primary">
                      <span className="animate-bounce [animation-delay:0ms]">·</span>
                      <span className="animate-bounce [animation-delay:150ms]">·</span>
                      <span className="animate-bounce [animation-delay:300ms]">·</span>
                    </span>
                    Current activity
                  </div>
                  <p className="mt-1 truncate text-xs font-medium text-on-surface">
                    {activity.label}
                  </p>
                  {activity.detail && (
                    <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">
                      {activity.detail}
                    </p>
                  )}
                </div>
                {elapsed > 0 && (
                  <span className="shrink-0 rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
                    {elapsed}s
                  </span>
                )}
              </div>

              {tasks.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                  {tasks.map((task) => {
                    const done = /done|completed|complete/i.test(task.status)
                    const active = /progress|doing|active|running/i.test(task.status)
                    return (
                      <div key={task.key} className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                        <span className={[
                          'material-symbols-outlined text-[13px]',
                          done ? 'text-emerald-300' : active ? 'text-primary' : 'text-on-surface-variant/60',
                        ].join(' ')}>
                          {done ? 'check_circle' : active ? 'radio_button_checked' : 'radio_button_unchecked'}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {safeReasoning && (
                <details className="mt-2 border-t border-white/10 pt-2 text-[11px] text-on-surface-variant">
                  <summary className="cursor-pointer select-none text-on-surface">Reasoning summary</summary>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{safeReasoning}</p>
                </details>
              )}
            </div>
            {displayEvents.length > 0 && (
              <details className="text-on-surface-variant group/details">
                <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px] hover:bg-white/[0.04]">
                  <span className="material-symbols-outlined text-[13px] opacity-70 transition-transform group-open/details:rotate-90">chevron_right</span>
                  <span>Tool activity</span>
                  <span className="rounded-full bg-white/8 px-1.5 py-0.5 font-mono text-[10px] opacity-70">
                    {displayEvents.length}
                  </span>
                </summary>
                <div className="mt-1 space-y-1">
                  {displayEvents.slice(-8).map((ev, i) => (
                    <div
                      key={i}
                      className="flex items-baseline gap-2 rounded-md bg-[var(--color-card,rgba(255,255,255,0.03))] px-2 py-1 text-xs text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined text-[12px] text-primary/70 shrink-0">
                        {ev.event === 'assistant.text_delta' ? 'edit_note' : ev.event === 'heartbeat' ? 'sync' : 'build'}
                      </span>
                      {ev.tool && <span className="text-primary font-mono shrink-0">{ev.tool}</span>}
                      <span className="font-mono opacity-50 shrink-0">{ev.event ?? 'event'}</span>
                      {(ev.preview || ev.delta) && <span className="truncate opacity-70">{ev.preview ?? ev.delta}</span>}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {onStopRun && m.runId && (
              <button
                type="button"
                onClick={onStopRun}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/10"
              >
                <span className="material-symbols-outlined text-[13px]">stop_circle</span>
                Stop run
              </button>
            )}
          </div>
        )}

        {/* Completed tool-call timeline (collapsible) */}
        {displayEvents.length > 0 && !isPending && !isWaiting && (
          <details className="my-2 text-on-surface-variant group/details">
            <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5 py-1 -mx-1 px-1 rounded hover:bg-[var(--color-card,rgba(255,255,255,0.03))] text-[13px] lg:text-xs">
              <span className="opacity-60 group-open/details:rotate-90 transition-transform text-[14px] leading-none">›</span>
              <span className="opacity-80">{eventSummary}</span>
            </summary>
            <div className="mt-1 space-y-0.5 pl-3 border-l border-[var(--color-card-border)] text-xs">
              {displayEvents.map((ev, i) => {
                const ts = ev.timestamp
                  ? new Date(ev.timestamp * 1000).toISOString().slice(11, 19)
                  : null
                const toolLabel = ev.tool || ev.event
                return (
                  <div key={i} className="flex items-center gap-2 py-0.5">
                    {ts && <span className="font-mono opacity-40 shrink-0">{ts}</span>}
                    {toolLabel && (
                      <span className="text-primary font-mono shrink-0">{toolLabel}</span>
                    )}
                    {ev.preview && <span className="truncate opacity-70">{ev.preview}</span>}
                  </div>
                )
              })}
            </div>
          </details>
        )}

        {/* The bubble itself — plain prose on mobile, bubble on desktop */}
        <div ref={contentRef} className="relative">
          {selectionPopover}
          <div
            onMouseUp={handleTextSelection}
            className={
              isFailed
                ? 'rounded-2xl rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap bg-red-500/15 text-red-200 border border-red-500/40'
                : [
                    // Mobile: plain prose, no background, larger readable text
                    'text-[15px] leading-relaxed text-on-surface whitespace-pre-wrap',
                    // Desktop: keep the bubble look
                    'lg:rounded-2xl lg:rounded-tl-md lg:px-4 lg:py-2.5 lg:text-sm lg:bg-[var(--color-card-active,rgba(255,255,255,0.06))]',
                  ].join(' ')
            }
          >
            {isPending && !m.content && (
              <span className="opacity-40 italic text-xs">Waiting for agent activity...</span>
            )}
            {isWaiting && !m.content && (
              <span className="opacity-70 italic">Paused — awaiting tool approval…</span>
            )}
            {m.content || (isFailed && m.error) || null}
            {attachmentList}
          </div>
        </div>
        {copyAction}
      </div>
      {previewDialog}
    </div>
  )
}
