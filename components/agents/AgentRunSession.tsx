'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import UnifiedChat from '@/components/chat/UnifiedChat'

interface AgentRunSessionProps {
  agentId: string
  runId: string
  orgId: string
  orgSlug: string
  currentUserUid: string
  currentUserDisplayName: string
  taskId?: string
  taskTitle?: string
}

interface SessionEvent {
  id: number
  receivedAt: string
  type: string
  payload: unknown
}

type StreamState = 'connecting' | 'live' | 'closed' | 'error'
type RunLoadState = 'loading' | 'loaded' | 'missing' | 'error'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  for (const key of keys) {
    const child = value[key]
    if (isRecord(child)) return child
  }
  return null
}

function pickString(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) return null
  for (const key of keys) {
    const child = value[key]
    if (typeof child === 'string' && child.trim()) return child
  }
  return null
}

function extractStatus(run: unknown): string {
  const nested = pickRecord(run, ['run', 'data'])
  return pickString(run, ['status', 'state']) ?? pickString(nested, ['status', 'state']) ?? 'unknown'
}

function extractOutput(run: unknown): unknown {
  if (!isRecord(run)) return null
  const nested = pickRecord(run, ['run', 'data'])
  return run.output ?? run.result ?? run.response ?? nested?.output ?? nested?.result ?? nested?.response ?? null
}

function eventType(payload: unknown): string {
  return pickString(payload, ['type', 'event', 'status', 'name']) ?? 'event'
}

function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function parseEventPayload(raw: string): unknown {
  if (!raw.trim()) return ''
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export default function AgentRunSession({
  agentId,
  runId,
  orgId,
  orgSlug,
  currentUserUid,
  currentUserDisplayName,
  taskId,
  taskTitle,
}: AgentRunSessionProps) {
  const [run, setRun] = useState<unknown>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<StreamState>('connecting')
  const [runLoadState, setRunLoadState] = useState<RunLoadState>('loading')

  useEffect(() => {
    let cancelled = false

    async function loadRun() {
      setLoading(true)
      setError(null)
      setRun(null)
      setRunLoadState('loading')
      try {
        const res = await fetch(`/api/v1/admin/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`, {
          cache: 'no-store',
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          const message = isRecord(data) && typeof data.error === 'string'
            ? data.error
            : `Run load failed (${res.status})`
          if (!cancelled) {
            setError(res.status === 404
              ? `This Hermes run is no longer available on ${agentId}. The ticket chat below is still usable.`
              : message)
            setRunLoadState(res.status === 404 ? 'missing' : 'error')
          }
          return
        }
        if (!cancelled) {
          setRun(data)
          setRunLoadState('loaded')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load run')
          setRunLoadState('error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadRun()
    return () => { cancelled = true }
  }, [agentId, runId])

  useEffect(() => {
    if (runLoadState !== 'loaded') {
      setStreamState(runLoadState === 'loading' ? 'connecting' : 'closed')
      return
    }
    setStreamState('connecting')
    const source = new EventSource(`/api/v1/admin/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`)

    source.onopen = () => setStreamState('live')
    source.onmessage = (event) => {
      const payload = parseEventPayload(event.data)
      setEvents((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          receivedAt: new Date().toISOString(),
          type: eventType(payload),
          payload,
        },
      ])
    }
    source.onerror = () => {
      setStreamState((current) => (current === 'live' ? 'closed' : 'error'))
      source.close()
    }

    return () => source.close()
  }, [agentId, runId, runLoadState])

  const status = useMemo(() => extractStatus(run), [run])
  const output = useMemo(() => extractOutput(run), [run])
  const outputText = output ? formatPayload(output) : ''

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden -mx-4 -my-8 lg:mx-0 lg:my-0 h-[calc(100dvh-56px)] lg:h-[calc(100dvh-120px)]">
      <div className="hidden shrink-0 lg:block">
        <p className="mb-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          Workspace / Agent Session
        </p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-headline font-bold text-on-surface">
              {taskTitle || 'Agent session'}
            </h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              The actual Hermes run attached to this ticket.
            </p>
          </div>
          <Link
            href={`/admin/org/${orgSlug}/messages`}
            className="inline-flex items-center gap-1 rounded border border-[var(--color-card-border)] px-3 py-2 text-[10px] font-label uppercase tracking-wide text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[14px]">forum</span>
            Messages
          </Link>
        </div>
      </div>

      <section className="shrink-0 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-[var(--color-accent-v2)]/10 px-2 py-1 text-[10px] font-label uppercase tracking-wide text-[var(--color-accent-v2)]">
            <span className="material-symbols-outlined text-[13px]">smart_toy</span>
            {agentId}
          </span>
          <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-on-surface-variant">
            {runId}
          </span>
          <span className="rounded bg-sky-500/10 px-2 py-1 text-[10px] font-label uppercase tracking-wide text-sky-300">
            {streamState}
          </span>
          <span className={[
            'rounded px-2 py-1 text-[10px] font-label uppercase tracking-wide',
            runLoadState === 'missing' || runLoadState === 'error'
              ? 'bg-red-500/10 text-red-300'
              : 'bg-emerald-500/10 text-emerald-300',
          ].join(' ')}>
            {loading ? 'loading' : runLoadState === 'missing' ? 'run missing' : status}
          </span>
          {taskId && (
            <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-on-surface-variant">
              task {taskId}
            </span>
          )}
        </div>
      </section>

      {error && (
        <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]">
          <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-on-surface">Ticket chat</h2>
              <p className="mt-0.5 text-xs text-on-surface-variant">Direct conversation scoped to this ticket.</p>
            </div>
          </div>
          <div className="h-[calc(100%-57px)] min-h-0">
            <UnifiedChat
              orgId={orgId}
              currentUserUid={currentUserUid}
              currentUserDisplayName={currentUserDisplayName}
              scope="task"
              scopeRefId={taskId}
              initialAgentId={agentId as 'pip' | 'theo' | 'maya' | 'sage' | 'nora'}
              autoCreateScopedConversation={Boolean(taskId)}
              autoCreateTitle={taskTitle ? `Ticket: ${taskTitle}` : 'Ticket conversation'}
              allowDeleteConversations
              compact
            />
          </div>
        </section>

        <aside className="grid min-h-0 gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
          <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]">
            <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-on-surface">Session events</h2>
              <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                {events.length} event{events.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="h-full overflow-y-auto p-4 pb-20">
              {events.length > 0 ? (
                <div className="space-y-3">
                  {events.map((event) => (
                    <article key={event.id} className="rounded border border-[var(--color-card-border)] bg-black/20 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-[10px] font-label uppercase tracking-wide text-[var(--color-accent-v2)]">
                          {event.type}
                        </span>
                        <time className="text-[10px] text-on-surface-variant">
                          {new Date(event.receivedAt).toLocaleTimeString()}
                        </time>
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-on-surface-variant">
                        {formatPayload(event.payload)}
                      </pre>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[260px] items-center justify-center rounded border border-dashed border-[var(--color-card-border)] px-4 text-center text-sm text-on-surface-variant">
                  {loading
                    ? 'Loading the agent run...'
                    : runLoadState === 'missing'
                      ? 'This run is no longer available on the Hermes gateway. Use the ticket chat to continue.'
                      : 'No live events received yet. The final run payload is shown below.'}
                </div>
              )}
            </div>
          </section>

          <section className="max-h-[36vh] min-h-[220px] overflow-y-auto rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-4">
            <h2 className="text-sm font-semibold text-on-surface">Run result</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Status and final output returned by the selected agent gateway.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</p>
                <p className="text-sm text-on-surface">{loading ? 'Loading...' : runLoadState === 'missing' ? 'Run missing' : status}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Output</p>
                {outputText ? (
                  <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-card-border)] bg-black/20 p-3 text-xs leading-relaxed text-on-surface-variant">
                    {outputText}
                  </pre>
                ) : (
                  <p className="rounded border border-dashed border-[var(--color-card-border)] p-3 text-xs text-on-surface-variant">
                    {runLoadState === 'missing'
                      ? 'Hermes no longer has this run. Continue from the ticket chat.'
                      : 'No final output returned yet.'}
                  </p>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
