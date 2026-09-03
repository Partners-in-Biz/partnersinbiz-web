'use client'

// components/admin/sequences/ConditionPicker.tsx
//
// UI for picking a BranchCondition (also used for WaitCondition where the
// option set differs  -  see `mode`). Renders a kind selector plus the field
// inputs appropriate for that kind.

import type { BranchCondition, WaitCondition } from '@/lib/sequences/types'

type Condition = BranchCondition | WaitCondition

interface Props {
  mode: 'branch' | 'wait' | 'goal'
  value: Condition
  onChange: (v: Condition) => void
}

const BRANCH_KINDS: Array<{ value: BranchCondition['kind']; label: string }> = [
  { value: 'opened', label: 'Opened this step' },
  { value: 'not-opened', label: "Didn't open this step" },
  { value: 'clicked', label: 'Clicked anything' },
  { value: 'not-clicked', label: "Didn't click anything" },
  { value: 'clicked-link', label: 'Clicked specific link' },
  { value: 'contact-has-tag', label: 'Contact has tag' },
  { value: 'contact-at-stage', label: 'Contact at stage' },
  { value: 'replied', label: 'Contact replied' },
  { value: 'days-since-step', label: 'Days elapsed since this step' },
]

const WAIT_KINDS: Array<{ value: WaitCondition['kind']; label: string }> = [
  { value: 'business-hours', label: 'Business hours' },
  { value: 'day-of-week', label: 'Day of week' },
  { value: 'contact-tag-added', label: 'Contact gets a tag' },
  { value: 'contact-stage-reached', label: 'Contact reaches a stage' },
  { value: 'goal-hit', label: 'A goal is hit' },
]

export default function ConditionPicker({ mode, value, onChange }: Props) {
  const kinds = mode === 'wait' ? WAIT_KINDS : BRANCH_KINDS

  function setKind(kind: string) {
    // Default values per kind.
    let next: Condition = value
    switch (kind) {
      case 'opened':
      case 'not-opened':
      case 'clicked':
      case 'not-clicked':
      case 'replied':
        next = { kind } as BranchCondition
        break
      case 'clicked-link':
        next = { kind: 'clicked-link', urlSubstring: '' }
        break
      case 'contact-has-tag':
        next = { kind: 'contact-has-tag', tag: '' }
        break
      case 'contact-at-stage':
        next = { kind: 'contact-at-stage', stage: 'new' }
        break
      case 'days-since-step':
        next = { kind: 'days-since-step', days: 7 }
        break
      case 'business-hours':
        next = { kind: 'business-hours', startHourLocal: 9, endHourLocal: 17 }
        break
      case 'day-of-week':
        next = { kind: 'day-of-week', daysOfWeek: [1, 2, 3, 4, 5] }
        break
      case 'contact-tag-added':
        next = { kind: 'contact-tag-added', tag: '' }
        break
      case 'contact-stage-reached':
        next = { kind: 'contact-stage-reached', stage: 'won' }
        break
      case 'goal-hit':
        next = { kind: 'goal-hit', goalId: '' }
        break
    }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <select aria-label="Kind"
        value={value.kind}
        onChange={(e) => setKind(e.target.value)}
        className="w-full pib-input"
      >
        {kinds.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>

      {value.kind === 'clicked-link' && (
        <input aria-label="URL contains (e.g. /pricing)"
          type="text"
          value={value.urlSubstring}
          onChange={(e) => onChange({ ...value, urlSubstring: e.target.value })}
          placeholder="URL contains (e.g. /pricing)"
          className="w-full pib-input"
        />
      )}
      {(value.kind === 'contact-has-tag' || value.kind === 'contact-tag-added') && (
        <input aria-label="Tag (e.g. demo-booked)"
          type="text"
          value={value.tag}
          onChange={(e) => onChange({ ...value, tag: e.target.value })}
          placeholder="Tag (e.g. demo-booked)"
          className="w-full pib-input"
        />
      )}
      {(value.kind === 'contact-at-stage' || value.kind === 'contact-stage-reached') && (
        <select aria-label="Tag (e.g. demo-booked)"
          value={value.stage}
          onChange={(e) => onChange({ ...value, stage: e.target.value })}
          className="w-full pib-input"
        >
          {['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      {value.kind === 'days-since-step' && (
        <input aria-label="Days"
          type="number"
          min={0}
          value={value.days}
          onChange={(e) => onChange({ ...value, days: parseInt(e.target.value) || 0 })}
          className="w-full pib-input"
        />
      )}
      {value.kind === 'business-hours' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--color-pib-text-muted)]">
            Start hour
            <input
              type="number"
              min={0}
              max={23}
              value={value.startHourLocal}
              onChange={(e) =>
                onChange({ ...value, startHourLocal: parseInt(e.target.value) || 0 })
              }
              className="mt-1 w-full pib-input"
            />
          </label>
          <label className="text-xs text-[var(--color-pib-text-muted)]">
            End hour
            <input
              type="number"
              min={0}
              max={23}
              value={value.endHourLocal}
              onChange={(e) =>
                onChange({ ...value, endHourLocal: parseInt(e.target.value) || 0 })
              }
              className="mt-1 w-full pib-input"
            />
          </label>
        </div>
      )}
      {value.kind === 'day-of-week' && (
        <div className="flex flex-wrap gap-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, idx) => {
            const active = value.daysOfWeek.includes(idx)
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  const set = new Set(value.daysOfWeek)
                  if (set.has(idx)) set.delete(idx)
                  else set.add(idx)
                  onChange({ ...value, daysOfWeek: [...set].sort((a, b) => a - b) })
                }}
                className={`px-2 py-1 rounded text-xs ${
                  active
                    ? 'bg-primary text-on-primary'
                    : 'bg-[var(--color-pib-surface-soft)] text-[var(--color-pib-text-muted)]'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
      {value.kind === 'goal-hit' && (
        <input aria-label="Goal id"
          type="text"
          value={value.goalId}
          onChange={(e) => onChange({ ...value, goalId: e.target.value })}
          placeholder="Goal id"
          className="w-full pib-input"
        />
      )}
    </div>
  )
}
