import type { ChatEvent } from '@/lib/hermes/types'

/** Browser-safe thinking trail — no tool I/O, paths, or auth material. */
export type MessageThinkingStep = {
  kind: 'reasoning' | 'tool' | 'task' | 'status'
  label: string
  status?: string
  at?: number
}

export type MessageThinkingTrace = {
  summary: string | null
  steps: MessageThinkingStep[]
  toolCount: number
  durationMs?: number
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
      return null // folded into summary
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

/** Build a public thinking trace from streamed/persisted chat events. */
export function buildThinkingTrace(events: ChatEvent[] = []): MessageThinkingTrace | null {
  if (!Array.isArray(events) || events.length === 0) return null

  const summaryEvent = [...events].reverse().find(
    (item) => item.event === 'reasoning.summary' && (item.text || item.preview),
  )
  const summary = typeof summaryEvent?.text === 'string'
    ? summaryEvent.text.trim()
    : typeof summaryEvent?.preview === 'string'
      ? summaryEvent.preview.trim()
      : null

  const steps = dedupeSteps(events.flatMap((event) => {
    const step = stepFromEvent(event)
    return step ? [step] : []
  }))

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

  if (!summary && steps.length === 0) return null

  return {
    summary: summary || null,
    steps,
    toolCount,
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

export function mergeChatEvents(existing: ChatEvent[] = [], incoming: ChatEvent[] = []): ChatEvent[] {
  if (!incoming.length) return existing
  if (!existing.length) return incoming
  // Prefer the longer trail (client SSE usually has the richest stream).
  return incoming.length >= existing.length ? incoming : existing
}
