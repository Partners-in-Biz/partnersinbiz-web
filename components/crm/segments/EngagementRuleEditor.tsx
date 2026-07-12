// components/crm/segments/EngagementRuleEditor.tsx
'use client'

import type { EngagementScoreRule } from '@/lib/crm/segments'

const FIELD_LABEL_CLS = 'text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant'
const INPUT_CLS =
  'h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs text-on-surface outline-none transition focus:border-[var(--color-accent-v2)]'

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className={FIELD_LABEL_CLS}>Engagement score</p>
          <p className="mt-1 text-[11px] leading-4 text-on-surface-variant">
            Score = opens × 5 + clicks × 15 − bounces × 30 − days-since-engaged × 0.5 (capped 0-100).
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-on-surface-variant">
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
        <div className="space-y-2 rounded-md border border-[var(--color-card-border)] bg-black/10 p-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <label className={`${FIELD_LABEL_CLS} flex justify-between`}>
                <span>Min score</span>
                <span className="text-primary">{min}</span>
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
              <label className={`${FIELD_LABEL_CLS} flex justify-between`}>
                <span>Max score</span>
                <span className="text-primary">{max}</span>
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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className={FIELD_LABEL_CLS}>
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
                className={INPUT_CLS}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className={FIELD_LABEL_CLS}>
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
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
