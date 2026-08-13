import type { ChatEvent } from '@/lib/hermes/types'

/** Browser-safe thinking trail — no tool I/O, paths, or auth material. */
export type MessageThinkingStep = {
  kind: 'reasoning' | 'tool' | 'task' | 'status'
  label: string
  status?: string
  at?: number
}

/** Interleaved narrative blocks for the sleek thought stream UI. */
export type MessageThinkingSegment = {
  kind: 'thought' | 'tools'
  /** Natural-language reasoning for thought segments. */
  text?: string
  /** Muted one-liner for tool segments, e.g. "Ran 1 command, used 1 tool". */
  summary?: string
  durationMs?: number
}

export type MessageThinkingTrace = {
  summary: string | null
  steps: MessageThinkingStep[]
  toolCount: number
  durationMs?: number
  /** Chronological thought / tool blocks for transcript rendering. */
  segments?: MessageThinkingSegment[]
}

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return fallback
  // Strip absolute paths / home dirs that sometimes leak into previews.
  const scrubbed = trimmed
    .replace(/\/(?:var|Users|home|tmp)\/[^\s'"`]+/gi, '…')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer …')
  return scrubbed.slice(0, 160)
}

function stepFromEvent(event: ChatEvent): MessageThinkingStep | null {
  const at = typeof event.timestamp === 'number' ? event.timestamp : undefined
  switch (event.event) {
    case 'reasoning.summary':
    case 'reasoning.delta':
      return null // folded into summary / segments
    case 'tool.started':
    case 'tool.input_delta':
      return {
        kind: 'tool',
        label: cleanLabel(event.tool ?? event.activity, 'Using a tool'),
        status: 'started',
        at,
      }
    case 'tool.completed':
      return {
        kind: 'tool',
        label: cleanLabel(event.tool ?? event.activity, 'Tool'),
        status: event.error ? 'failed' : 'completed',
        at,
      }
    case 'task.created':
    case 'task.updated':
      return {
        kind: 'task',
        label: cleanLabel(event.title ?? event.preview ?? event.activity, 'Updating tasks'),
        status: cleanLabel(event.status, 'in_progress'),
        at,
      }
    case 'approval.required':
      return { kind: 'status', label: 'Waiting for approval', status: 'waiting', at }
    case 'run.completed':
      return { kind: 'status', label: 'Finalising response', status: 'completed', at }
    case 'run.failed':
    case 'run.interrupted':
      return { kind: 'status', label: event.event === 'run.interrupted' ? 'Run interrupted' : 'Run failed', status: 'failed', at }
    case 'assistant.text_delta':
    case 'heartbeat':
      return null
    default:
      if (event.tool) {
        return {
          kind: 'tool',
          label: cleanLabel(event.tool, 'Tool'),
          status: cleanLabel(event.event, 'event'),
          at,
        }
      }
      return null
  }
}

function dedupeSteps(steps: MessageThinkingStep[]): MessageThinkingStep[] {
  const out: MessageThinkingStep[] = []
  for (const step of steps) {
    const prev = out[out.length - 1]
    if (prev && prev.kind === step.kind && prev.label === step.label && prev.status === step.status) continue
    out.push(step)
  }
  return out.slice(-24)
}

function isToolishEvent(event: ChatEvent): boolean {
  const name = event.event ?? ''
  if (name === 'tool.started' || name === 'tool.input_delta' || name === 'tool.completed') return true
  if (name === 'task.created' || name === 'task.updated') return true
  if (event.tool && name !== 'assistant.text_delta' && name !== 'reasoning.delta' && name !== 'reasoning.summary') {
    return true
  }
  return false
}

/** Compact human summary of tool-ish events — shared by UI and persistence. */
export function summarizeToolEvents(events: ChatEvent[]): string {
  if (events.length === 0) return ''
  let commands = 0
  let read = 0
  let wrote = 0
  let searched = 0
  let web = 0
  let other = 0
  for (const ev of events) {
    const t = (ev.tool ?? ev.event ?? '').toLowerCase()
    if (!t) {
      other++
      continue
    }
    if (/(^|_)(read|view|cat|glob|ls|list)(_|$)/.test(t)) read++
    else if (/(bash|exec|shell|command|^run$|run_|terminal)/.test(t)) commands++
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
  if (!parts.length && other) parts.push(`used ${plur(other, 'tool')}`)
  else if (other && parts.length) parts.push(`used ${plur(other, 'tool')}`)
  else if (!parts.length) parts.push(plur(events.length, 'action'))
  const joined = parts.join(', ')
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

/** Hide encrypted / token-soup reasoning until a readable summary lands. */
export function isReadableThought(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return false
  if (/[\u0000-\u0008\uFFFD]/.test(t)) return false
  const letters = (t.match(/\p{L}/gu) || []).length
  const cjk = (t.match(/\p{Script=Han}/gu) || []).length
  const spaces = (t.match(/\s/g) || []).length
  const words = t.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length
  if (cjk >= 8 || (t.length > 0 && cjk / t.length >= 0.3)) return true
  if (t.length < 28) {
    return /\p{L}/u.test(t) && !/^[A-Za-z0-9+/_=-]{16,}$/.test(t.replace(/\s/g, ''))
  }
  if (spaces === 0 && /^[A-Za-z0-9+/_=-]+$/.test(t)) return false
  if (t.length >= 40 && words < 3 && spaces / t.length < 0.05) return false
  if (letters / Math.max(t.length, 1) < 0.28) return false
  return true
}

function buildSegments(events: ChatEvent[]): MessageThinkingSegment[] {
  const segments: MessageThinkingSegment[] = []
  let thoughtBuf = ''
  let toolBuf: ChatEvent[] = []

  const flushThought = () => {
    const text = thoughtBuf.replace(/\s+$/u, '').trim()
    thoughtBuf = ''
    if (!text || !isReadableThought(text)) return
    const prev = segments[segments.length - 1]
    if (prev?.kind === 'thought' && prev.text) {
      // Merge consecutive thought chunks (delta stream + summary settle).
      prev.text = text.startsWith(prev.text) ? text : `${prev.text}\n\n${text}`
      return
    }
    segments.push({ kind: 'thought', text: text.slice(0, 4000) })
  }

  const flushTools = () => {
    if (toolBuf.length === 0) return
    const summary = summarizeToolEvents(toolBuf)
    toolBuf = []
    if (!summary) return
    const prev = segments[segments.length - 1]
    if (prev?.kind === 'tools') {
      prev.summary = summary
      return
    }
    segments.push({ kind: 'tools', summary })
  }

  for (const event of events) {
    if (event.event === 'reasoning.delta') {
      flushTools()
      const chunk = typeof event.delta === 'string'
        ? event.delta
        : typeof event.text === 'string'
          ? event.text
          : ''
      thoughtBuf += chunk
      continue
    }
    if (event.event === 'reasoning.summary') {
      flushTools()
      const text = (typeof event.text === 'string' ? event.text : typeof event.preview === 'string' ? event.preview : '').trim()
      if (text) {
        // Prefer the settled summary as the current thought block body.
        thoughtBuf = text
        flushThought()
      }
      continue
    }
    if (isToolishEvent(event)) {
      flushThought()
      toolBuf.push(event)
      continue
    }
  }
  flushThought()
  flushTools()
  return segments.slice(-32)
}

/** Live concatenated reasoning text from delta + summary events. */
export function liveReasoningText(events: ChatEvent[] = []): string {
  if (!Array.isArray(events) || events.length === 0) return ''
  let buf = ''
  let lastSummary = ''
  for (const event of events) {
    if (event.event === 'reasoning.delta') {
      const chunk = typeof event.delta === 'string'
        ? event.delta
        : typeof event.text === 'string'
          ? event.text
          : ''
      buf += chunk
    } else if (event.event === 'reasoning.summary') {
      const text = (typeof event.text === 'string' ? event.text : typeof event.preview === 'string' ? event.preview : '').trim()
      if (text) {
        lastSummary = text
        // If we have no streamed deltas yet, use summary; if deltas exist and
        // summary subsumes them, prefer summary as the settled form.
        if (!buf.trim() || text.startsWith(buf.trim()) || buf.trim().startsWith(text.slice(0, 40))) {
          buf = text
        }
      }
    }
  }
  const deltaText = buf.trim()
  if (lastSummary && isReadableThought(lastSummary)) return lastSummary.slice(0, 4000)
  if (deltaText && isReadableThought(deltaText)) return deltaText.slice(0, 4000)
  return ''
}

/** Build a public thinking trace from streamed/persisted chat events. */
export function buildThinkingTrace(events: ChatEvent[] = []): MessageThinkingTrace | null {
  if (!Array.isArray(events) || events.length === 0) return null

  const summaryEvent = [...events].reverse().find(
    (item) => item.event === 'reasoning.summary' && (item.text || item.preview),
  )
  const streamed = liveReasoningText(events)
  const summary = typeof summaryEvent?.text === 'string'
    ? summaryEvent.text.trim()
    : typeof summaryEvent?.preview === 'string'
      ? summaryEvent.preview.trim()
      : streamed || null

  const steps = dedupeSteps(events.flatMap((event) => {
    const step = stepFromEvent(event)
    return step ? [step] : []
  }))

  const segments = buildSegments(events)

  const toolCount = new Set(
    steps.filter((step) => step.kind === 'tool').map((step) => step.label),
  ).size
  const stamps = events
    .map((event) => event.timestamp)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map((value) => (value > 10_000_000_000 ? value : value * 1000))

  const durationMs = stamps.length >= 2
    ? Math.max(0, Math.round(Math.max(...stamps) - Math.min(...stamps)))
    : undefined

  if (!summary && steps.length === 0 && segments.length === 0) return null

  return {
    summary: summary || null,
    steps,
    toolCount,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(segments.length > 0 ? { segments } : {}),
  }
}

export function mergeChatEvents(existing: ChatEvent[] = [], incoming: ChatEvent[] = []): ChatEvent[] {
  if (!incoming.length) return existing
  if (!existing.length) return incoming
  // Prefer the longer trail (client SSE usually has the richest stream).
  return incoming.length >= existing.length ? incoming : existing
}
