'use client'

// components/admin/sequences/GoalsEditor.tsx
//
// Sequence-level journey goals. A goal may complete the journey successfully
// or exit it early, and is evaluated before every step.

import type { SequenceGoal, BranchCondition } from '@/lib/sequences/types'
import ConditionPicker from './ConditionPicker'

interface Props {
  goals: SequenceGoal[] | undefined
  onChange: (g: SequenceGoal[]) => void
}

function makeId() {
  return 'goal-' + Math.random().toString(36).slice(2, 10)
}

export default function GoalsEditor({ goals, onChange }: Props) {
  const list = goals ?? []

  function addGoal() {
    onChange([
      ...list,
      {
        id: makeId(),
        label: 'New goal',
        condition: { kind: 'replied' },
        exitReason: '',
        outcome: 'complete',
      },
    ])
  }

  function updateGoal(idx: number, patch: Partial<SequenceGoal>) {
    onChange(list.map((g, i) => (i === idx ? { ...g, ...patch } : g)))
  }

  function removeGoal(idx: number) {
    onChange(list.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      {list.length === 0 && (
        <div className="text-xs text-[var(--color-pib-text-muted)] italic">
          No journey goals. Add one to complete or exit a journey when a contact
          converts, replies, books a demo, etc.
        </div>
      )}
      {list.map((goal, i) => (
        <div
          key={goal.id}
          className="p-3 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <input
              value={goal.label}
              onChange={(e) => updateGoal(i, { label: e.target.value })}
              placeholder="Goal label"
              className="flex-1 px-2 py-1 rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] text-sm font-medium"
            />
            <button
              onClick={() => removeGoal(i)}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
          <ConditionPicker
            mode="goal"
            value={goal.condition}
            onChange={(c) => updateGoal(i, { condition: c as BranchCondition })}
          />
          <input
            value={goal.exitReason ?? ''}
            onChange={(e) => updateGoal(i, { exitReason: e.target.value })}
            placeholder="Exit reason label (e.g. converted)"
            className="w-full px-2 py-1 rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] text-xs"
          />
          <label className="block text-xs text-[var(--color-pib-text-muted)]">
            Goal outcome
            <select
              value={goal.outcome ?? 'exit'}
              onChange={(e) => updateGoal(i, { outcome: e.target.value as 'complete' | 'exit' })}
              className="mt-1 w-full rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-xs text-[var(--color-pib-text)]"
            >
              <option value="complete">Complete journey successfully</option>
              <option value="exit">Exit journey early</option>
            </select>
          </label>
        </div>
      ))}
      <button
        onClick={addGoal}
        className="w-full py-2 rounded-lg border border-dashed border-[var(--color-pib-line)] text-sm text-[var(--color-pib-text-muted)]"
      >
        + Add journey goal
      </button>
    </div>
  )
}
