'use client'

import type { PublicMessageModelOption } from '@/lib/messages/model-catalog'
import type { ModelRuntimeSelection } from './ModelProviderPicker'

interface PinnedModelStripProps {
  models: PublicMessageModelOption[]
  selected: ModelRuntimeSelection | null
  pinnedKeys: string[]
  onSelect: (model: PublicMessageModelOption) => void
  onTogglePin: (model: PublicMessageModelOption) => void
}

function keyFor(model: PublicMessageModelOption): string {
  return `${model.provider}:${model.model}`
}

export default function PinnedModelStrip({
  models,
  selected,
  pinnedKeys,
  onSelect,
  onTogglePin,
}: PinnedModelStripProps) {
  if (models.length === 0) return null

  return (
    <div className="mb-3 rounded-xl border border-[var(--color-card-border)] bg-white/[0.03] p-2" data-testid="pinned-model-strip">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-on-surface-variant">
        <span className="material-symbols-outlined text-[13px]">star</span>
        Pinned models
      </div>
      <div className="flex flex-wrap gap-1.5">
        {models.map((model) => {
          const active = selected?.model === model.model && (!selected.provider || selected.provider === model.provider)
          const pinned = pinnedKeys.includes(keyFor(model))
          return (
            <span key={keyFor(model)} className="inline-flex max-w-full items-center overflow-hidden rounded-full border border-[var(--color-card-border)] bg-black/10">
              <button
                type="button"
                onClick={() => onSelect(model)}
                disabled={!model.available}
                className={[
                  'max-w-[180px] truncate px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface',
                ].join(' ')}
                title={model.model}
              >
                {model.displayName}
              </button>
              <button
                type="button"
                onClick={() => onTogglePin(model)}
                className="grid h-6 w-6 place-items-center text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface"
                aria-label={pinned ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
              >
                <span className="material-symbols-outlined text-[13px]">{pinned ? 'close' : 'star'}</span>
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}
