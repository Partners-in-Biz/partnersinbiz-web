'use client'

import { useEffect, useState } from 'react'
import type { ChatEvent } from '@/lib/hermes/types'
import type { ConversationMessage } from '@/components/chat/MessageBubble'
import type { MessageModelCatalog, ModelRuntimeSelection } from './ModelProviderPicker'
import { Icon } from '@/components/studio'

export interface RuntimeExecution {
  activeMessage: ConversationMessage | null
  events: ChatEvent[]
  selectedRuntime: ModelRuntimeSelection | null
  catalog: MessageModelCatalog | null
  canStop?: boolean
  onStop?: () => void
  canRetry?: boolean
  onRetry?: () => void
}

interface RuntimeInspectorRailProps extends RuntimeExecution {
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  variant?: 'classic' | 'hermes'
}

export function executionNeedsAttention(status?: string): boolean {
  return status === 'pending' || status === 'streaming' || status === 'waiting_approval' || status === 'failed' || status === 'error'
}

function eventLabel(event: ChatEvent): string {
  const record = event as unknown as Record<string, unknown>
  if (typeof record.tool === 'string' && record.tool) return record.tool
  if (typeof record.event === 'string' && record.event) return record.event.replace(/[._-]/g, ' ')
  const type = typeof record.type === 'string' ? record.type : 'event'
  if (type === 'assistant.text_delta') return 'Streaming response'
  if (type.includes('tool')) return 'Tool activity'
  if (type.includes('approval')) return 'Approval checkpoint'
  if (type.includes('error')) return 'Runtime error'
  return type.replace(/[._-]/g, ' ')
}

function eventPreview(event: ChatEvent): string {
  return event.preview || event.text || event.delta || event.output || event.stdout || event.stderr || ''
}

function shortRunId(runId?: string): string {
  if (!runId) return 'No run yet'
  if (runId.length <= 18) return runId
  return `${runId.slice(0, 8)}…${runId.slice(-6)}`
}

function modelLabel(model?: string, provider?: string, options?: { auto?: boolean }): string {
  if (!model) return options?.auto ? 'Auto model' : 'Auto model'
  const leaf = model.split('/').pop() || model
  const base = provider ? `${provider} · ${leaf}` : leaf
  return options?.auto ? `Auto · ${base}` : base
}

function resolveInspectorRuntime(
  activeMessage: ConversationMessage | null,
  selectedRuntime: ModelRuntimeSelection | null,
  catalog: MessageModelCatalog | null,
) {
  const explicitModel = activeMessage?.model || selectedRuntime?.model
  const explicitProvider = activeMessage?.provider || selectedRuntime?.provider
  const isAuto = !explicitModel
  const runtimeModel = explicitModel
    || catalog?.autoModel
    || catalog?.currentModel
  const runtimeProvider = explicitProvider
    || (isAuto ? catalog?.autoProvider || catalog?.currentProvider : undefined)
  return { runtimeModel, runtimeProvider, isAuto }
}

export function RuntimeExecutionSection({
  activeMessage,
  events,
  selectedRuntime,
  catalog,
  canStop = false,
  onStop,
  canRetry = false,
  onRetry,
}: RuntimeExecution) {
  const { runtimeModel, runtimeProvider, isAuto } = resolveInspectorRuntime(activeMessage, selectedRuntime, catalog)
  const status = activeMessage?.status ?? 'idle'
  const important = executionNeedsAttention(status)
  const [expanded, setExpanded] = useState(important)
  const [copiedRunId, setCopiedRunId] = useState(false)

  useEffect(() => {
    setExpanded(important)
  }, [important])

  const copyRunId = async () => {
    if (!activeMessage?.runId) return
    await navigator.clipboard?.writeText(activeMessage.runId).catch(() => undefined)
    setCopiedRunId(true)
    window.setTimeout(() => setCopiedRunId(false), 1200)
  }

  if (!activeMessage?.runId) return null

  return (
    <section role="region" aria-label="Execution" data-emphasized={important || undefined} className="rounded-md border border-[var(--color-card-border)] bg-black/10">
      <button type="button" aria-label={expanded ? 'Collapse execution' : 'Expand execution'} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-2 p-2.5 text-left xl:min-h-0">
        <span className="flex items-center gap-2 text-xs font-medium text-[var(--color-pib-text)]"><Icon name="developer_board" className="text-[16px] text-[var(--color-pib-blue)]" />Execution</span>
        <span className="flex items-center gap-1.5"><span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">{status}</span><Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-[15px] text-[var(--color-pib-text-muted)]" /></span>
      </button>
      {expanded && <div className="space-y-3 border-t border-[var(--color-card-border)] p-2.5 text-xs">
        <div><div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Selected runtime</div><div className="truncate font-medium text-[var(--color-pib-text)]">{modelLabel(runtimeModel, runtimeProvider, { auto: isAuto })}</div>{runtimeModel && <div className="truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]" title={runtimeModel}>{runtimeModel}</div>}{isAuto && catalog?.autoLabel && <div className="truncate text-[10px] text-[var(--color-pib-text-muted)]">Live Hermes Auto</div>}</div>
        <div><div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Run</div><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]" title={activeMessage.runId}>{shortRunId(activeMessage.runId)}</span><button type="button" onClick={copyRunId} aria-label="Copy run ID" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[var(--color-pib-text-muted)] xl:h-6 xl:w-6"><Icon name={copiedRunId ? 'check' : 'content_copy'} className="text-[13px]" /></button></div>
          {(canStop && onStop) || (canRetry && onRetry) ? <div className="mt-2 flex flex-wrap gap-2">{canStop && onStop && <button type="button" onClick={onStop} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-red-400/25 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-200 xl:min-h-7"><Icon name="stop_circle" className="text-[14px]" />Stop run</button>}{canRetry && onRetry && <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-[11px] font-medium text-[var(--color-pib-text)] xl:min-h-7"><Icon name="refresh" className="text-[14px]" />Retry run</button>}</div> : null}
        </div>
        <div><div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Live events</div>{events.length === 0 ? <div className="text-[11px] text-[var(--color-pib-text-muted)]">No runtime events recorded.</div> : <div className="space-y-1.5">{events.slice(-8).map((event, index) => <div key={index} className="flex items-start gap-1.5 text-[11px] text-[var(--color-pib-text-muted)]"><span className="mt-1 h-1.5 w-1.5 shrink-0 bg-primary/70" style={{ borderRadius: '50%' }}/><span className="flex min-w-0 items-center gap-1 truncate"><span>{eventLabel(event)}</span>{eventPreview(event) && <span aria-hidden="true">·</span>}{eventPreview(event) && <span>{eventPreview(event)}</span>}</span></div>)}</div>}</div>
      </div>}
    </section>
  )
}

export function RuntimeInspectorRail({
  activeMessage,
  events,
  selectedRuntime,
  catalog,
  canStop = false,
  onStop,
  collapsed = false,
  onCollapsedChange,
  variant = 'classic',
}: RuntimeInspectorRailProps) {
  const { runtimeModel, runtimeProvider, isAuto } = resolveInspectorRuntime(activeMessage, selectedRuntime, catalog)
  const status = activeMessage?.status ?? 'idle'
  const [copiedRunId, setCopiedRunId] = useState(false)

  const copyRunId = async () => {
    if (!activeMessage?.runId) return
    await navigator.clipboard?.writeText(activeMessage.runId).catch(() => undefined)
    setCopiedRunId(true)
    window.setTimeout(() => setCopiedRunId(false), 1200)
  }

  if (collapsed) {
    return (
      <aside
        data-testid="runtime-inspector-rail"
        data-collapsed="true"
        className="hidden min-h-0 w-11 flex-col items-center gap-2 overflow-hidden rounded-md border border-[var(--color-card-border)] bg-black/[0.08] py-2 xl:flex"
      >
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
          aria-label="Expand runtime inspector"
          title="Expand runtime inspector"
        >
          <Icon name="developer_board" className="text-[17px] text-[var(--color-pib-blue)]" />
        </button>
        <span
          className={[
            'h-2 w-2 rounded-md',
            status === 'pending' || status === 'streaming' || status === 'waiting_approval'
              ? 'bg-primary'
              : activeMessage?.runId
                ? 'bg-emerald-400'
                : 'bg-white/25',
          ].join(' ')}
          title={`Runtime status: ${status}`}
        />
        {events.length > 0 && (
          <span className="rounded-md bg-white/[0.06] px-1 text-[10px] text-[var(--color-pib-text-muted)]" title="Live runtime events">
            {events.length}
          </span>
        )}
      </aside>
    )
  }

  return (
    <aside
      data-testid="runtime-inspector-rail"
      data-collapsed="false"
      className={[
        'hidden min-h-0 flex-col overflow-hidden border border-[var(--color-card-border)] xl:flex',
        variant === 'hermes'
          ? 'w-[260px] rounded-md bg-black/[0.08]'
          : 'w-[280px] rounded-md bg-[var(--color-card)]/70',
      ].join(' ')}
    >
      <div className="border-b border-[var(--color-card-border)] px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-pib-text)]">
            <Icon name="developer_board" className="text-[16px] text-[var(--color-pib-blue)]" />
            Runtime inspector
          </div>
          {onCollapsedChange && (
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] hover:bg-white/[0.08] hover:text-[var(--color-pib-text)]"
              aria-label="Collapse runtime inspector"
              title="Collapse runtime inspector"
            >
              <Icon name="right_panel_close" className="text-[15px]" />
            </button>
          )}
        </div>
        <div className="mt-1 truncate text-[11px] text-[var(--color-pib-text-muted)]">
          Hermes run, model, provider and live event status
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto p-3 text-xs">
        <section className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Selected runtime</div>
          <div className="truncate font-medium text-[var(--color-pib-text)]">{modelLabel(runtimeModel, runtimeProvider, { auto: isAuto })}</div>
          {runtimeModel && (
            <div className="truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]" title={runtimeModel}>{runtimeModel}</div>
          )}
          <div className="truncate text-[11px] text-[var(--color-pib-text-muted)]">
            {isAuto
              ? (catalog?.runtimeSource === 'live_config' ? 'Auto · live Hermes primary' : catalog?.autoLabel ? 'Auto · agent default' : 'Auto model')
              : catalog?.source === 'agent-default' ? 'Explicit override · agent default catalogue' : 'Explicit per-run override'}
          </div>
        </section>

        <section className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Latest run</div>
          {activeMessage ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[var(--color-pib-text)]">{activeMessage.authorDisplayName}</span>
                <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">{status}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]" title={activeMessage.runId}>
                  {shortRunId(activeMessage.runId)}
                </div>
                {activeMessage.runId && (
                  <button
                    type="button"
                    onClick={copyRunId}
                    aria-label="Copy run ID"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[var(--color-pib-text-muted)] hover:border-primary/40 hover:text-[var(--color-pib-text)]"
                  >
                    <Icon name={copiedRunId ? 'check' : 'content_copy'} className="text-[13px]" />
                  </button>
                )}
              </div>
              {canStop && onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-400/25 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-200 hover:bg-red-500/15"
                >
                  <Icon name="stop_circle" className="text-[14px]" />
                  Stop run
                </button>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-pib-text-muted)]">No active run yet.</div>
          )}
        </section>

        <section className="rounded-md border border-[var(--color-card-border)] bg-black/10 p-2.5">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">Live events</div>
          {events.length === 0 ? (
            <div className="text-[11px] text-[var(--color-pib-text-muted)]">Events will appear here while Pip is working.</div>
          ) : (
            <div className="space-y-1.5">
              {events.slice(-8).map((event, index) => (
                <div key={index} className="flex items-start gap-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-primary/70" style={{ borderRadius: '50%' }} />
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    <span>{eventLabel(event)}</span>
                    {eventPreview(event) && <span aria-hidden="true">·</span>}
                    {eventPreview(event) && <span>{eventPreview(event)}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

export default RuntimeInspectorRail
