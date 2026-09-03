'use client'

// components/admin/sequences/BranchEditor.tsx
//
// Per-step branch rule builder. When a step has a branch, the cron evaluates
// each rule in order after the step sends; first match wins. -1 = exit.

import type { SequenceBranch, BranchCondition } from '@/lib/sequences/types'
import ConditionPicker from './ConditionPicker'

interface Props {
  branch: SequenceBranch | undefined
  totalSteps: number
  currentStepIndex: number
  onChange: (b: SequenceBranch | undefined) => void
}

const DEFAULT_BRANCH: SequenceBranch = {
  rules: [],
  defaultNextStepNumber: -1,
}

function stepOptions(totalSteps: number) {
  const opts: Array<{ value: number; label: string }> = []
  for (let i = 0; i < totalSteps; i++) opts.push({ value: i, label: `Step ${i + 1}` })
  opts.push({ value: -1, label: 'Exit sequence' })
  return opts
}

export default function BranchEditor({
  branch,
  totalSteps,
  currentStepIndex,
  onChange,
}: Props) {
  const enabled = !!branch
  const eff = branch ?? DEFAULT_BRANCH
  const opts = stepOptions(totalSteps)

  function toggle() {
    if (enabled) onChange(undefined)
    else onChange({ ...DEFAULT_BRANCH })
  }

  function updateRule(idx: number, patch: Partial<SequenceBranch['rules'][number]>) {
    onChange({
      ...eff,
      rules: eff.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    })
  }

  function addRule() {
    const newRule = {
      condition: { kind: 'opened' } as BranchCondition,
      nextStepNumber: Math.min(currentStepIndex + 1, totalSteps - 1),
      evaluateAfterDays: 1,
    }
    onChange({ ...eff, rules: [...eff.rules, newRule] })
  }

  function removeRule(idx: number) {
    onChange({ ...eff, rules: eff.rules.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-pib-text-muted)]">
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Branch after this step
      </label>
      {enabled && (
        <div className="space-y-3 p-3 rounded-lg bg-[var(--color-pib-surface-soft)] border border-[var(--color-pib-line)]">
          {eff.rules.map((rule, i) => (
            <div key={i} className="p-2 rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-pib-text)]">Rule {i + 1}</span>
                <button
                  onClick={() => removeRule(i)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
              <ConditionPicker
                mode="branch"
                value={rule.condition}
                onChange={(c) => updateRule(i, { condition: c as BranchCondition })}
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-[var(--color-pib-text-muted)]">
                  Next step
                  <select
                    value={rule.nextStepNumber}
                    onChange={(e) =>
                      updateRule(i, { nextStepNumber: parseInt(e.target.value) })
                    }
                    className="mt-1 w-full pib-input"
                  >
                    {opts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-[var(--color-pib-text-muted)]">
                  Eval after (days)
                  <input
                    type="number"
                    min={0}
                    value={rule.evaluateAfterDays}
                    onChange={(e) =>
                      updateRule(i, {
                        evaluateAfterDays: Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    className="mt-1 w-full pib-input"
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            onClick={addRule}
            className="w-full py-2 rounded-lg border border-dashed border-[var(--color-pib-line)] text-xs text-[var(--color-pib-text-muted)]"
          >
            + Add rule
          </button>
          <label className="text-xs text-[var(--color-pib-text-muted)] block">
            Default next (if no rule matches)
            <select
              value={eff.defaultNextStepNumber}
              onChange={(e) =>
                onChange({ ...eff, defaultNextStepNumber: parseInt(e.target.value) })
              }
              className="mt-1 w-full pib-input"
            >
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
