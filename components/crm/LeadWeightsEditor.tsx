'use client'

// components/crm/LeadWeightsEditor.tsx
// Controlled editor for LeadSignalsWeights - used on /portal/settings/scoring

import type { LeadSignalsWeights } from '@/lib/scoring/types'

interface WeightField {
  key: keyof LeadSignalsWeights
  label: string
  description: string
  defaultValue: number
}

const WEIGHT_FIELDS: WeightField[] = [
  { key: 'emailOpens',         label: 'Email opens',                   description: 'Points per open in last 30 days',              defaultValue: 2  },
  { key: 'emailClicks',        label: 'Email clicks',                  description: 'Points per link click in an email',             defaultValue: 5  },
  { key: 'emailReplies',       label: 'Email replies',                 description: 'Points per direct reply to an email',           defaultValue: 15 },
  { key: 'sequenceCompleted',  label: 'Sequence completed',            description: 'Points when a contact completes a sequence',    defaultValue: 10 },
  { key: 'recentContact',      label: 'Recent contact (within 7d)',    description: 'Points if last contacted within 7 days',        defaultValue: 10 },
  { key: 'formSubmission',     label: 'Form submission',               description: 'Points per form submitted by the contact',      defaultValue: 8  },
]

interface Props {
  value: LeadSignalsWeights
  onChange: (next: LeadSignalsWeights) => void
  disabled?: boolean
}

export function LeadWeightsEditor({ value, onChange, disabled }: Props) {
  function setWeight(key: keyof LeadSignalsWeights, raw: string) {
    const parsed = parseInt(raw, 10)
    const clamped = isNaN(parsed) ? 0 : Math.min(100, Math.max(0, parsed))
    onChange({ ...value, [key]: clamped })
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {WEIGHT_FIELDS.map(({ key, label, description, defaultValue }) => {
        const displayVal = value[key] ?? defaultValue
        return (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-xs font-medium">{label}</label>
            <p className="text-xs text-[var(--color-pib-text-muted)]">{description}</p>
            <input
              type="number"
              value={displayVal}
              min={0}
              max={100}
              step={1}
              disabled={disabled}
              aria-label={label}
              onChange={e => setWeight(key, e.target.value)}
              className="mt-0.5 h-8 w-24 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
            />
          </div>
        )
      })}
    </div>
  )
}
