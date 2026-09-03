'use client'

import { Icon } from '@/components/studio'
import type { ChatContextReadModel, ChatContextReference } from '@/lib/chat-context/types'
import { ContextSelector, type ChatContextOption } from './ContextSelector'

export function ContextPulse({ model, contexts, activeContext, onContextChange, onOpen }: { model: ChatContextReadModel; contexts: ChatContextOption[]; activeContext: ChatContextReference; onContextChange: (value: ChatContextReference) => void; onOpen: () => void }) {
  return <div data-testid="context-pulse" className="shrink-0 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3 py-2">
    <div className="flex min-w-0 items-center gap-2.5">
      <Icon name={model.context.icon} className="shrink-0 text-[15px] text-primary" />
      <ContextSelector options={contexts} value={activeContext} onChange={onContextChange} />
      {model.pulse.progress && <progress aria-label={`${model.context.label} completion`} value={model.pulse.progress.complete} max={Math.max(model.pulse.progress.total, 1)} className="hidden h-1.5 min-w-[84px] flex-1 accent-[var(--color-primary)] sm:block" />}
      <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-[var(--color-pib-text-muted)] sm:text-[11px]">
        {model.pulse.metrics.map((metric) => <span key={metric.id}>{metric.value} {metric.label}</span>)}
      </div>
      <button type="button" aria-label="Open context dock" onClick={onOpen} className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-[var(--color-pib-text-muted)] outline-none hover:bg-white/[0.07] hover:text-[var(--color-pib-text)] focus-visible:ring-2 focus-visible:ring-primary/60 xl:h-7 xl:w-7"><Icon name="dock_to_right" className="text-[16px]" /></button>
    </div>
    {model.pulse.headline && <p className="mt-1 truncate pl-6 text-[10px] text-[var(--color-pib-text-muted)]">{model.pulse.headline}</p>}
  </div>
}
