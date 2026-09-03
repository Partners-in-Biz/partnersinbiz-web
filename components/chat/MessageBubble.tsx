'use client'

import { Icon } from '@/components/studio'
/* eslint-disable @next/next/no-img-element -- Conversation attachments use arbitrary Firebase Storage URLs. */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ChatEvent, ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import { normalizeWorkspacePanel, WORKSPACE_PANEL_EVENT } from '@/lib/hermes/workspace-panels'
import {
  dedupeStructured,
  extractMixedRichContent,
  isRichPayloadText,
  richPartsFromPayload,
  uiActionsFromPayload,
} from '@/lib/hermes/rich-messages'
import type { ContextReference } from '@/lib/context-references/types'
import type { SlashCommandPayload } from '@/lib/chat/slash-commands'
import { copyToClipboard } from '@/lib/utils/clipboard'
import { normalizeStudioArtifactPart } from '@/lib/chat-context/artifactPayload'
import type { ChatArtifactSummary } from '@/lib/chat-context/types'
import {
  decodeRevealRedaction,
  labelForRevealKind,
  type RevealRedactionKind,
} from '@/lib/linked-computers/reveal-redaction'
import type { Mention } from '@/lib/comments/types'
import { ContextArtifactBundle } from './context/ContextArtifactBundle'
import { DesignAuditCard } from './DesignAuditCard'
import { DesignIterationCard } from './DesignIterationCard'
import {
  buildThinkingTrace,
  liveReasoningText,
  summarizeToolEvents,
  type MessageThinkingTrace,
} from '@/lib/conversations/thinking-trace'
import { humanizeConversationRunError } from '@/lib/conversations/run-policy'

// Matches Phase 1 ConversationMessage shape
export interface ConversationMessage {
  id: string
  conversationId: string
  role: string
  content: string
  mentions?: Mention[]
  mentionIds?: string[]
  attachments?: ConversationAttachment[]
  contextRefs?: ContextReference[]
  slashCommand?: SlashCommandPayload
  model?: string
  provider?: string
  runId?: string
  status?: string
  queuedReason?: 'runtime_capacity' | 'agent_capacity' | 'gateway_draining' | 'runtime_restarting'
  error?: string
  events?: unknown[]
  thinking?: MessageThinkingTrace
  richParts?: RichMessagePart[]
  uiActions?: ChatUiAction[]
  toolName?: string
  authorKind: 'user' | 'agent' | 'system'
  authorId: string
  authorDisplayName: string
  dispatchAgentId?: string
  dispatchRuntimeTargetId?: string
  dispatchRuntimeKind?: string
  dispatchRuntimeLabel?: string
  acceptedDevice?: { machineLabel: string; runtimeVersion: string; acceptedAt: string }
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
  violet:  { bg: 'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]',  text: 'text-[var(--st-info)]',  dot: 'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]' },
  sky:     { bg: 'bg-sky-600/20',     text: 'text-sky-300',     dot: 'bg-sky-400' },
  amber:   { bg: 'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]',   text: 'text-[var(--st-warning)]',   dot: 'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]' },
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
  onUiAction?: (message: ConversationMessage, action: ChatUiAction) => void | Promise<void>
}

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

function queuedRunDetail(reason: ConversationMessage['queuedReason']): string {
  switch (reason) {
    case 'gateway_draining':
      return 'The local gateway is draining; this run will start automatically.'
    case 'agent_capacity':
      return 'The selected agent is at its temporary chat limit; this run will start automatically.'
    case 'runtime_restarting':
      return 'The linked runtime is reconnecting; this run will resume automatically.'
    case 'runtime_capacity':
      return 'The linked computer is at its configured chat limit; this run will start automatically.'
    default:
      return 'This request is waiting for the linked computer to start it automatically.'
  }
}

function queuedRunPlaceholder(reason: ConversationMessage['queuedReason']): string {
  return reason
    ? 'Queued - it will start automatically when the linked computer is ready.'
    : 'Waiting for the linked computer to start…'
}

function useElapsed(active: boolean, createdAt?: ConversationMessage['createdAt']): number {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    if (!active) return
    const rawSeconds = typeof createdAt === 'object' && createdAt
      ? createdAt.seconds ?? createdAt._seconds
      : undefined
    const parsed = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN
    const startedAt = Number.isFinite(rawSeconds)
      ? Number(rawSeconds) * 1000
      : Number.isFinite(parsed) ? parsed : Date.now()
    const reset = setTimeout(() => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 0)
    const tick = setInterval(() => {
      setSecs(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => {
      clearTimeout(reset)
      clearInterval(tick)
    }
  }, [active, createdAt])

  return active ? secs : 0
}

// Categorize tool-call events into a short human summary like
// "Ran 6 commands, read 2 files, wrote 1 file".
function summarizeEvents(events: ChatEvent[]): string {
  return summarizeToolEvents(events)
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

function truncateConsoleText(value: string, limit = 1200): string {
  const cleaned = value.replace(/\r\n/g, '\n').trimEnd()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, limit).trimEnd()}\n… truncated`
}

function consoleTextForEvent(event: ChatEvent): string {
  const parts: string[] = []
  const input = event.input ?? event.preview
  const output = event.output ?? event.stdout
  if (input && event.event !== 'assistant.text_delta') parts.push(`$ ${truncateConsoleText(input, 700)}`)
  if (output) parts.push(truncateConsoleText(output))
  if (event.stderr) parts.push(truncateConsoleText(event.stderr))
  if (!parts.length && event.delta) parts.push(truncateConsoleText(event.delta, 260))
  if (!parts.length && event.activity) parts.push(event.activity)
  return parts.join('\n')
}

function commandConsoleRows(events: ChatEvent[]): Array<{
  key: string
  status: 'running' | 'done' | 'failed' | 'info'
  label: string
  meta: string
  body: string
}> {
  return events
    .filter((event) => {
      const name = event.event ?? ''
      return name !== 'assistant.text_delta'
        && name !== 'heartbeat'
        && name !== 'reasoning.delta'
        && name !== 'reasoning.summary'
    })
    .map((event, index) => {
      const failed = Boolean(event.error) || (typeof event.exitCode === 'number' && event.exitCode !== 0)
      const status: 'running' | 'done' | 'failed' | 'info' = failed
        ? 'failed'
        : event.event === 'tool.started' || event.event === 'tool.input_delta'
          ? 'running'
          : event.event === 'tool.completed' || event.event === 'run.completed'
            ? 'done'
            : 'info'
      const seconds = event.timestamp
        ? new Date(event.timestamp > 10_000_000_000 ? event.timestamp : event.timestamp * 1000).toISOString().slice(11, 19)
        : '--:--:--'
      const duration = typeof event.durationMs === 'number'
        ? `${event.durationMs}ms`
        : typeof event.duration === 'number'
          ? `${event.duration}ms`
          : ''
      const exit = typeof event.exitCode === 'number' ? `exit ${event.exitCode}` : ''
      return {
        key: `${index}:${event.event ?? 'event'}:${event.tool ?? ''}`,
        status,
        label: event.tool ?? eventLabel(event),
        meta: [seconds, event.event, duration, exit].filter(Boolean).join(' · '),
        body: consoleTextForEvent(event),
      }
    })
    .slice(-24)
}

function currentActivity(events: ChatEvent[], elapsed: number, hasRunId: boolean): { label: string; detail?: string } {
  const meaningful = events.filter((event) => event.event !== 'assistant.text_delta')
  const latest = meaningful.at(-1) ?? events.at(-1)
  if (!latest) {
    if (!hasRunId) {
      return {
        label: 'Starting agent',
        detail: 'Waiting for the server to create a run...',
      }
    }
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

function formatThinkingDuration(durationMs?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 500) return null
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  return rem ? `${minutes}m ${rem}s` : `${minutes}m`
}

function thoughtHeaderLabel(thinking: MessageThinkingTrace, liveElapsed?: number): string {
  if (typeof liveElapsed === 'number' && liveElapsed > 0) return `Thought for ${liveElapsed}s`
  const duration = formatThinkingDuration(thinking.durationMs)
  return duration ? `Thought for ${duration}` : 'Thought'
}

function ThoughtStream({
  thinking,
  live = false,
  liveElapsed,
  onStopRun,
  showStop,
}: {
  thinking: MessageThinkingTrace
  live?: boolean
  liveElapsed?: number
  onStopRun?: () => void
  showStop?: boolean
}) {
  const header = thoughtHeaderLabel(thinking, live ? liveElapsed : undefined)
  const segments = thinking.segments?.length
    ? thinking.segments
    : [
        ...(thinking.summary ? [{ kind: 'thought' as const, text: thinking.summary }] : []),
        ...(thinking.toolCount > 0
          ? [{
              kind: 'tools' as const,
              summary: thinking.steps.length
                ? summarizeToolEvents(
                    thinking.steps
                      .filter((step) => step.kind === 'tool')
                      .map((step) => ({ event: 'tool.completed', tool: step.label })),
                  ) || `${thinking.toolCount} tool${thinking.toolCount === 1 ? '' : 's'}`
                : `${thinking.toolCount} tool${thinking.toolCount === 1 ? '' : 's'}`,
            }]
          : []),
      ]

  const thoughtText = segments
    .filter((segment) => segment.kind === 'thought' && segment.text)
    .map((segment) => segment.text)
    .join('\n\n')
    || thinking.summary
    || ''

  const toolLines = segments
    .filter((segment) => segment.kind === 'tools' && segment.summary)
    .map((segment) => segment.summary as string)

  return (
    <div className="mb-1.5 space-y-1" data-testid="message-thinking-disclosure" aria-label="Thought process">
      <details
        open={live || undefined}
        className="group/thinking"
      >
        <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 py-0.5 text-[12px] text-[var(--color-pib-text-muted)] [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-[var(--color-pib-text-muted)]/90">{header}</span>
          <span className="text-[11px] opacity-50 transition-transform group-open/thinking:rotate-90">›</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {live && typeof liveElapsed === 'number' && liveElapsed > 0 && (
              <span className="font-mono text-[10px] opacity-60">{liveElapsed}s</span>
            )}
            {showStop && onStopRun && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onStopRun()
                }}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-200 hover:bg-red-500/15"
              >
                <Icon name="stop" className="text-[12px]" />
                Stop
              </button>
            )}
          </span>
        </summary>
        {thoughtText ? (
          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-pib-text)]/80">
            {thoughtText}
          </p>
        ) : live ? (
          <p className="mt-1 text-[12px] italic text-[var(--color-pib-text-muted)]/70">Thinking…</p>
        ) : null}
      </details>
      {toolLines.map((line, index) => (
        <p
          key={`${line}-${index}`}
          className="pl-0.5 text-[11px] leading-snug text-[var(--color-pib-text-muted)]/65"
        >
          {line}
        </p>
      ))}
    </div>
  )
}

function isImageAttachment(attachment: ConversationAttachment): boolean {
  return attachment.contentType.toLowerCase().startsWith('image/')
}

function isVideoAttachment(attachment: ConversationAttachment): boolean {
  return attachment.contentType.toLowerCase().startsWith('video/')
}

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    void 0
    return null
  }
}

function isGoogleDriveBrowserUrl(url: string): boolean {
  const parsed = parsedUrl(url)
  if (!parsed) return false
  const hostname = parsed.hostname.toLowerCase()
  return hostname === 'drive.google.com'
    || hostname === 'docs.google.com'
    || hostname.endsWith('.drive.google.com')
    || hostname.endsWith('.docs.google.com')
}

function urlPathHasVideoExtension(url: string): boolean {
  const parsed = parsedUrl(url)
  const path = parsed ? parsed.pathname : url.split('?')[0] ?? url
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    decoded = path
  }
  return /\.(mp4|webm|mov|m4v)$/i.test(decoded)
}

function isStorageDirectMediaUrl(url: string): boolean {
  const parsed = parsedUrl(url)
  if (!parsed) return false
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'firebasestorage.googleapis.com') return parsed.searchParams.get('alt') === 'media'
  return hostname === 'storage.googleapis.com' || hostname.endsWith('.storage.googleapis.com')
}

function isInlinePlayableVideoUrl(url: string, mimeType?: string): boolean {
  if (url.startsWith('blob:')) return true
  const parsed = parsedUrl(url)
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return false
  if (isGoogleDriveBrowserUrl(url)) return false
  if (urlPathHasVideoExtension(url)) return true
  return Boolean(mimeType?.toLowerCase().startsWith('video/') && isStorageDirectMediaUrl(url))
}

function videoLabel(name?: string, caption?: string): string {
  return name ?? caption ?? 'Generated video'
}

function VideoOpenLink({ url, label, suffix }: { url: string; label: string; suffix?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-[var(--color-pib-text)] transition hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
      aria-label={`Open ${label}${suffix ?? ''}`}
    >
      <Icon name="open_in_new" className="text-[14px]" />
      <span className="truncate">Open {label}{suffix}</span>
    </a>
  )
}

function NonEmbeddableVideoFallback({ url, name, caption }: { url: string; name?: string; caption?: string }) {
  const label = videoLabel(name, caption)
  return (
    <div className="my-2 rounded-[6px] border border-amber-400/25 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] p-3 text-[var(--color-pib-text)]">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-[var(--st-warning)]">
        <Icon name="movie_info" className="text-[16px]" />
        <span>{label}</span>
      </div>
      <p className="mb-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
        This generated video link cannot be previewed safely inline. Open it in a browser to view or download it.
      </p>
      <VideoOpenLink url={url} label={label} suffix=" in browser" />
    </div>
  )
}

function InlineVideoPreview({ url, name, caption }: { url: string; name?: string; caption?: string }) {
  const label = videoLabel(name, caption)
  return (
    <figure className="my-2 overflow-hidden rounded-[6px] border border-white/10 bg-black/20">
      <video controls playsInline preload="metadata" src={url} aria-label={label} className="max-h-80 w-full bg-black" />
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
        <span className="min-w-0 truncate">{caption ?? name ?? 'Video preview'}</span>
        <VideoOpenLink url={url} label={label} />
      </figcaption>
    </figure>
  )
}

function VideoPreviewOrFallback({ url, name, caption, mimeType }: { url: string; name?: string; caption?: string; mimeType?: string }) {
  return isInlinePlayableVideoUrl(url, mimeType)
    ? <InlineVideoPreview url={url} name={name} caption={caption} />
    : <NonEmbeddableVideoFallback url={url} name={name} caption={caption} />
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function hasRichChatMarkup(content: string): boolean {
  return /(^|\n)```/.test(content)
    || /(^|\n)\s{0,3}#{1,4}\s+\S/.test(content)
    || /(^|\n)\s*[-*]\s+\S/.test(content)
    || /(^|\n)\s*\d+\.\s+\S/.test(content)
    || /(^|\n)\s*\|?.+\|.+\|?\s*\n\s*\|?\s*:?-{3,}:?\s*\|/.test(content)
    || /(^|\n)\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.test(content)
    || /<svg\b[\s\S]*<\/svg>/i.test(content)
    || /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(content)
    || /`[^`]+`|\*\*[^*]+\*\*/.test(content)
}

const BARE_URL_PATTERN = /https?:\/\/[^\s<>"`]+/g
const TRAILING_URL_PUNCTUATION = /[.,!?;:]+$/

function splitUrlToken(token: string): { url: string; trailing: string } {
  let url = token
  let trailing = ''
  while (TRAILING_URL_PUNCTUATION.test(url)) {
    trailing = url.slice(-1) + trailing
    url = url.slice(0, -1)
  }
  if (url.endsWith(')') && !url.includes('(')) {
    trailing = `)${trailing}`
    url = url.slice(0, -1)
  }
  return { url, trailing }
}

function hasBareUrl(content: string): boolean {
  BARE_URL_PATTERN.lastIndex = 0
  return BARE_URL_PATTERN.test(content)
}

function isImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return /\.(png|jpe?g|gif|webp|avif)$/i.test(parsed.pathname)
  } catch {
    void 0
    return false
  }
}

function bareUrls(content: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  BARE_URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BARE_URL_PATTERN.exec(content)) !== null) {
    const { url } = splitUrlToken(match[0])
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

const REDACTED_URL_HINT =
  'Sensitive or private URL removed from linked-computer output for safety. Older messages cannot recover the original; new runs store click to reveal markers.'
const REVEAL_HINT = 'Hidden for safety. Click to show the original value.'

function RevealableRedactionChip({
  kind,
  encoded,
}: {
  kind: RevealRedactionKind
  encoded: string
}) {
  const [open, setOpen] = useState(false)
  const value = decodeRevealRedaction(encoded)
  const label = labelForRevealKind(kind)
  if (!value) {
    return (
      <abbr
        title={REDACTED_URL_HINT}
        className="cursor-help rounded bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--st-warning)]/90 no-underline decoration-dotted"
      >
        [{label}]
      </abbr>
    )
  }
  if (!open) {
    return (
      <button
        type="button"
        title={REVEAL_HINT}
        onClick={() => setOpen(true)}
        className="inline max-w-full cursor-pointer rounded bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--st-warning)] underline decoration-dotted underline-offset-2 hover:bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]"
      >
        [{label}]
      </button>
    )
  }
  return (
    <button
      type="button"
      title="Click to hide again"
      onClick={() => setOpen(false)}
      className="inline max-w-full cursor-pointer break-all rounded bg-emerald-500/10 px-1 py-0.5 text-left font-mono text-[0.9em] text-emerald-100 underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere] hover:bg-emerald-500/20"
    >
      {value}
    </button>
  )
}

function linkifyBareUrlsOnly(text: string, keyPrefix: string, mentions?: Mention[]): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  BARE_URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BARE_URL_PATTERN.exec(text)) !== null) {
    const rawToken = match[0]
    const { url, trailing } = splitUrlToken(rawToken)
    if (!url) continue
    if (match.index > lastIndex) nodes.push(...renderMentions(text.slice(lastIndex, match.index), `${keyPrefix}-text-${match.index}`, mentions))
    nodes.push(
      <a
        key={`${keyPrefix}-url-${match.index}`}
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-block max-w-full overflow-hidden break-words text-primary underline decoration-primary/50 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-primary"
      >
        {url}
      </a>,
    )
    if (trailing) nodes.push(trailing)
    lastIndex = match.index + rawToken.length
  }
  if (lastIndex < text.length) nodes.push(...renderMentions(text.slice(lastIndex), `${keyPrefix}-text-end`, mentions))
  return nodes
}

const MENTION_PATTERN = /@(user|agent):[a-zA-Z0-9_-]+/g
const MENTION_SCAN_PATTERN = /@(user|agent):[a-zA-Z0-9_-]+/

function mentionStyleFor(mentionText: string, mentions?: Mention[]): { border: string; bg: string; text: string; title: string } {
  const match = mentions?.find((item) => item.raw === mentionText)
  const type = match?.type ?? (mentionText.startsWith('@agent:') ? 'agent' : mentionText.startsWith('@user:') ? 'user' : null)
  if (type === 'agent') {
    return {
      border: 'border-violet-400/30',
      bg: 'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]',
      text: 'text-[var(--st-info)]',
      title: `@agent mention ${match?.id ? `(${match.id})` : ''}`.trim(),
    }
  }
  return {
    border: 'border-sky-400/30',
    bg: 'bg-sky-500/10',
    text: 'text-sky-100',
    title: `@user mention ${match?.id ? `(${match.id})` : ''}`.trim(),
  }
}

function renderMentions(text: string, keyPrefix: string, mentions?: Mention[]): ReactNode[] {
  if (!text || !MENTION_PATTERN.test(text)) return [text]
  MENTION_PATTERN.lastIndex = 0
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MENTION_PATTERN.exec(text)) !== null) {
    const raw = match[0]
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const style = mentionStyleFor(raw, mentions)
    nodes.push(
      <span
        key={`${keyPrefix}-mention-${match.index}`}
        className={`inline-flex rounded border ${style.border} ${style.bg} ${style.text} px-1.5 py-0.5 text-[0.85em]`}
        title={style.title}
      >
        {raw}
      </span>,
    )
    lastIndex = match.index + raw.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

const REVEAL_OR_LEGACY_SPLIT =
  /(\[\[pib-reveal:(?:path|url|token)\|[A-Za-z0-9_-]{1,12000}\]\]|\[redacted-url\])/g

/** Linkify bare URLs and render redaction chips (click to reveal when recoverable). */
function linkifyBareUrls(text: string, keyPrefix: string, mentions?: Mention[]): ReactNode[] {
  if (!text.includes('[redacted-url]') && !text.includes('[[pib-reveal:')) {
    return linkifyBareUrlsOnly(text, keyPrefix, mentions)
  }
  const nodes: ReactNode[] = []
  const parts = text.split(REVEAL_OR_LEGACY_SPLIT)
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (!part) continue
    if (part === '[redacted-url]') {
      nodes.push(
        <abbr
          key={`${keyPrefix}-redacted-url-${i}`}
          title={REDACTED_URL_HINT}
          className="cursor-help rounded bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--st-warning)]/90 no-underline decoration-dotted"
        >
          [redacted-url]
        </abbr>,
      )
      continue
    }
    const reveal = part.match(/^\[\[pib-reveal:(path|url|token)\|([A-Za-z0-9_-]+)\]\]$/)
    if (reveal) {
      nodes.push(
        <RevealableRedactionChip
          key={`${keyPrefix}-reveal-${i}`}
          kind={reveal[1] as RevealRedactionKind}
          encoded={reveal[2]!}
        />,
      )
      continue
    }
    nodes.push(...linkifyBareUrlsOnly(part, `${keyPrefix}-${i}`, mentions))
  }
  return nodes
}

function BareUrlPreviews({ content }: { content: string }) {
  const imageUrls = bareUrls(content).filter(isImageUrl)
  if (!imageUrls.length) return null
  return (
    <div className="mt-2 grid gap-2">
      {imageUrls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="group block overflow-hidden rounded-[6px] border border-white/15 bg-black/20 transition hover:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/60"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={url} className="max-h-52 w-full min-w-[220px] object-cover" />
          <span className="block truncate border-t border-white/10 px-3 py-2 text-xs text-[var(--color-pib-text-muted)] group-hover:text-[var(--color-pib-text)]">
            {url}
          </span>
        </a>
      ))}
    </div>
  )
}


interface DeviceAuthInstruction {
  providerLabel: string
  url: string
  code: string
  expiryOrStatus?: string
  fullLink?: string
}

const AUTH_CODE_PATTERN = /(?:\b(?:user[_ -]?code|device[_ -]?code|verification\s+code|login\s+code|code)\b\s*(?:is|:|=)?\s*)([A-Z0-9][A-Z0-9-]{3,31}[A-Z0-9])/i
const AUTH_HINT_PATTERN = /\b(device\s+(?:login|auth|authorization)|auth(?:enticate|entication| link)?|login\s+code|verification\s+code|user[_ -]?code|device[_ -]?code)\b/i
const SENSITIVE_URL_PARAM_PATTERN = /(^|_)(token|secret|key|password|signature|session|credential)s?$/i

function safeAuthUrlParts(rawUrl: string): { baseUrl: string; fullLink?: string; codeFromUrl?: string } | null {
  try {
    const parsed = new URL(rawUrl)
    const baseUrl = `${parsed.origin}${parsed.pathname}`
    let codeFromUrl: string | undefined
    for (const name of ['user_code', 'userCode', 'device_code', 'deviceCode', 'code']) {
      const value = parsed.searchParams.get(name)
      if (value && /^[A-Z0-9][A-Z0-9-]{3,31}[A-Z0-9]$/i.test(value)) {
        codeFromUrl = value.toUpperCase()
        break
      }
    }
    const hasSensitiveParam = Array.from(parsed.searchParams.keys()).some((key) => SENSITIVE_URL_PARAM_PATTERN.test(key))
    return {
      baseUrl,
      fullLink: parsed.search && !hasSensitiveParam ? rawUrl : undefined,
      codeFromUrl,
    }
  } catch {
    void 0
    return null
  }
}

function extractExpiryOrStatus(text: string): string | undefined {
  const status = text.match(/\bstatus\s*[:=]\s*([^\n.,;]{2,80})/i)?.[1]?.trim()
  const expiryMatch = text.match(/\b(?:expires?|expiration)\b\s*(in|at|:)?\s*([^\n.]{2,80})/i)
  const expiry = expiryMatch?.[2]?.trim().replace(/[,;]+$/, '')
  const expiryPrefix = expiryMatch?.[1]?.toLowerCase() === 'in' ? 'Expires in' : 'Expires'
  return [
    status ? `Status: ${status.replace(/[,;]+$/, '')}` : null,
    expiry ? `${expiryPrefix} ${expiry}` : null,
  ].filter(Boolean).join(' · ') || undefined
}


function extractDeviceAuthInstruction(text: string, tool?: string): DeviceAuthInstruction | null {
  if (!text || !AUTH_HINT_PATTERN.test(`${tool ?? ''}\n${text}`)) return null
  const urls = bareUrls(text)
  if (!urls.length) return null

  let selected: { baseUrl: string; fullLink?: string; codeFromUrl?: string } | null = null
  for (const candidate of urls) {
    const parts = safeAuthUrlParts(candidate)
    if (!parts) continue
    if (!selected || parts.codeFromUrl || /user[_-]?code|device[_-]?code|code=/i.test(candidate)) selected = parts
    if (parts.codeFromUrl) break
  }
  if (!selected) return null

  const regexCode = text.match(AUTH_CODE_PATTERN)?.[1]
  const code = (selected.codeFromUrl ?? regexCode)?.toUpperCase()
  if (!code) return null

  const providerSource = `${tool ?? ''} ${text}`
  const providerLabel = /higgsfield/i.test(providerSource)
    ? 'Higgsfield device login'
    : /hermes/i.test(providerSource)
      ? 'Hermes device login'
      : 'Device login'

  return {
    providerLabel,
    url: selected.baseUrl,
    code,
    expiryOrStatus: extractExpiryOrStatus(text),
    fullLink: selected.fullLink && selected.fullLink !== selected.baseUrl ? selected.fullLink : undefined,
  }
}

function CopyAuthValueButton({ label, value }: { label: string; value: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => { void copyToClipboard(value) }}
      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-[var(--color-pib-text)] transition hover:border-primary/50 hover:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-primary/50"
    >
      <Icon name="content_copy" className="text-[14px]" />
      Copy
    </button>
  )
}

function DeviceAuthCard({ instruction }: { instruction: DeviceAuthInstruction }) {
  return (
    <section aria-label="Device login instructions" className="my-2 max-w-full overflow-hidden rounded-[6px] border border-primary/25 bg-primary/5 p-3 text-[var(--color-pib-text)] shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon name="phonelink_lock" className="text-[17px] text-primary" />
        <span>{instruction.providerLabel}</span>
      </div>
      <dl className="space-y-2 text-xs">
        <div className="grid gap-1 rounded-lg bg-black/20 p-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center">
          <dt className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">URL</dt>
          <dd className="min-w-0 break-words font-mono text-primary [overflow-wrap:anywhere]">{instruction.url}</dd>
          <dd><CopyAuthValueButton label="Copy auth URL" value={instruction.url} /></dd>
        </div>
        <div className="grid gap-1 rounded-lg bg-black/20 p-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center">
          <dt className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Code</dt>
          <dd className="min-w-0 break-words font-mono text-base font-medium tracking-wide text-[var(--color-pib-text)] [overflow-wrap:anywhere]">{instruction.code}</dd>
          <dd><CopyAuthValueButton label="Copy auth code" value={instruction.code} /></dd>
        </div>
        {instruction.expiryOrStatus && (
          <div className="grid gap-1 rounded-lg bg-black/20 p-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center">
            <dt className="font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">Status</dt>
            <dd className="min-w-0 break-words text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">{instruction.expiryOrStatus}</dd>
          </div>
        )}
      </dl>
      {instruction.fullLink && (
        <a
          href={instruction.fullLink}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <Icon name="open_in_new" className="text-[14px]" />
          <span className="truncate">Open full auth link</span>
        </a>
      )}
    </section>
  )
}


function inlineMarkdown(text: string, mentions?: Mention[]): ReactNode[] {
  const nodes: ReactNode[] = []
  const tokenPattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(...linkifyBareUrls(text.slice(lastIndex, match.index), `plain-${match.index}`, mentions))
    if (match[2]) {
      nodes.push(
        <strong key={`strong-${match.index}`} className="font-medium text-[var(--color-pib-text)]">
          {renderMentions(match[2], `strong-${match.index}`, mentions)}
        </strong>,
      )
    } else if (match[3]) {
      nodes.push(<code key={`code-${match.index}`} className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.9em] text-primary">{match[3]}</code>)
    } else if (match[4] && match[5]) {
      nodes.push(
        <a key={`link-${match.index}`} href={match[5]} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
          {match[4]}
        </a>,
      )
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) nodes.push(...linkifyBareUrls(text.slice(lastIndex), `plain-${lastIndex}`, mentions))
  return nodes
}

function sanitizeInlineSvg(svg: string): string | null {
  const trimmed = svg.trim()
  if (!/^<svg\b[\s\S]*<\/svg>$/i.test(trimmed)) return null
  if (/<script\b|\son[a-z]+\s*=|javascript:/i.test(trimmed)) return null
  return trimmed
}

function parseMermaidNodes(source: string): { labels: string[] } {
  const labels = new Map<string, string>()
  const nodePattern = /([A-Za-z][\w-]*)(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?/g

  source.split('\n').forEach((line) => {
    if (/^\s*(flowchart|graph)\s+/i.test(line) || !line.trim()) return
    const arrow = line.match(/(.+?)(?:-->|---|==>|-\.->)(.+)/)
    if (!arrow) return
    ;[arrow[1], arrow[2]].forEach((part) => {
      nodePattern.lastIndex = 0
      const found = nodePattern.exec(part.trim())
      if (!found) return
      const id = found[1]
      const label = found[2] ?? found[3] ?? found[4] ?? id
      labels.set(id, label)
    })
  })

  return { labels: Array.from(labels.values()) }
}

function MermaidPreview({ source }: { source: string }) {
  const parsed = parseMermaidNodes(source)
  return (
    <div role="img" aria-label="Mermaid diagram" className="my-2 overflow-hidden rounded-[6px] border border-primary/25 bg-black/25 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-label uppercase tracking-wide text-primary">
        <Icon name="account_tree" className="text-[15px]" />
        Diagram
      </div>
      {parsed.labels.length > 0 ? (
        <div className="flex flex-col items-center gap-1.5 text-center text-xs text-[var(--color-pib-text)]">
          {parsed.labels.map((label, index) => (
            <div key={`${label}-${index}`} className="flex flex-col items-center gap-1.5">
              <div className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 shadow-sm">
                {inlineMarkdown(label)}
              </div>
              {index < parsed.labels.length - 1 && <span className="text-primary/80">↓</span>}
            </div>
          ))}
        </div>
      ) : (
        <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-black/35 p-2 font-mono text-[11px] text-[var(--color-pib-text-muted)]">{source}</pre>
      )}
    </div>
  )
}

function SvgPreview({ source }: { source: string }) {
  const safeSvg = sanitizeInlineSvg(source)
  if (!safeSvg) {
    return <pre className="my-2 overflow-auto whitespace-pre-wrap rounded-[6px] border border-white/10 bg-black/30 p-3 font-mono text-xs text-[var(--color-pib-text-muted)]">{source}</pre>
  }
  return (
    <div className="my-2 overflow-auto rounded-[6px] border border-primary/20 bg-white p-3 text-slate-950" dangerouslySetInnerHTML={{ __html: safeSvg }} />
  )
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const normalizedLanguage = language.trim().toLowerCase()
  if (/^(mermaid|mmd)$/.test(normalizedLanguage) || /^\s*(flowchart|graph)\s+/i.test(code)) {
    return <MermaidPreview source={code} />
  }
  if (/^(svg|html)$/.test(normalizedLanguage) && /<svg\b[\s\S]*<\/svg>/i.test(code)) {
    return <SvgPreview source={code} />
  }
  return (
    <pre className="my-2 max-h-96 overflow-auto rounded-[6px] border border-white/10 bg-black/35 p-3 font-mono text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
      <code>{code}</code>
    </pre>
  )
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  const unwrapped = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let escaped = false

  for (const char of unwrapped) {
    if (escaped) {
      cell += char
      escaped = false
    } else if (char === '\\') {
      escaped = true
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells.length >= 2 ? cells : null
}

function tableAlignment(line: string): ('left' | 'center' | 'right')[] | null {
  const cells = tableCells(line)
  if (!cells || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
    if (cell.endsWith(':')) return 'right'
    return 'left'
  })
}

function MarkdownTable({
  headers,
  alignments,
  rows,
  mentions,
}: {
  headers: string[]
  alignments: ('left' | 'center' | 'right')[]
  rows: string[][]
  mentions?: Mention[]
}) {
  const normalizeRow = (row: string[]) => {
    const normalized = row.slice(0, headers.length)
    while (normalized.length < headers.length) normalized.push('')
    return normalized
  }

  return (
    <div className="my-3 max-w-full overflow-x-auto rounded-[6px] border border-white/10 bg-black/15 shadow-sm">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-white/[0.06] text-[var(--color-pib-text)]">
          <tr>
            {headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                scope="col"
                className="border-b border-white/10 px-3 py-2 align-top text-xs font-medium"
                style={{ textAlign: alignments[index] ?? 'left' }}
              >
                {inlineMarkdown(header, mentions)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10 text-[var(--color-pib-text-muted)]">
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="align-top">
              {normalizeRow(row).map((cell, cellIndex) => (
                <td
                  key={`cell-${rowIndex}-${cellIndex}`}
                  className="max-w-[20rem] break-words px-3 py-2 leading-relaxed [overflow-wrap:anywhere]"
                  style={{ textAlign: alignments[cellIndex] ?? 'left' }}
                >
                  {inlineMarkdown(cell, mentions)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderMarkdownBlocks(content: string, mentions?: Mention[]): ReactNode[] {
  const nodes: ReactNode[] = []
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const pushPlain = (plain: string, baseKey: string) => {
    const lines = plain.split('\n')
    let paragraph: string[] = []
    const flushParagraph = () => {
      if (!paragraph.length) return
      const text = paragraph.join('\n').trim()
      if (text) nodes.push(<p key={`${baseKey}-p-${nodes.length}`} className="my-1.5 whitespace-pre-wrap">{inlineMarkdown(text, mentions)}</p>)
      paragraph = []
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/)
      const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)
      const headerCells = tableCells(line)
      const separatorAlignments = index + 1 < lines.length ? tableAlignment(lines[index + 1]) : null
      const diagramStart = line.match(/^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i)
      const svgStart = line.match(/^\s*<svg\b/i)

      if (diagramStart) {
        flushParagraph()
        const block: string[] = [line]
        while (index + 1 < lines.length && lines[index + 1].trim()) {
          block.push(lines[index + 1])
          index += 1
        }
        nodes.push(<MermaidPreview key={`${baseKey}-diagram-${nodes.length}`} source={block.join('\n')} />)
      } else if (svgStart) {
        flushParagraph()
        const block: string[] = [line]
        while (index + 1 < lines.length && !/<\/svg>\s*$/i.test(lines[index])) {
          block.push(lines[index + 1])
          index += 1
        }
        nodes.push(<SvgPreview key={`${baseKey}-svg-${nodes.length}`} source={block.join('\n')} />)
      } else if (heading) {
        flushParagraph()
        const Tag = (`h${Math.min(heading[1].length + 2, 6)}`) as 'h3' | 'h4' | 'h5' | 'h6'
        nodes.push(<Tag key={`${baseKey}-h-${nodes.length}`} className="mt-3 mb-1 text-sm font-medium text-[var(--color-pib-text)]">{inlineMarkdown(heading[2], mentions)}</Tag>)
      } else if (headerCells && separatorAlignments && headerCells.length === separatorAlignments.length) {
        flushParagraph()
        const rows: string[][] = []
        index += 1
        while (index + 1 < lines.length) {
          const next = lines[index + 1]
          if (!next.trim()) {
            const following = index + 2 < lines.length ? tableCells(lines[index + 2]) : null
            if (!following) break
            index += 1
            continue
          }
          const row = tableCells(next)
          if (!row) break
          rows.push(row)
          index += 1
        }
        nodes.push(
          <MarkdownTable
            key={`${baseKey}-table-${nodes.length}`}
            headers={headerCells}
            alignments={separatorAlignments}
            rows={rows}
            mentions={mentions}
          />,
        )
      } else if (listItem) {
        flushParagraph()
        const items: string[] = [listItem[1]]
        while (index + 1 < lines.length) {
          const next = lines[index + 1].match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)
          if (!next) break
          items.push(next[1])
          index += 1
        }
        nodes.push(
          <ul key={`${baseKey}-list-${nodes.length}`} className="my-1.5 list-disc space-y-1 pl-5">
            {items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item, mentions)}</li>)}
          </ul>,
        )
      } else if (!line.trim()) {
        flushParagraph()
      } else {
        paragraph.push(line)
      }
    }
    flushParagraph()
  }

  while ((match = fencePattern.exec(content)) !== null) {
    if (match.index > lastIndex) pushPlain(content.slice(lastIndex, match.index), `plain-${lastIndex}`)
    nodes.push(<CodeBlock key={`code-${match.index}`} language={match[1]} code={match[2].trimEnd()} />)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) pushPlain(content.slice(lastIndex), `plain-${lastIndex}`)
  return nodes
}

function contentNeedsInlineProcessing(content: string): boolean {
  return hasBareUrl(content)
    || content.includes('[redacted-url]')
    || content.includes('[[pib-reveal:')
    || MENTION_SCAN_PATTERN.test(content)
}

export function ChatMessageContent({ content, mentions }: { content: string; mentions?: Mention[] }) {
  if (!content) return null
  const authInstruction = extractDeviceAuthInstruction(content)
  if (authInstruction) return <DeviceAuthCard instruction={authInstruction} />
  if (!hasRichChatMarkup(content)) {
    if (!contentNeedsInlineProcessing(content)) return <>{content}</>
    return (
      <div className="space-y-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        <p>{linkifyBareUrls(content, 'plain-message', mentions)}</p>
        <BareUrlPreviews content={content} />
      </div>
    )
  }
  return <div className="space-y-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{renderMarkdownBlocks(content, mentions)}</div>
}

function partContent(part: RichMessagePart): string {
  return part.content ?? part.markdown ?? part.body ?? part.question ?? ''
}

function choiceLabel(choice: NonNullable<RichMessagePart['choices']>[number]): string {
  return typeof choice === 'string'
    ? choice
    : choice.label ?? choice.value ?? choice.id ?? 'Option'
}

function RichChoices({ choices }: { choices?: RichMessagePart['choices'] }) {
  if (!choices?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {choices.map((choice, index) => (
        <span key={`${choiceLabel(choice)}-${index}`} className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
          {choiceLabel(choice)}
        </span>
      ))}
    </div>
  )
}

function richStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function richRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function decisionText(value: unknown): { label: string; value: string; required: boolean } | null {
  if (typeof value === 'string') {
    const label = value.trim()
    return label ? { label, value: label, required: false } : null
  }
  const record = richRecord(value)
  if (!record) return null
  const label = [record.label, record.title, record.name, record.value]
    .find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    ?.trim()
  if (!label) return null
  const responseValue = typeof record.value === 'string' && record.value.trim().length > 0
    ? record.value.trim()
    : label
  return { label, value: responseValue, required: record.required === true }
}

function partString(part: RichMessagePart, key: string): string {
  const value = part[key]
  return typeof value === 'string' ? value.trim() : ''
}

function ApprovalCardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <p className="text-[11px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">{title}</p>
      <div className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text)]">{children}</div>
    </section>
  )
}

function ApprovalCard({
  part,
  onQuoteSelection,
  mentions,
}: {
  part: RichMessagePart
  onQuoteSelection?: (text: string) => void
  mentions?: Mention[]
}) {
  const title = part.title ?? 'CEO approval needed'
  const decisionGroupName = useId()
  const [selectedDecisionIndex, setSelectedDecisionIndex] = useState<number | null>(null)
  const body = partContent(part)
  const evidence = richStringList(part.evidence)
  const decisions = Array.isArray(part.decisions)
    ? part.decisions.map(decisionText).filter((item): item is { label: string; value: string; required: boolean } => Boolean(item))
    : []
  const selectedDecision = selectedDecisionIndex === null ? null : decisions[selectedDecisionIndex] ?? null
  const recommendation = partString(part, 'recommendation')
  const safetyNote = partString(part, 'safetyNote') || partString(part, 'safety_note')
  const replyTemplate = partString(part, 'replyTemplate') || partString(part, 'reply_template')
  const dataSkill = partString(part, 'dataSkill') || partString(part, 'data_skill')
  const analysisQuestion = partString(part, 'analysisQuestion') || partString(part, 'analysis_question')
  const statusLabel = partString(part, 'statusLabel') || partString(part, 'status_label') || 'Needs decision'

  return (
    <article aria-label={title} className="my-2 max-w-full overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.06] p-3 shadow-sm shadow-black/10">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-label uppercase tracking-wide text-primary">Approval card</p>
          <p className="mt-0.5 break-words text-sm font-medium leading-snug text-[var(--color-pib-text)] [overflow-wrap:anywhere]">{title}</p>
        </div>
        <span className="shrink-0 rounded-md border border-primary/30 bg-black/20 px-2 py-1 text-[11px] text-primary">
          {statusLabel}
        </span>
      </div>

      {body && <div className="mt-2 text-xs leading-relaxed text-[var(--color-pib-text-muted)]"><ChatMessageContent content={body} mentions={mentions} /></div>}

      <div className="mt-3 grid gap-3">
        {evidence.length > 0 && (
          <ApprovalCardSection title="Evidence">
            <ul className="space-y-1">
              {evidence.map((item, index) => (
                <li key={`${item}-${index}`} className="flex min-w-0 gap-2">
                  <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-[4px] bg-primary/80" />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item}</span>
                </li>
              ))}
            </ul>
          </ApprovalCardSection>
        )}

        {(dataSkill || analysisQuestion) && (
          <ApprovalCardSection title="Data first">
            <div className="space-y-1">
              {dataSkill && <p><span className="text-[var(--color-pib-text-muted)]">Gather skill:</span> {dataSkill}</p>}
              {analysisQuestion && <p className="break-words [overflow-wrap:anywhere]"><span className="text-[var(--color-pib-text-muted)]">Question:</span> {analysisQuestion}</p>}
            </div>
          </ApprovalCardSection>
        )}

        {decisions.length > 0 && (
          <ApprovalCardSection title="Decision needed">
            <div role="radiogroup" aria-label={`${title} decision`} className="space-y-1.5">
              {decisions.map((decision, index) => (
                <label key={`${decision.label}-${index}`} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-1 py-0.5 transition hover:bg-white/[0.05]">
                  <input
                    type="radio"
                    name={decisionGroupName}
                    checked={selectedDecisionIndex === index}
                    onChange={() => setSelectedDecisionIndex(index)}
                    aria-label={`${decision.label}${decision.required ? ' (required)' : ''}`}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {decision.label}
                    {decision.required ? <span className="ml-1 text-primary">(required)</span> : null}
                  </span>
                </label>
              ))}
              {onQuoteSelection && (
                <button
                  type="button"
                  disabled={!selectedDecision}
                  onClick={() => {
                    if (selectedDecision) onQuoteSelection(selectedDecision.value)
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-text)] transition hover:border-primary/50 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="add_comment" className="text-[14px]" />
                  Add selected decision to chat
                </button>
              )}
            </div>
          </ApprovalCardSection>
        )}

        {recommendation && (
          <ApprovalCardSection title="Recommended reply">
            <p className="break-words [overflow-wrap:anywhere]">{recommendation}</p>
          </ApprovalCardSection>
        )}

        {replyTemplate && (
          <ApprovalCardSection title="Copy into chat">
            <div className="rounded-md border border-white/10 bg-black/20 p-2">
              <p className="whitespace-pre-wrap break-words text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">{replyTemplate}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {onQuoteSelection && (
                  <button
                    type="button"
                    onClick={() => onQuoteSelection(replyTemplate)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/15"
                  >
                    <Icon name="add_comment" className="text-[14px]" />
                    Add reply to chat
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { void copyToClipboard(replyTemplate) }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-text)] transition hover:border-primary/50 hover:bg-white/[0.09]"
                >
                  <Icon name="content_copy" className="text-[14px]" />
                  Copy to clipboard
                </button>
              </div>
            </div>
          </ApprovalCardSection>
        )}

        {safetyNote && (
          <p className="rounded-md border border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--st-warning)]">
            {safetyNote}
          </p>
        )}
      </div>
    </article>
  )
}

function ProjectTaskProposal({ part }: { part: RichMessagePart }) {
  const tasks = Array.isArray(part.tasks)
    ? part.tasks.map(richRecord).filter((task): task is Record<string, unknown> => Boolean(task))
    : []
  const title = part.title ?? 'Proposed project tasks'
  return (
    <article aria-label={title} className="my-2 overflow-hidden rounded-lg border border-primary/25 bg-black/15">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.18em] text-primary">Project task proposal</p>
          <p className="mt-0.5 truncate text-sm font-medium text-[var(--color-pib-text)]">{title}</p>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--color-pib-text-muted)]">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
      </header>
      <ol className="divide-y divide-white/[0.07]">
        {tasks.map((task, index) => {
          const taskTitle = typeof task.title === 'string' && task.title.trim() ? task.title.trim() : `Task ${index + 1}`
          const agentId = typeof task.assigneeAgentId === 'string' ? task.assigneeAgentId : 'Unassigned'
          const reviewer = typeof task.reviewerAgentId === 'string' ? task.reviewerAgentId : ''
          const modelPolicy = typeof task.modelPolicy === 'string' ? task.modelPolicy : 'Auto'
          const dependencySequence = Array.isArray(task.dependencySequence)
            ? task.dependencySequence.filter((value): value is number => Number.isInteger(value))
            : []
          return (
            <li key={`${taskTitle}-${index}`} className="grid gap-2 px-3 py-2.5 text-xs sm:grid-cols-[1.5rem_minmax(0,1fr)_auto] sm:items-center">
              <span className="font-mono text-[var(--color-pib-text-muted)]">{index + 1}</span>
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--color-pib-text)]">{taskTitle}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[var(--color-pib-text-muted)]">
                  <span>Agent: {agentId}</span>
                  {dependencySequence.length > 0 && <span>After task {dependencySequence.map((value) => value + 1).join(', ')}</span>}
                  {reviewer && <span>Review: {reviewer}</span>}
                </p>
              </div>
              <span className="text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">{modelPolicy}</span>
            </li>
          )
        })}
      </ol>
    </article>
  )
}

function WorkspacePanelCard({ part }: { part: RichMessagePart }) {
  const panel = normalizeWorkspacePanel(part)
  if (!panel) return null
  const openPanel = () => {
    window.dispatchEvent(new CustomEvent(WORKSPACE_PANEL_EVENT, { detail: panel }))
  }
  return (
    <article aria-label={panel.title} className="my-2 overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.045]">
      <header className="flex min-w-0 items-start justify-between gap-3 border-b border-white/[0.08] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-label uppercase tracking-[0.18em] text-primary">{panel.eyebrow ?? 'Generated workspace UI'}</p>
          <p className="mt-0.5 truncate text-sm font-medium text-[var(--color-pib-text)]">{panel.title}</p>
        </div>
        <Icon name="dashboard_customize" className="shrink-0 text-[18px] text-primary" />
      </header>
      <div className="space-y-2.5 px-3 py-3">
        {panel.body && <p className="line-clamp-3 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{panel.body}</p>}
        {panel.metrics.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {panel.metrics.slice(0, 3).map((metric) => (
              <div key={metric.label} className="rounded-md border border-white/[0.08] bg-black/15 px-2 py-1.5">
                <p className="truncate text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">{metric.label}</p>
                <p className="mt-0.5 truncate text-sm font-medium text-[var(--color-pib-text)]">{metric.value}</p>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={openPanel}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Icon name="splitscreen" className="text-[15px]" />
          Open in workspace pane
        </button>
      </div>
    </article>
  )
}

function RichMessagePartView({
  part,
  onQuoteSelection,
  mentions,
}: {
  part: RichMessagePart
  onQuoteSelection?: (text: string) => void
  mentions?: Mention[]
}) {
  const type = String(part.type).toLowerCase()
  if (type === 'studio_artifact' || type === 'studio_artifact_bundle') {
    return <RehydratedStudioArtifacts part={part} />
  }
  if (type === 'workspace_panel') {
    return <WorkspacePanelCard part={part} />
  }
  if (type === 'markdown') {
    return <ChatMessageContent content={partContent(part)} mentions={mentions} />
  }
  if (type === 'code') {
    return <CodeBlock language={part.language ?? ''} code={part.code ?? partContent(part)} />
  }
  if (type === 'table') {
    const rows = Array.isArray(part.rows) ? part.rows : []
    const columns = Array.isArray(part.columns) ? part.columns : []
    const cellsForRow = (row: unknown): unknown[] => {
      if (Array.isArray(row)) return row
      if (row && typeof row === 'object') {
        const record = row as Record<string, unknown>
        return columns.length > 0
          ? columns.map((column) => record[String(column)])
          : Object.values(record)
      }
      return [row]
    }
    return (
      <div className="my-2 overflow-hidden rounded-[6px] border border-white/10 bg-black/20">
        {part.caption && <div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-[var(--color-pib-text)]">{part.caption}</div>}
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            {columns.length > 0 && (
              <thead className="bg-white/[0.06] text-[var(--color-pib-text)]">
                <tr>
                  {columns.map((column) => (
                    <th key={column} scope="col" className="border-b border-white/10 px-3 py-2 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="text-[var(--color-pib-text-muted)]">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-white/5 last:border-b-0">
                  {cellsForRow(row).map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top">
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
  if (type === 'image' && part.url) {
    return (
      <figure className="my-2 overflow-hidden rounded-[6px] border border-white/10 bg-black/20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={part.url} alt={part.alt ?? part.caption ?? part.name ?? 'Rich image'} className="max-h-72 w-full object-cover" />
        {part.caption && <figcaption className="px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">{part.caption}</figcaption>}
      </figure>
    )
  }
  if (type === 'gallery' && part.images?.length) {
    return (
      <div className="my-2 grid grid-cols-2 gap-2">
        {part.images.map((image, index) => (
          <figure key={`${image.url}-${index}`} className="overflow-hidden rounded-[6px] border border-white/10 bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.alt ?? image.caption ?? `Gallery image ${index + 1}`} className="h-36 w-full object-cover" />
            {image.caption && <figcaption className="px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)]">{image.caption}</figcaption>}
          </figure>
        ))}
      </div>
    )
  }
  if ((type === 'file' || type === 'audio' || type === 'video') && part.url) {
    if (type === 'audio') {
      return (
        <div className="my-2 rounded-[6px] border border-white/10 bg-black/20 p-3">
          {part.name && <p className="mb-2 text-xs font-medium text-[var(--color-pib-text)]">{part.name}</p>}
          <audio controls src={part.url} className="w-full" />
        </div>
      )
    }
    if (type === 'video') {
      return <VideoPreviewOrFallback url={part.url} name={part.name ?? part.title} caption={part.caption} mimeType={part.mimeType} />
    }
    return (
      <a href={part.url} target="_blank" rel="noreferrer" className="my-2 flex items-center gap-2 rounded-[6px] border border-white/15 bg-black/10 px-3 py-2 text-xs transition hover:border-primary/70">
        <Icon name="attach_file" className="text-[16px]" />
        <span className="min-w-0 flex-1 truncate">{part.name ?? part.title ?? 'File'}</span>
        {typeof part.sizeBytes === 'number' && <span className="shrink-0 opacity-60">{formatBytes(part.sizeBytes)}</span>}
      </a>
    )
  }
  if (type === 'tool_output') {
    const text = [part.output, part.stdout, part.stderr].filter(Boolean).join('\n')
    const authInstruction = extractDeviceAuthInstruction(text, part.tool ?? part.title)
    if (authInstruction) return <DeviceAuthCard instruction={authInstruction} />
    return (
      <div className="my-2 overflow-hidden rounded-[6px] border border-primary/20 bg-black/35">
        <div className="border-b border-white/10 px-3 py-2 text-[11px] font-label uppercase tracking-wide text-primary">
          {part.tool ?? part.title ?? 'Tool output'}
        </div>
        {text && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">{text}</pre>}
      </div>
    )
  }
  if (type === 'status' || type === 'approval' || type === 'clarify' || type === 'model_picker') {
    const title = type === 'clarify'
      ? part.question
      : type === 'model_picker'
        ? part.title ?? 'Choose model'
        : part.title ?? part.status ?? 'Status'
    return (
      <div className="my-2 rounded-[6px] border border-white/10 bg-white/[0.045] px-3 py-2">
        {title && <p className="text-sm font-medium text-[var(--color-pib-text)]">{title}</p>}
        {part.body && <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{part.body}</p>}
        {type === 'model_picker' && part.models?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {part.models.map((model) => (
              <span key={model.id} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)]">
                {model.label ?? model.id}
              </span>
            ))}
          </div>
        ) : (
          <RichChoices choices={part.choices} />
        )}
      </div>
    )
  }
  if (type === 'approval_card') {
    return <ApprovalCard part={part} onQuoteSelection={onQuoteSelection} mentions={mentions} />
  }
  if (type === 'design_audit') {
    return <DesignAuditCard part={part} />
  }
  if (type === 'design_iteration') {
    return <DesignIterationCard part={part} />
  }
  if (type === 'project_task_proposal') {
    return <ProjectTaskProposal part={part} />
  }
  if (type === 'project_command_event') {
    return <ProjectCommandEventCard part={part} mentions={mentions} />
  }
  if (type === 'agent_delegation_branch') {
    return <AgentDelegationBranchCard part={part} />
  }
  return partContent(part) ? <ChatMessageContent content={partContent(part)} mentions={mentions} /> : null
}

function AgentDelegationBranchCard({ part }: { part: RichMessagePart }) {
  const raw = part as RichMessagePart & {
    delegationId?: string
    conversationId?: string
    parentAgentId?: string
    children?: Array<{
      id: string
      agentId: string
      goal: string
      status: string
      result?: string
      runId?: string
    }>
    status?: string
    summary?: string
    title?: string
  }
  const [livePart, setLivePart] = useState(raw)
  const overallSeed = String(raw.status ?? 'queued')
  const isOpen = overallSeed === 'queued' || overallSeed === 'running' || overallSeed === 'partial'
  const conversationId = raw.conversationId
    || (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('convId') || ''
      : '')

  // While a branch is open, poll the conversation delegations API so the card
  // advances without waiting solely for a full live-feed message rewrite.
  useEffect(() => {
    setLivePart(raw)
  }, [raw.delegationId, raw.status, raw.summary, raw.title, raw.children])

  useEffect(() => {
    if (!isOpen || !raw.delegationId || !conversationId || typeof window === 'undefined') return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/delegations?id=${encodeURIComponent(raw.delegationId!)}`,
          { credentials: 'include' },
        )
        if (!res.ok || cancelled) return
        const body = await res.json().catch(() => null) as {
          data?: { branch?: typeof raw }
        } | null
        if (body?.data?.branch && !cancelled) {
          setLivePart((current) => ({ ...current, ...body.data!.branch }))
        }
      } catch {
        // best-effort live refresh
      }
    }
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void poll()
    }, 12_000)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isOpen, raw.delegationId, conversationId])

  const children = Array.isArray(livePart.children) ? livePart.children : (Array.isArray(raw.children) ? raw.children : [])
  const overall = String(livePart.status ?? raw.status ?? 'queued')
  const tone = overall === 'done'
    ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-50'
    : overall === 'failed' || overall === 'unknown'
      ? 'border-red-400/35 bg-red-500/10 text-red-50'
      : overall === 'running' || overall === 'partial'
        ? 'border-sky-400/35 bg-sky-500/10 text-sky-50'
        : 'border-amber-400/35 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]'
  const icon = overall === 'done'
    ? 'account_tree'
    : overall === 'failed' || overall === 'unknown'
      ? 'error'
      : overall === 'running' || overall === 'partial'
        ? 'lan'
        : 'hourglass_top'

  return (
    <div
      data-testid="agent-delegation-branch"
      data-delegation-id={raw.delegationId ?? ''}
      data-branch-status={overall}
      className={`rounded-[6px] border px-3 py-3 text-xs shadow-sm ${tone}`}
    >
      <div className="flex items-center gap-2">
        <Icon name={icon} className="text-[18px]" />
        <div className="min-w-0 flex-1">
          <p className="font-medium tracking-tight">
            {raw.title || 'Subagent branch'}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide opacity-80">
            {overall.replace(/_/g, ' ')}
            {raw.parentAgentId ? ` · via @${raw.parentAgentId}` : ''}
            {raw.delegationId ? ` · ${raw.delegationId.slice(0, 14)}` : ''}
          </p>
        </div>
      </div>

      {children.length > 0 && (
        <ul className="mt-3 space-y-2 border-l-2 border-white/15 pl-3">
          {children.map((child) => {
            const childTone = child.status === 'done'
              ? 'text-emerald-200'
              : child.status === 'failed' || child.status === 'unknown'
                ? 'text-red-200'
                : child.status === 'running'
                  ? 'text-sky-200'
                  : 'text-[var(--st-warning)]'
            const childIcon = child.status === 'done'
              ? 'check_circle'
              : child.status === 'failed' || child.status === 'unknown'
                ? 'cancel'
                : child.status === 'running'
                  ? 'progress_activity'
                  : 'schedule'
            return (
              <li key={child.id} data-child-id={child.id} data-child-status={child.status} className="min-w-0">
                <div className={`flex items-center gap-1.5 font-medium ${childTone}`}>
                  <Icon name={childIcon} className={`text-[14px] ${child.status === 'running' ? 'animate-spin' : ''}`} />
                  <span>@{child.agentId}</span>
                  <span className="text-[10px] font-medium uppercase opacity-75">{child.status}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 opacity-90">{child.goal}</p>
                {child.result && (
                  <p className="mt-1 rounded-lg bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed opacity-95 line-clamp-6">
                    {child.result}
                  </p>
                )}
                {child.runId && (
                  <p className="mt-0.5 font-mono text-[10px] opacity-60">run {child.runId.slice(0, 18)}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {raw.summary && (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/15 px-2.5 py-2 text-[11px] leading-relaxed opacity-95">
          {raw.summary}
        </p>
      )}
      <p className="mt-2 text-[10px] opacity-70">
        Isolated child context · leaf agents do not re-delegate · summary returns here
      </p>
    </div>
  )
}

function ProjectCommandEventCard({ part, mentions }: { part: RichMessagePart; mentions?: Mention[] }) {
  const event = (part as RichMessagePart & { event?: Record<string, unknown> }).event
    ?? (part as RichMessagePart & { data?: Record<string, unknown> }).data
    ?? null
  if (!event || typeof event !== 'object') {
    return partContent(part) ? <ChatMessageContent content={partContent(part)} mentions={mentions} /> : null
  }
  const type = String(event.type ?? 'update')
  const taskTitle = String(event.taskTitle ?? event.taskId ?? 'Task')
  const agentId = typeof event.agentId === 'string' ? event.agentId : ''
  const summary = typeof event.summary === 'string' ? event.summary : ''
  const blocker = typeof event.blockingReason === 'string' ? event.blockingReason : ''
  const href = typeof event.taskHref === 'string' ? event.taskHref : ''
  const tone = type.includes('blocked') || type.includes('failed')
    ? 'border-red-400/30 bg-red-500/10 text-red-100'
    : type.includes('awaiting') || type.includes('needs')
      ? 'border-amber-400/30 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] text-[var(--st-warning)]'
      : type.includes('done')
        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
        : 'border-sky-400/30 bg-sky-500/10 text-sky-100'
  const label = type.replace('task.', '').replace('session.', '').replace(/_/g, ' ')
  return (
    <div data-testid="project-command-event" className={`rounded-[6px] border px-3 py-2.5 text-xs ${tone}`}>
      <div className="flex items-center gap-2">
        <Icon name={type.includes('blocked') || type.includes('failed') ? 'error' : type.includes('done') ? 'check_circle' : type.includes('awaiting') ? 'priority_high' : 'sync'} className="text-[16px]" />
        <span className="font-medium capitalize">{label}</span>
        {agentId && <span className="text-[10px] opacity-80">· {agentId}</span>}
      </div>
      <p className="mt-1 font-medium">{taskTitle}</p>
      {blocker && <p className="mt-1 opacity-90">Blocker: {blocker}</p>}
      {summary && !blocker && <p className="mt-1 opacity-90 line-clamp-4">{summary}</p>}
      {href && (
        <a href={href} className="mt-2 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
          Open task <Icon name="open_in_new" className="text-[13px]" />
        </a>
      )}
    </div>
  )
}

function RehydratedStudioArtifacts({ part }: { part: RichMessagePart }) {
  const normalized = normalizeStudioArtifactPart(part)
  const [artifacts, setArtifacts] = useState<ChatArtifactSummary[]>([])
  useEffect(() => {
    if (!normalized) return
    let active = true
    Promise.all(normalized.artifacts.map(async ({ id, contextId }) => {
      const selector = id === contextId ? '' : `?artifactId=${encodeURIComponent(id)}`
      const response = await fetch(`/api/v1/chat-context/studio_artifact/${encodeURIComponent(contextId)}${selector}`)
      if (!response.ok) return []
      const payload = await response.json().catch(() => null) as { data?: { artifacts?: ChatArtifactSummary[] } } | null
      return Array.isArray(payload?.data?.artifacts) ? payload.data.artifacts.filter((artifact) => artifact.id === id) : []
    })).then((groups) => { if (active) setArtifacts(groups.flat()) }).catch(() => undefined)
    return () => { active = false }
  }, [normalized?.artifacts.map(({ id, contextId }) => `${contextId}\u0001${id}`).join('\u0000')])
  return <ContextArtifactBundle artifacts={artifacts} />
}

function RichMessageParts({
  parts,
  onQuoteSelection,
  mentions,
}: {
  parts?: RichMessagePart[]
  onQuoteSelection?: (text: string) => void
  mentions?: Mention[]
}) {
  if (!parts?.length) return null
  return (
    <div className="mt-2 space-y-2 whitespace-normal">
      {parts.map((part, index) => (
        <RichMessagePartView
          key={part.id ?? `${part.type}-${index}`}
          part={part}
          onQuoteSelection={onQuoteSelection}
          mentions={mentions}
        />
      ))}
    </div>
  )
}

function actionClasses(action: ChatUiAction): string {
  const type = String(action.type).toLowerCase()
  if (type === 'deny' || action.variant === 'danger') {
    return 'border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
  }
  // Email/document/invoice canvas open - brand primary so it cannot hide next to Copy.
  if (type === 'open_context') {
    return 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/25'
  }
  if (type === 'approve' || action.variant === 'primary') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
  }
  return 'border-white/10 bg-white/[0.06] text-[var(--color-pib-text)] hover:border-primary/50 hover:bg-white/[0.09]'
}

function richActionIcon(action: ChatUiAction): string {
  const type = String(action.type).toLowerCase()
  if (type === 'copy') return 'content_copy'
  if (type === 'retry') return 'refresh'
  if (type === 'stop') return 'stop_circle'
  if (type === 'deny') return 'block'
  if (type === 'download') return 'download'
  if (type === 'open') return 'open_in_new'
  if (type === 'open_context') {
    const kind = action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)
      ? String((action.payload as { kind?: string }).kind || '').toLowerCase()
      : ''
    if (kind === 'email') return 'mail'
    if (kind === 'document') return 'description'
    if (kind === 'invoice' || kind === 'quote') return 'receipt_long'
    if (kind === 'social') return 'share'
    if (kind === 'campaign') return 'campaign'
    if (kind === 'design') return 'palette'
    return 'open_in_new'
  }
  return 'check_circle'
}

function RichActionBar({
  actions,
  message,
  onUiAction,
}: {
  actions?: ChatUiAction[]
  message: ConversationMessage
  onUiAction?: (message: ConversationMessage, action: ChatUiAction) => void | Promise<void>
}) {
  if (!actions?.length) return null
  const handleAction = async (action: ChatUiAction) => {
    if (action.disabled) return
    if (action.type === 'copy') {
      const text = typeof action.value === 'string' ? action.value : message.content
      if (text) await copyToClipboard(text)
    }
    await onUiAction?.(message, action)
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2 whitespace-normal" data-testid="message-ui-actions">
      {actions.map((action) => {
        const type = String(action.type).toLowerCase()
        const className = [
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
          actionClasses(action),
        ].join(' ')
        if ((type === 'open' || type === 'download') && action.url) {
          return (
            <a
              key={action.id}
              href={action.url}
              target="_blank"
              rel="noreferrer"
              download={type === 'download' ? true : undefined}
              onClick={() => { void onUiAction?.(message, action) }}
              className={className}
            >
              <Icon name={richActionIcon(action)} className="text-[14px]" />
              {action.label}
            </a>
          )
        }
        return (
          <button
            key={action.id}
            type="button"
            disabled={action.disabled}
            onClick={() => { void handleAction(action) }}
            className={className}
            data-action-type={type}
          >
            <Icon name={richActionIcon(action)} className="text-[14px]" />
            {action.label}
          </button>
        )
      })}
    </div>
  )
}

function copyableText(message: ConversationMessage): string {
  if (message.status === 'failed') {
    return humanizeConversationRunError(message.error || message.content || '')
  }
  return message.content || message.error || ''
}

function canRenderRichContentEnvelope(message: ConversationMessage): boolean {
  return message.authorKind === 'agent' || message.role === 'assistant' || message.authorKind === 'system'
}

function looksLikeIncompleteRichJsonStream(value: string): boolean {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').trim()
  if (!trimmed.startsWith('{')) return false
  if (!/"(?:rich_parts|richParts|ui_actions|uiActions)"/.test(trimmed)) return false
  // Not a complete parseable envelope yet (still streaming).
  return !isRichPayloadText(trimmed)
}

function resolvedMessage(message: ConversationMessage): ConversationMessage {
  if (!canRenderRichContentEnvelope(message)) return message
  const mixed = extractMixedRichContent(message.content)
  const hasStoredParts = Array.isArray(message.richParts) && message.richParts.length > 0
  const hasStoredActions = Array.isArray(message.uiActions) && message.uiActions.length > 0

  // Incomplete pure JSON stream: hide raw fragments until the envelope completes.
  if (!mixed.extracted && looksLikeIncompleteRichJsonStream(message.content) && !hasStoredParts) {
    return {
      ...message,
      content: '',
      ...(hasStoredParts ? { richParts: message.richParts } : {}),
      ...(hasStoredActions ? { uiActions: message.uiActions } : {}),
    }
  }

  if (!mixed.extracted && !isRichPayloadText(message.content) && !hasStoredParts && !hasStoredActions) {
    return message
  }

  const richParts = dedupeStructured([
    ...(message.richParts ?? []),
    ...mixed.richParts,
    ...(mixed.extracted ? [] : richPartsFromPayload(message.content)),
  ])
  const uiActions = dedupeStructured([
    ...(message.uiActions ?? []),
    ...mixed.uiActions,
    ...(mixed.extracted ? [] : uiActionsFromPayload(message.content)),
  ])
  // Extracted mixed → keep prose only. Pure envelope → card only (empty prose).
  const nextContent = mixed.extracted
    ? mixed.prose
    : isRichPayloadText(message.content)
      ? ''
      : message.content
  return {
    ...message,
    content: nextContent,
    ...(richParts.length > 0 ? { richParts } : {}),
    ...(uiActions.length > 0 ? { uiActions } : {}),
  }
}

export default function MessageBubble({
  message: m,
  currentUserUid,
  agentColorKey,
  agentIconKey,
  liveEvents = [],
  onStopRun,
  onQuoteSelection,
  onUiAction,
}: MessageBubbleProps) {
  const renderedMessage = resolvedMessage(m)
  const [previewAttachment, setPreviewAttachment] = useState<ConversationAttachment | null>(null)
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [selectionAction, setSelectionAction] = useState<{
    text: string
    left: number
    top: number
  } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const readAloudUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const isMine = m.authorId === currentUserUid
  const isTool = m.role === 'tool'
  const isQueued = m.status === 'queued'
  const isPending = m.status === 'pending' || m.status === 'streaming'
  const isWaiting = m.status === 'waiting_approval'
  const isFailed = m.status === 'failed'
  const elapsed = useElapsed(isQueued || isPending || isWaiting, m.createdAt)
  const textToCopy = copyableText(renderedMessage)

  const copyMessage = async () => {
    if (!textToCopy.trim()) return
    await copyToClipboard(textToCopy)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  const readMessageAloud = () => {
    const text = textToCopy.trim()
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    readAloudUtteranceRef.current = utterance
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  useEffect(() => () => {
    if (readAloudUtteranceRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

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

  const messageActions = textToCopy.trim() ? (
    <div className="mt-1 inline-flex flex-wrap items-center gap-1 opacity-0 transition group-hover/message:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        onClick={copyMessage}
        className="inline-flex items-center gap-1 rounded-[4px] border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)] shadow-sm hover:border-primary/50 hover:text-[var(--color-pib-text)] focus:outline-none focus:ring-2 focus:ring-primary/50"
        aria-label="Copy message"
        title="Copy message"
      >
        <Icon name={copied ? 'check' : 'content_copy'} className="text-[13px]" />
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {!isMine && (
        <button
          type="button"
          onClick={readMessageAloud}
          className="inline-flex items-center gap-1 rounded-[4px] border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-[var(--color-pib-text-muted)] shadow-sm hover:border-primary/50 hover:text-[var(--color-pib-text)] focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label={speaking ? 'Stop read aloud' : 'Read aloud'}
          title={speaking ? 'Stop read aloud' : 'Read aloud'}
        >
          <Icon name={speaking ? 'stop_circle' : 'volume_up'} className="text-[13px]" />
          <span>{speaking ? 'Stop' : 'Read aloud'}</span>
        </button>
      )}
    </div>
  ) : null

  const selectionPopover = selectionAction ? (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        addSelectionToChat()
      }}
      className="absolute z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-[4px] border border-white/10 bg-[#2d2d2d] px-3 py-1.5 text-xs font-medium text-white shadow-black/30 transition hover:bg-[#3a3a3a] focus:outline-none focus:ring-2 focus:ring-primary/60"
      style={{ left: selectionAction.left, top: selectionAction.top }}
    >
      <Icon name="add_comment" className="text-[14px]" />
      Add to chat
    </button>
  ) : null

  // Tool pill - no avatar, compact
  if (isTool) {
    return (
      <div className="mx-message flex justify-center" data-author-kind="tool">
        <div className="max-w-[90%] flex items-center gap-2 rounded-[4px] bg-white/5 border border-white/10 px-3 py-1 text-xs text-[var(--color-pib-text-muted)] font-mono">
          <Icon name="build" className="text-[14px] text-primary" />
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
  const activity = currentActivity(displayEvents, elapsed, Boolean(m.runId))
  const tasks = taskRows(displayEvents)
  const thinking = m.thinking ?? buildThinkingTrace(displayEvents)
  const attachments = m.attachments ?? []
  const attachmentList = attachments.length > 0 ? (
    <div className="mt-2 grid gap-2">
      {attachments.map((attachment) => {
        const image = isImageAttachment(attachment)
        const size = formatBytes(attachment.sizeBytes)
        const video = isVideoAttachment(attachment)
        if (image) {
          return (
            <button
              key={attachment.id}
              type="button"
              aria-label={`Open ${attachment.name}`}
              onClick={() => setPreviewAttachment(attachment)}
              className="group relative block overflow-hidden rounded-[6px] border border-white/15 bg-black/20 text-left transition hover:border-primary/70 focus:outline-none focus:ring-2 focus:ring-primary/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
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
        if (video) {
          return <VideoPreviewOrFallback key={attachment.id} url={attachment.url} name={attachment.name} mimeType={attachment.contentType} />
        }

        return (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-[6px] border border-white/15 bg-black/10 px-3 py-2 text-xs transition hover:border-primary/70"
          >
            <Icon name="attach_file" className="text-[16px]" />
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
            className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-white/10 text-white hover:bg-white/20"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewAttachment.url}
          alt={previewAttachment.name}
          className="max-h-[82vh] max-w-full rounded-lg object-contain"
        />
      </div>
    </div>
  ) : null

  // User's own message - float right, no avatar
  if (isMine) {
    return (
      <>
        <div className="mx-message flex justify-end" data-mine="true" data-author-kind="user">
          <div className="group/message max-w-[85%] min-w-0 lg:max-w-[80%] text-right">
            <div ref={contentRef} className="relative inline-block max-w-full text-left">
              {selectionPopover}
              <div
                onMouseUp={handleTextSelection}
                className="mx-bubble-mine max-w-full overflow-hidden rounded-none px-2 py-1 text-[16px] lg:text-[15px] italic whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[var(--color-pib-text)]"
              >
            <ChatMessageContent content={renderedMessage.content} mentions={renderedMessage.mentions} />
            <RichMessageParts parts={renderedMessage.richParts} onQuoteSelection={onQuoteSelection} mentions={renderedMessage.mentions} />
              {attachmentList}
              <RichActionBar actions={renderedMessage.uiActions} message={renderedMessage} onUiAction={onUiAction} />
              </div>
            </div>
            <div className="flex justify-end">{messageActions}</div>
          </div>
        </div>
        {previewDialog}
      </>
    )
  }

  // Other (agent or another user)
  const isAgent = m.authorKind === 'agent'
  const eventSummary = displayEvents.length > 0 ? summarizeEvents(displayEvents) : ''
  const liveThought = liveReasoningText(displayEvents)
  const hasToolishLive = displayEvents.some((event) => {
    const name = event.event ?? ''
    return name.startsWith('tool.') || name.startsWith('task.') || name === 'reasoning.delta' || name === 'reasoning.summary'
  })
  const liveThinking = thinking ?? (
    liveThought || hasToolishLive
      ? buildThinkingTrace(displayEvents)
      : null
  )
  const hasNarrative = Boolean(
    liveThought
    || liveThinking?.summary
    || liveThinking?.segments?.some((segment) => segment.kind === 'thought' && segment.text),
  )
  const toolOnlySummary = !hasNarrative && displayEvents.length > 0 ? eventSummary : ''
  const showSlimControls = (isQueued || isPending || isWaiting) && (!hasNarrative || isQueued)
  const consoleRows = commandConsoleRows(displayEvents)
  const commandConsole = consoleRows.length > 0 ? (
    <details className="my-1.5 overflow-hidden rounded-lg border border-white/8 bg-black/25 text-[var(--color-pib-text-muted)] group/console">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-2.5 py-1.5 text-[11px] text-[var(--color-pib-text-muted)] [&::-webkit-details-marker]:hidden">
        <Icon name="terminal" className="text-[14px] opacity-70" />
        <span className="min-w-0 flex-1 truncate">Inline command console</span>
        <span className="rounded-[4px] bg-white/8 px-1.5 py-0.5 font-mono text-[10px] opacity-70">
          {consoleRows.length}
        </span>
        <span className="text-[11px] opacity-50 transition-transform group-open/console:rotate-90">›</span>
      </summary>
      <div className="max-h-80 overflow-y-auto border-t border-white/8 p-2 font-mono text-[11px] leading-relaxed">
        {consoleRows.map((row) => (
          <div key={row.key} className="mb-1.5 overflow-hidden rounded-md border border-white/10 bg-[#050505]/80 last:mb-0">
            <div className="flex items-center gap-2 border-b border-white/5 px-2 py-1 text-[10px]">
              <span className={[
                'h-2 w-2 rounded-[4px] shrink-0',
                row.status === 'failed' ? 'bg-red-400' : row.status === 'running' ? 'bg-primary animate-pulse' : row.status === 'done' ? 'bg-emerald-400' : 'bg-white/40',
              ].join(' ')} />
              <span className="min-w-0 flex-1 truncate text-primary">{row.label}</span>
              <span className="shrink-0 text-[var(--color-pib-text-muted)]/70">{row.meta}</span>
            </div>
            {row.body && (
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[11px] text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">
                {row.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </details>
  ) : null

  return (
    <div
      className="mx-message flex w-full min-w-0 justify-start gap-2.5 lg:gap-2.5"
      data-mine="false"
      data-author-kind={isAgent ? 'agent' : 'user'}
      data-status={m.status || 'complete'}
    >
      {/* Avatar - hidden on mobile for cleaner prose-style look.
          Pad for the cinematic ring (::after inset -3px) so left/top edges are not clipped. */}
      <div className="mt-0.5 hidden shrink-0 overflow-visible p-[3px] lg:block">
        {isAgent ? (
          <div className={`mx-avatar-ring flex h-8 w-8 items-center justify-center rounded-[4px] ${color.bg}`}>
            <Icon name={agentIconKey ?? 'smart_toy'} className={`text-[16px] ${color.text}`} />
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-white/10 text-xs font-medium text-[var(--color-pib-text)]">
            {initials(m.authorDisplayName)}
          </div>
        )}
      </div>

      {/* Bubble content */}
      <div className="group/message max-w-full lg:max-w-[78%] flex-1 min-w-0">
        {/* Author label - hidden on mobile */}
        <p className={`hidden lg:block text-[10px] font-medium mb-1 ${isAgent ? color.text : 'text-[var(--color-pib-text-muted)]'}`}>
          {m.authorDisplayName}
        </p>

        {/* Live thought stream while queued / pending / streaming / waiting */}
        {(isQueued || isPending || isWaiting) && (
          <div className="mb-1 min-w-0 space-y-1">
            {showSlimControls && (
              <div className="mx-activity-live flex min-w-0 items-center gap-2 rounded-md px-0.5 py-0.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-[var(--color-pib-text)]/90">
                    {isQueued
                      ? `Queued on ${m.dispatchRuntimeLabel || m.acceptedDevice?.machineLabel || 'linked computer'}`
                      : activity.label}
                  </p>
                  {(isQueued || (!hasNarrative && activity.detail)) && (
                    <p className="mt-0.5 truncate text-[11px] text-[var(--color-pib-text-muted)]/70">
                      {isQueued ? queuedRunDetail(m.queuedReason) : activity.detail}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {elapsed > 0 && (
                    <span className="font-mono text-[10px] text-[var(--color-pib-text-muted)]/70">
                      {elapsed}s
                    </span>
                  )}
                  {onStopRun && m.runId && (
                    <button
                      type="button"
                      onClick={onStopRun}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-200 hover:bg-red-500/15"
                    >
                      <Icon name="stop" className="text-[13px]" />
                      Stop
                    </button>
                  )}
                </div>
              </div>
            )}

            {!isQueued && liveThinking && (
              <ThoughtStream
                thinking={liveThinking}
                live
                liveElapsed={elapsed}
                onStopRun={onStopRun}
                showStop={Boolean(onStopRun && m.runId && hasNarrative)}
              />
            )}

            {!isQueued && !hasNarrative && toolOnlySummary && (
              <p className="text-[11px] text-[var(--color-pib-text-muted)]/65">{toolOnlySummary}</p>
            )}

            {tasks.length > 0 && (
              <details className="text-[var(--color-pib-text-muted)] group/tasks">
                <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1.5 py-0.5 text-[11px] hover:text-[var(--color-pib-text)]">
                  <span className="opacity-60 transition-transform group-open/tasks:rotate-90">›</span>
                  <span>Tasks</span>
                  <span className="rounded-[4px] bg-white/8 px-1.5 py-0.5 font-mono text-[10px] opacity-70">
                    {tasks.length}
                  </span>
                </summary>
                <div className="mt-1 space-y-1">
                  {tasks.map((task) => {
                    const done = /done|completed|complete/i.test(task.status)
                    const active = /progress|doing|active|running/i.test(task.status)
                    return (
                      <div key={task.key} className="flex items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]">
                        <Icon
                          name={done ? 'check_circle' : active ? 'radio_button_checked' : 'radio_button_unchecked'}
                          className={[
                            'text-[13px]',
                            done ? 'text-emerald-300' : active ? 'text-primary' : 'text-[var(--color-pib-text-muted)]/60',
                          ].join(' ')}
                        />
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Completed thinking - collapsed Thought for Ns › above the answer */}
        {!isPending && !isWaiting && thinking && (
          <ThoughtStream thinking={thinking} />
        )}

        {/* Completed tool console - collapsed by default; hidden while live to keep the stream sleek */}
        {!isPending && !isWaiting && commandConsole}
        {displayEvents.length > 0 && !isPending && !isWaiting && eventSummary && !thinking?.segments?.some((s) => s.kind === 'tools') && (
          <p className="mb-1 text-[11px] text-[var(--color-pib-text-muted)]/65">{eventSummary}</p>
        )}

        {/* The bubble itself - plain prose on mobile, bubble on desktop */}
        <div ref={contentRef} className="relative max-w-full overflow-hidden">
          {selectionPopover}
          <div
            onMouseUp={handleTextSelection}
            className={
              isFailed
                ? 'max-w-full overflow-hidden rounded-[6px] rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-red-500/15 text-red-200 border border-red-500/40'
                : [
                    // Mobile: plain prose, no background, larger readable text
                    'mx-bubble-agent max-w-full overflow-hidden text-[15px] leading-relaxed text-[var(--color-pib-text)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
                    // Desktop: flat prose with inset from the accent rail
                    'lg:rounded-none lg:pl-3.5 lg:pr-0 lg:py-1 lg:text-sm lg:bg-transparent',
                  ].join(' ')
            }
          >
            {isQueued && !renderedMessage.content && (
              <span className="opacity-70 italic text-xs">{queuedRunPlaceholder(m.queuedReason)}</span>
            )}
            {isPending && !renderedMessage.content && !hasNarrative && (
              <span className="opacity-40 italic text-xs">Waiting for agent activity...</span>
            )}
            {isWaiting && !renderedMessage.content && (
              <span className="opacity-70 italic">Paused - awaiting tool approval…</span>
            )}
            <ChatMessageContent
              mentions={renderedMessage.mentions}
              content={
                renderedMessage.content
                || (isFailed && renderedMessage.error
                  ? humanizeConversationRunError(renderedMessage.error)
                  : '')
                || ''
              }
            />
            <RichMessageParts parts={renderedMessage.richParts} onQuoteSelection={onQuoteSelection} mentions={renderedMessage.mentions} />
            {attachmentList}
            <RichActionBar actions={renderedMessage.uiActions} message={renderedMessage} onUiAction={onUiAction} />
          </div>
        </div>
        {messageActions}
      </div>
      {previewDialog}
    </div>
  )
}
