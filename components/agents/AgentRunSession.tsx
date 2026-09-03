'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import UnifiedChat from '@/components/chat/UnifiedChat'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { HudChip, SignalMeter } from '@/components/ui/HudChip'

import { Icon } from '@/components/studio'

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
    <div className="-mx-4 -my-8 flex h-[calc(100dvh-56px)] flex-col gap-3 overflow-hidden lg:mx-0 lg:my-0 lg:h-[calc(100dvh-120px)]" data-module-accent="cyan">
      <div className="hidden shrink-0 lg:block">
        <PageHeader
          accent="cyan"
          eyebrow="Workspace / Agent Session"
          title={taskTitle || 'Agent session'}
          description="The actual Hermes run attached to this ticket."
          actions={(
            <Link
              href={`/admin/org/${orgSlug}/messages`}
              className="btn-pib-secondary btn-pib-sm inline-flex items-center gap-1 font-label"
            >
              <Icon name="forum" className="text-[14px]" />
              Messages
            </Link>
          )}
        />
      </div>

      <Surface className="shrink-0 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <HudChip tone="live" className="text-cyan-300">
            <Icon name="smart_toy" className="text-[13px]" />
            {agentId}
          </HudChip>
          <HudChip className="font-mono">{runId}</HudChip>
          <HudChip live={streamState === 'live'} tone={streamState === 'live' ? 'live' : 'default'}>
            {streamState}
          </HudChip>
          <HudChip tone={runLoadState === 'missing' || runLoadState === 'error' ? 'accent' : 'live'}>
            {loading ? 'loading' : runLoadState === 'missing' ? 'run missing' : status}
          </HudChip>
          {taskId ? <HudChip className="font-mono">task {taskId}</HudChip> : null}
          <SignalMeter className="ml-auto" title={`Stream ${streamState}`} />
        </div>
      </Surface>

      {error && (
        <div className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)]">
          <div className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-4 py-3">
            <div>
              <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Ticket chat</h2>
              <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">Direct conversation scoped to this ticket.</p>
            </div>
          </div>
          <div className="h-[calc(100%-57px)] min-h-0">
            <UnifiedChat
              orgId={orgId}
              currentUserUid={currentUserUid}
              currentUserDisplayName={currentUserDisplayName}
              scope="task"
              scopeRefId={taskId}
              includeAllScopes
              initialAgentId={agentId}
              autoCreateScopedConversation={Boolean(taskId)}
              autoCreateTitle={taskTitle ? `Ticket: ${taskTitle}` : 'Ticket conversation'}
              allowDeleteConversations
              compact
            />
          </div>
        </section>

        <aside className="grid min-h-0 gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
          <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-card)]">
            <div className="flex items-center justify-between border-b border-[var(--color-pib-line)] px-4 py-3">
              <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Session events</h2>
              <span className="text-[10px] pib-label">
                {events.length} event{events.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="h-full overflow-y-auto p-4 pb-20">
              {events.length > 0 ? (
                <div className="space-y-3">
                  {events.map((event) => (
                    <article key={event.id} className="rounded border border-[var(--color-pib-line)] bg-black/20 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-[10px] font-label uppercase tracking-wide text-[var(--color-accent-v2)]">
                          {event.type}
                        </span>
                        <time className="text-[10px] text-[var(--color-pib-text-muted)]">
                          {new Date(event.receivedAt).toLocaleTimeString()}
                        </time>
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
                        {formatPayload(event.payload)}
                      </pre>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[260px] items-center justify-center rounded border border-dashed border-[var(--color-pib-line)] px-4 text-center text-sm text-[var(--color-pib-text-muted)]">
                  {loading
                    ? 'Loading the agent run...'
                    : runLoadState === 'missing'
                      ? 'This run is no longer available on the Hermes gateway. Use the ticket chat to continue.'
                      : 'No live events received yet. The final run payload is shown below.'}
                </div>
              )}
            </div>
          </section>

          <section className="max-h-[36vh] min-h-[220px] overflow-y-auto pib-card p-4">
            <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Run result</h2>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Status and final output returned by the selected agent gateway.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-1 text-[10px] pib-label">Status</p>
                <p className="text-sm text-[var(--color-pib-text)]">{loading ? 'Loading...' : runLoadState === 'missing' ? 'Run missing' : status}</p>
              </div>
              <div>
                <p className="mb-1 text-[10px] pib-label">Output</p>
                {outputText ? (
                  <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-pib-line)] bg-black/20 p-3 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
                    {outputText}
                  </pre>
                ) : (
                  <p className="rounded border border-dashed border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-text-muted)]">
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
