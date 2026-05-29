'use client'

import {
  contextReferenceKey,
  type ContextReference,
  type ContextReferenceSeed,
} from '@/lib/context-references/types'

export function contextReferenceDisplay(ref: Pick<ContextReferenceSeed, 'type' | 'id' | 'label'>): string {
  return ref.label?.trim() || `${ref.type}:${ref.id}`
}

export function mergeContextReferences<T extends ContextReferenceSeed>(existing: T[], incoming: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const ref of [...existing, ...incoming]) byKey.set(contextReferenceKey(ref), ref)
  return Array.from(byKey.values()).slice(0, 8)
}

export function ContextReferenceChips({
  refs,
  onRemove,
  compact = false,
}: {
  refs: ContextReference[]
  onRemove?: (ref: ContextReference) => void
  compact?: boolean
}) {
  if (refs.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {refs.map((ref) => (
        <span
          key={contextReferenceKey(ref)}
          className={[
            'inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--color-card-border)] bg-[var(--color-surface-container)] text-on-surface',
            compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs',
          ].join(' ')}
        >
          <span className="shrink-0 font-label uppercase tracking-wide text-on-surface-variant">{ref.type}</span>
          <span className="min-w-0 truncate">{contextReferenceDisplay(ref)}</span>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${contextReferenceDisplay(ref)}`}
              onClick={() => onRemove(ref)}
              className="grid h-4 w-4 shrink-0 place-items-center rounded text-on-surface-variant hover:bg-black/10 hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
