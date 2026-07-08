'use client'

import type { ChatEvent } from '@/lib/hermes/types'
import type { ConversationMessage } from '@/components/chat/MessageBubble'
import type { MessageModelCatalog, ModelRuntimeSelection } from './ModelProviderPicker'

interface RuntimeInspectorRailProps {
  activeMessage: ConversationMessage | null
  events: ChatEvent[]
  selectedRuntime: ModelRuntimeSelection | null
  catalog: MessageModelCatalog | null
  canStop?: boolean
  onStop?: () => void
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

function modelLabel(model?: string, provider?: string): string {
  if (!model) return 'Auto model'
  const leaf = model.split('/').pop() || model
  return provider ? `${provider} · ${leaf}` : leaf
}

export function RuntimeInspectorRail({
  activeMessage,
  events,
  selectedRuntime,
  catalog,
  canStop = false,
  onStop,
}: RuntimeInspectorRailProps) {
  const runtimeModel = activeMessage?.model ?? selectedRuntime?.model ?? catalog?.currentModel
  const runtimeProvider = activeMessage?.provider ?? selectedRuntime?.provider ?? catalog?.currentProvider
  const status = activeMessage?.status ?? 'idle'

  return (
    <aside data-testid="runtime-inspector-rail" className="hidden xl:flex min-h-0 w-[280px] flex-col overflow-hidden rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)]/70">
      <div className="border-b border-[var(--color-card-border)] px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
          <span className="material-symbols-outlined text-[16px]">developer_board</span>
          Runtime inspector
        </div>
        <div className="mt-1 truncate text-[11px] text-on-surface-variant">
          Hermes run, model, provider and live event status
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto p-3 text-xs">
        <section className="rounded-xl border border-[var(--color-card-border)] bg-black/10 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-on-surface-variant">Selected runtime</div>
          <div className="truncate font-medium text-on-surface">{modelLabel(runtimeModel, runtimeProvider)}</div>
          {runtimeModel && (
            <div className="truncate font-mono text-[10px] text-on-surface-variant" title={runtimeModel}>{runtimeModel}</div>
          )}
          <div className="truncate text-[11px] text-on-surface-variant">
            {catalog?.source === 'agent-default' ? 'Agent default fallback' : catalog?.source === 'hermes' ? 'Hermes catalogue' : 'No catalogue loaded'}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--color-card-border)] bg-black/10 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-on-surface-variant">Latest run</div>
          {activeMessage ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-on-surface">{activeMessage.authorDisplayName}</span>
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-on-surface-variant">{status}</span>
              </div>
              <div className="truncate font-mono text-[10px] text-on-surface-variant" title={activeMessage.runId}>
                {shortRunId(activeMessage.runId)}
              </div>
              {canStop && onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-400/25 bg-red-500/10 px-2.5 text-[11px] font-medium text-red-200 hover:bg-red-500/15"
                >
                  <span className="material-symbols-outlined text-[14px]">stop_circle</span>
                  Stop run
                </button>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-on-surface-variant">No active run yet.</div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--color-card-border)] bg-black/10 p-2.5">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-on-surface-variant">Live events</div>
          {events.length === 0 ? (
            <div className="text-[11px] text-on-surface-variant">Events will appear here while Pip is working.</div>
          ) : (
            <div className="space-y-1.5">
              {events.slice(-8).map((event, index) => (
                <div key={index} className="flex items-start gap-1.5 text-[11px] text-on-surface-variant">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
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
