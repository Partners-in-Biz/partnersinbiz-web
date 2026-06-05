// components/crm/segments/EngagementRuleEditor.tsx
'use client'

import type { EngagementScoreRule } from '@/lib/crm/segments'

interface EngagementRuleEditorProps {
  rule: EngagementScoreRule | null
  onChange: (rule: EngagementScoreRule | null) => void
}

export function EngagementRuleEditor({ rule, onChange }: EngagementRuleEditorProps) {
  const enabled = rule !== null
  const min = rule?.min ?? 0
  const max = rule?.max ?? 100
  const lastEngagedWithinDays = rule?.lastEngagedWithinDays ?? ''
  const notEngagedWithinDays = rule?.notEngagedWithinDays ?? ''

  function patch(p: Partial<EngagementScoreRule>) {
    const next: EngagementScoreRule = {
      ...(rule ?? {}),
      ...p,
    }
    // If everything is empty, drop the rule entirely.
    if (
      next.min === undefined &&
      next.max === undefined &&
      next.lastEngagedWithinDays === undefined &&
      next.notEngagedWithinDays === undefined
    ) {
      onChange(null)
      return
    }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow !text-[10px]">Engagement score</p>
          <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-1">
            Score = opens × 5 + clicks × 15 − bounces × 30 − days-since-engaged × 0.5 (capped 0-100).
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              if (e.target.checked) {
                onChange({ min: 40 })
              } else {
                onChange(null)
              }
            }}
          />
          Enable
        </label>
      </div>

      {enabled && (
        <div className="border border-[var(--color-pib-line)] rounded p-3 space-y-3 bg-[var(--color-pib-surface,rgba(255,255,255,0.02))]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono flex justify-between">
                <span>Min score</span>
                <span className="text-[var(--color-pib-accent)]">{min}</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={min}
                onChange={(e) => patch({ min: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono flex justify-between">
                <span>Max score</span>
                <span className="text-[var(--color-pib-accent)]">{max}</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={max}
                onChange={(e) => patch({ max: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Last engaged within N days
              </label>
              <input
                type="number"
                min={0}
                value={lastEngagedWithinDays}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  patch({ lastEngagedWithinDays: Number.isFinite(n) && n > 0 ? n : undefined })
                }}
                placeholder="any time"
                className="pib-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                NOT engaged within N days (dormant)
              </label>
              <input
                type="number"
                min={0}
                value={notEngagedWithinDays}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  patch({ notEngagedWithinDays: Number.isFinite(n) && n > 0 ? n : undefined })
                }}
                placeholder="never"
                className="pib-input"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
