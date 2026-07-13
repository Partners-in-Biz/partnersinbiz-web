'use client'

// components/admin/sequences/WaitUntilEditor.tsx

import type { WaitUntil, WaitCondition } from '@/lib/sequences/types'
import ConditionPicker from './ConditionPicker'

interface Props {
  value: WaitUntil | undefined
  onChange: (v: WaitUntil | undefined) => void
}

const DEFAULT_WAIT: WaitUntil = {
  condition: { kind: 'business-hours', startHourLocal: 9, endHourLocal: 17 },
  maxWaitDays: 1,
  onTimeout: 'send',
}

export default function WaitUntilEditor({ value, onChange }: Props) {
  const enabled = !!value
  const eff = value ?? DEFAULT_WAIT

  function toggle() {
    if (enabled) onChange(undefined)
    else onChange({ ...DEFAULT_WAIT })
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-pib-text-muted)]">
        <input type="checkbox" checked={enabled} onChange={toggle} />
        Wait until condition before sending this step
      </label>
      {enabled && (
        <div className="space-y-3 p-3 rounded-lg bg-[var(--color-pib-surface-soft)] border border-[var(--color-pib-line)]">
          <ConditionPicker
            mode="wait"
            value={eff.condition}
            onChange={(c) => onChange({ ...eff, condition: c as WaitCondition })}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-[var(--color-pib-text-muted)]">
              Max wait (days)
              <input
                type="number"
                min={0}
                value={eff.maxWaitDays}
                onChange={(e) =>
                  onChange({
                    ...eff,
                    maxWaitDays: Math.max(0, parseInt(e.target.value) || 0),
                  })
                }
                className="mt-1 w-full pib-input"
              />
            </label>
            <label className="text-xs text-[var(--color-pib-text-muted)]">
              On timeout
              <select
                value={eff.onTimeout}
                onChange={(e) =>
                  onChange({ ...eff, onTimeout: e.target.value as 'send' | 'exit' })
                }
                className="mt-1 w-full pib-input"
              >
                <option value="send">Send anyway</option>
                <option value="exit">Exit sequence</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
