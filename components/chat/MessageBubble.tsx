'use client'

/* eslint-disable @next/next/no-img-element -- Conversation attachments use arbitrary Firebase Storage URLs. */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatEvent, ChatUiAction, RichMessagePart } from '@/lib/hermes/types'
import type { ContextReference } from '@/lib/context-references/types'
import type { SlashCommandPayload } from '@/lib/chat/slash-commands'
import { copyToClipboard } from '@/lib/utils/clipboard'

// Matches Phase 1 ConversationMessage shape
export interface ConversationMessage {
  id: string
  conversationId: string
  role: string
  content: string
  attachments?: ConversationAttachment[]
  contextRefs?: ContextReference[]
  slashCommand?: SlashCommandPayload
  runId?: string
  status?: string
  error?: string
  events?: unknown[]
  richParts?: RichMessagePart[]
  uiActions?: ChatUiAction[]
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
    .filter((event) => event.event !== 'assistant.text_delta' && event.event !== 'heartbeat')
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

function hasRichChatMarkup(content: string): boolean {
  return /(^|\n)```/.test(content)
    || /(^|\n)\s{0,3}#{1,4}\s+\S/.test(content)
    || /(^|\n)\s*[-*]\s+\S/.test(content)
    || /(^|\n)\s*\d+\.\s+\S/.test(content)
    || /(^|\n)\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i.test(content)
    || /<svg\b[\s\S]*<\/svg>/i.test(content)
    || /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(content)
    || /`[^`]+`|\*\*[^*]+\*\*/.test(content)
}

function inlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const tokenPattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    if (match[2]) {
      nodes.push(<strong key={`strong-${match.index}`} className="font-semibold text-on-surface">{match[2]}</strong>)
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
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
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
    <div role="img" aria-label="Mermaid diagram" className="my-2 overflow-hidden rounded-xl border border-primary/25 bg-black/25 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-label uppercase tracking-wide text-primary">
        <span className="material-symbols-outlined text-[15px]">account_tree</span>
        Diagram
      </div>
      {parsed.labels.length > 0 ? (
        <div className="flex flex-col items-center gap-1.5 text-center text-xs text-on-surface">
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
        <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-black/35 p-2 font-mono text-[11px] text-on-surface-variant">{source}</pre>
      )}
    </div>
  )
}

function SvgPreview({ source }: { source: string }) {
  const safeSvg = sanitizeInlineSvg(source)
  if (!safeSvg) {
    return <pre className="my-2 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs text-on-surface-variant">{source}</pre>
  }
  return (
    <div className="my-2 overflow-auto rounded-xl border border-primary/20 bg-white p-3 text-slate-950" dangerouslySetInnerHTML={{ __html: safeSvg }} />
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
    <pre className="my-2 max-h-96 overflow-auto rounded-xl border border-white/10 bg-black/35 p-3 font-mono text-xs leading-relaxed text-on-surface-variant">
      <code>{code}</code>
    </pre>
  )
}

function renderMarkdownBlocks(content: string): ReactNode[] {
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
      if (text) nodes.push(<p key={`${baseKey}-p-${nodes.length}`} className="my-1.5 whitespace-pre-wrap">{inlineMarkdown(text)}</p>)
      paragraph = []
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/)
      const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)
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
        nodes.push(<Tag key={`${baseKey}-h-${nodes.length}`} className="mt-3 mb-1 text-sm font-semibold text-on-surface">{inlineMarkdown(heading[2])}</Tag>)
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
            {items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}
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

export function ChatMessageContent({ content }: { content: string }) {
  if (!content) return null
  if (!hasRichChatMarkup(content)) return <>{content}</>
  return <div className="space-y-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{renderMarkdownBlocks(content)}</div>
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
        <span key={`${choiceLabel(choice)}-${index}`} className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-on-surface-variant">
          {choiceLabel(choice)}
        </span>
      ))}
    </div>
  )
}

function RichMessagePartView({ part }: { part: RichMessagePart }) {
  const type = String(part.type).toLowerCase()
  if (type === 'markdown') {
    return <ChatMessageContent content={partContent(part)} />
  }
  if (type === 'code') {
    return <CodeBlock language={part.language ?? ''} code={part.code ?? partContent(part)} />
  }
  if (type === 'table') {
    const rows = Array.isArray(part.rows) ? part.rows : []
    const columns = Array.isArray(part.columns) ? part.columns : []
    return (
      <div className="my-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        {part.caption && <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-on-surface">{part.caption}</div>}
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            {columns.length > 0 && (
              <thead className="bg-white/[0.06] text-on-surface">
                <tr>
                  {columns.map((column) => (
                    <th key={column} scope="col" className="border-b border-white/10 px-3 py-2 font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="text-on-surface-variant">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-white/5 last:border-b-0">
                  {row.map((cell, cellIndex) => (
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
      <figure className="my-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        <img src={part.url} alt={part.alt ?? part.caption ?? part.name ?? 'Rich image'} className="max-h-72 w-full object-cover" />
        {part.caption && <figcaption className="px-3 py-2 text-xs text-on-surface-variant">{part.caption}</figcaption>}
      </figure>
    )
  }
  if (type === 'gallery' && part.images?.length) {
    return (
      <div className="my-2 grid grid-cols-2 gap-2">
        {part.images.map((image, index) => (
          <figure key={`${image.url}-${index}`} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <img src={image.url} alt={image.alt ?? image.caption ?? `Gallery image ${index + 1}`} className="h-36 w-full object-cover" />
            {image.caption && <figcaption className="px-2 py-1.5 text-[11px] text-on-surface-variant">{image.caption}</figcaption>}
          </figure>
        ))}
      </div>
    )
  }
  if ((type === 'file' || type === 'audio' || type === 'video') && part.url) {
    if (type === 'audio') {
      return (
        <div className="my-2 rounded-xl border border-white/10 bg-black/20 p-3">
          {part.name && <p className="mb-2 text-xs font-medium text-on-surface">{part.name}</p>}
          <audio controls src={part.url} className="w-full" />
        </div>
      )
    }
    if (type === 'video') {
      return (
        <div className="my-2 overflow-hidden rounded-xl border border-white/10 bg-black/20">
          <video controls src={part.url} className="max-h-80 w-full" />
          {part.name && <p className="px-3 py-2 text-xs text-on-surface-variant">{part.name}</p>}
        </div>
      )
    }
    return (
      <a href={part.url} target="_blank" rel="noreferrer" className="my-2 flex items-center gap-2 rounded-xl border border-white/15 bg-black/10 px-3 py-2 text-xs transition hover:border-primary/70">
        <span className="material-symbols-outlined text-[16px]">attach_file</span>
        <span className="min-w-0 flex-1 truncate">{part.name ?? part.title ?? 'File'}</span>
        {typeof part.sizeBytes === 'number' && <span className="shrink-0 opacity-60">{formatBytes(part.sizeBytes)}</span>}
      </a>
    )
  }
  if (type === 'tool_output') {
    const text = [part.output, part.stdout, part.stderr].filter(Boolean).join('\n')
    return (
      <div className="my-2 overflow-hidden rounded-xl border border-primary/20 bg-black/35">
        <div className="border-b border-white/10 px-3 py-2 text-[11px] font-label uppercase tracking-wide text-primary">
          {part.tool ?? part.title ?? 'Tool output'}
        </div>
        {text && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs text-on-surface-variant [overflow-wrap:anywhere]">{text}</pre>}
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
      <div className="my-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2">
        {title && <p className="text-sm font-semibold text-on-surface">{title}</p>}
        {part.body && <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">{part.body}</p>}
        {type === 'model_picker' && part.models?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {part.models.map((model) => (
              <span key={model.id} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-on-surface-variant">
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
  return partContent(part) ? <ChatMessageContent content={partContent(part)} /> : null
}

function RichMessageParts({ parts }: { parts?: RichMessagePart[] }) {
  if (!parts?.length) return null
  return (
    <div className="mt-2 space-y-2 whitespace-normal">
      {parts.map((part, index) => (
        <RichMessagePartView key={part.id ?? `${part.type}-${index}`} part={part} />
      ))}
    </div>
  )
}

function actionClasses(action: ChatUiAction): string {
  const type = String(action.type).toLowerCase()
  if (type === 'deny' || action.variant === 'danger') {
    return 'border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
  }
  if (type === 'approve' || action.variant === 'primary') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
  }
  return 'border-white/10 bg-white/[0.06] text-on-surface hover:border-primary/50 hover:bg-white/[0.09]'
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
    <div className="mt-2 flex flex-wrap gap-2 whitespace-normal">
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
              <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{type === 'download' ? 'download' : 'open_in_new'}</span>
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
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
              {type === 'copy' ? 'content_copy' : type === 'retry' ? 'refresh' : type === 'stop' ? 'stop_circle' : type === 'deny' ? 'block' : 'check_circle'}
            </span>
            {action.label}
          </button>
        )
      })}
    </div>
  )
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
  onUiAction,
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
          <div className="group/message max-w-[85%] min-w-0 lg:max-w-[80%] text-right">
            <div ref={contentRef} className="relative inline-block max-w-full text-left">
              {selectionPopover}
              <div
                onMouseUp={handleTextSelection}
                className="max-w-full overflow-hidden rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] lg:text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-[var(--color-card-active,rgba(255,255,255,0.08))] lg:bg-primary lg:text-on-primary text-on-surface"
              >
              <ChatMessageContent content={m.content} />
              <RichMessageParts parts={m.richParts} />
              {attachmentList}
              <RichActionBar actions={m.uiActions} message={m} onUiAction={onUiAction} />
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
  const consoleRows = commandConsoleRows(displayEvents)
  const commandConsole = consoleRows.length > 0 ? (
    <details open className="my-2 overflow-hidden rounded-xl border border-primary/20 bg-black/35 text-on-surface-variant shadow-inner group/console">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-label uppercase tracking-wide text-on-surface [&::-webkit-details-marker]:hidden">
        <span className="material-symbols-outlined text-[15px] text-primary">terminal</span>
        <span className="min-w-0 flex-1 truncate">Inline command console</span>
        <span className="rounded-full bg-white/8 px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
          {consoleRows.length}
        </span>
        <span className="material-symbols-outlined text-[14px] text-on-surface-variant transition-transform group-open/console:rotate-180">expand_more</span>
      </summary>
      <div className="max-h-80 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
        {consoleRows.map((row) => (
          <div key={row.key} className="mb-1.5 overflow-hidden rounded-lg border border-white/10 bg-[#050505]/80 last:mb-0">
            <div className="flex items-center gap-2 border-b border-white/5 px-2 py-1 text-[10px]">
              <span className={[
                'h-2 w-2 rounded-full shrink-0',
                row.status === 'failed' ? 'bg-red-400' : row.status === 'running' ? 'bg-primary animate-pulse' : row.status === 'done' ? 'bg-emerald-400' : 'bg-white/40',
              ].join(' ')} />
              <span className="min-w-0 flex-1 truncate text-primary">{row.label}</span>
              <span className="shrink-0 text-on-surface-variant/70">{row.meta}</span>
            </div>
            {row.body && (
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[11px] text-on-surface-variant [overflow-wrap:anywhere]">
                {row.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </details>
  ) : null

  return (
    <div className="flex min-w-0 justify-start gap-2.5 w-full overflow-hidden lg:gap-2.5">
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
            <div className="mb-1 min-w-0 space-y-1">
              <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2">
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
            {commandConsole}
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
        {!isPending && !isWaiting && commandConsole}
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
        <div ref={contentRef} className="relative max-w-full overflow-hidden">
          {selectionPopover}
          <div
            onMouseUp={handleTextSelection}
            className={
              isFailed
                ? 'max-w-full overflow-hidden rounded-2xl rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-red-500/15 text-red-200 border border-red-500/40'
                : [
                    // Mobile: plain prose, no background, larger readable text
                    'max-w-full overflow-hidden text-[15px] leading-relaxed text-on-surface whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
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
            <ChatMessageContent content={m.content || (isFailed && m.error) || ''} />
            <RichMessageParts parts={m.richParts} />
            {attachmentList}
            <RichActionBar actions={m.uiActions} message={m} onUiAction={onUiAction} />
          </div>
        </div>
        {copyAction}
      </div>
      {previewDialog}
    </div>
  )
}
