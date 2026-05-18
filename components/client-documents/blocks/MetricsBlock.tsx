import type { DocumentBlock } from '@/lib/client-documents/types'
import { BlockFrame } from './BlockFrame'

type MetricItem = { label: string; value?: string | number; target?: string | number; description?: string }

function parseNumeric(s: string | number): number {
  return Number(String(s).replace(/[^\d.]/g, ''))
}

function MiniRing({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 60 60" className="h-12 w-12">
      <circle cx={30} cy={30} r={r} stroke="var(--doc-border)" strokeWidth={5} fill="none" />
      <circle
        cx={30}
        cy={30}
        r={r}
        stroke="var(--doc-accent)"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 30 30)"
      />
    </svg>
  )
}

export function MetricsBlock({ block, index }: { block: DocumentBlock; index: number }) {
  const items: MetricItem[] = ((block.content as { items?: MetricItem[] } | null)?.items) ?? []
  return (
    <BlockFrame block={block} index={index}>
      {block.title && (
        <h2 className="mb-8 text-2xl font-semibold text-[var(--doc-accent)] md:text-4xl">
          {block.title}
        </h2>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((item, i) => {
          const value = item.value == null ? '' : String(item.value)
          const target = item.target == null ? '' : String(item.target)
          const valueNum = item.value ? parseNumeric(item.value) : NaN
          const targetNum = item.target ? parseNumeric(item.target) : NaN
          const showRing =
            !!item.value &&
            !!item.target &&
            isFinite(valueNum) &&
            isFinite(targetNum) &&
            targetNum > 0 &&
            /^\D*\d/.test(value) &&
            /^\D*\d/.test(target)
          return (
            <div
              key={i}
              className="rounded-xl border p-5"
              style={{ borderColor: 'var(--doc-border)', background: 'var(--doc-surface)' }}
            >
              <p className="text-xs uppercase tracking-wider text-[var(--doc-muted)]">
                {item.label}
              </p>
              {showRing ? (
                <div className="mt-3 flex items-center gap-4" data-testid="metric-ring-row">
                  <MiniRing value={valueNum} max={targetNum} />
                  <p
                    className="text-3xl font-semibold md:text-4xl"
                    style={{ color: 'var(--doc-accent)' }}
                    data-counter={item.value}
                  >
                    {item.value}
                  </p>
                </div>
              ) : item.value ? (
                <p
                  className="mt-3 text-3xl font-semibold md:text-4xl"
                  style={{ color: 'var(--doc-accent)' }}
                  data-counter={item.value}
                >
                  {item.value}
                </p>
              ) : null}
              {item.target && (
                <p className="mt-1 text-xs text-[var(--doc-muted)]">Target: {item.target}</p>
              )}
              {item.description && (
                <p className="mt-2 text-sm text-[var(--doc-text)] opacity-80">{item.description}</p>
              )}
            </div>
          )
        })}
      </div>
    </BlockFrame>
  )
}
