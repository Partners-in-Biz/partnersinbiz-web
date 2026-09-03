'use client'

import type { PublicMessageModelOption } from '@/lib/messages/model-catalog'
import type { ModelRuntimeSelection } from './ModelProviderPicker'
import { Icon } from '@/components/studio'

interface PinnedModelStripProps {
  models: PublicMessageModelOption[]
  selected: ModelRuntimeSelection | null
  pinnedKeys: string[]
  onSelect: (model: PublicMessageModelOption) => void
  onTogglePin: (model: PublicMessageModelOption) => void
}

function keyFor(model: PublicMessageModelOption): string {
  return `${model.connectionId || 'unbound'}:${model.provider}:${model.model}`
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
    <div className="mb-3 rounded-md border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] p-2" data-testid="pinned-model-strip">
      <div className="pib-label mb-2 flex items-center gap-1.5 px-1">
        <Icon name="star" className="text-[13px]" />
        Pinned models
      </div>
      <div className="flex flex-wrap gap-1.5">
        {models.map((model) => {
          const active = selected?.model === model.model
            && (!selected.provider || selected.provider === model.provider)
            && (!selected.llmConnectionId || selected.llmConnectionId === model.connectionId)
          const pinned = pinnedKeys.includes(keyFor(model))
          return (
            <span key={keyFor(model)} className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)]">
              <button
                type="button"
                onClick={() => onSelect(model)}
                disabled={!model.available}
                className={[
                  'max-w-[180px] truncate px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active ? 'bg-primary/20 text-primary' : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]',
                ].join(' ')}
                title={model.model}
              >
                {model.displayName}
              </button>
              <button
                type="button"
                onClick={() => onTogglePin(model)}
                className="grid h-6 w-6 place-items-center text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                aria-label={pinned ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
              >
                <Icon name={pinned ? 'close' : 'star'} className="text-[13px]" />
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}
