'use client'
import type { BriefingCard } from './cockpitTypes'

type Props = {
  changedCount: number
  changed: BriefingCard[]
  riskCount: number
  autoCount: number
  onBriefMe: () => void
}

export function CatchUpNarrative({ changedCount, changed, riskCount, autoCount, onBriefMe }: Props) {
  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 text-sm">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-on-surface-variant">
        Since you last looked
      </div>
      {changedCount === 0 ? (
        <p className="text-on-surface-variant">Nothing new since you last looked.</p>
      ) : (
        <>
          <p className="text-on-surface">
            <strong>
              {changedCount} {changedCount === 1 ? 'thing' : 'things'} changed.
            </strong>
          </p>
          {riskCount > 0 && (
            <p className="text-red-400">
              <strong>{riskCount} on fire</strong>
            </p>
          )}
          {autoCount > 0 && (
            <p className="text-green-400">
              <strong>{autoCount} moving on their own</strong>
            </p>
          )}
          <ul className="mt-2 space-y-1">
            {changed.slice(0, 3).map((c) => (
              <li key={c.id} className="truncate text-xs text-on-surface-variant">
                • {c.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <button onClick={onBriefMe} className="pib-btn-primary mt-3 text-xs">
        ✦ Brief me in full
      </button>
    </div>
  )
}
