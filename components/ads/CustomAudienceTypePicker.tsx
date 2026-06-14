'use client'
import type { AdCustomAudienceType } from '@/lib/ads/types'

interface Props {
  onSelect: (type: AdCustomAudienceType) => void
  /** Optional: pre-disable types if certain dependencies missing (e.g. no Pixel for WEBSITE). */
  disabledTypes?: AdCustomAudienceType[]
  disabledReason?: Partial<Record<AdCustomAudienceType, string>>
}

interface TypeMeta {
  type: AdCustomAudienceType
  label: string
  description: string
  icon: string  // emoji or symbol for now — Phase 4b can swap to proper icons
}

const TYPES: TypeMeta[] = [
  {
    type: 'CUSTOMER_LIST',
    label: 'Customer list',
    description: 'Upload a CSV of email addresses or phone numbers. PiB hashes in the admin browser; raw PII is not stored in PiB.',
    icon: '📋',
  },
  {
    type: 'WEBSITE',
    label: 'Website visitors',
    description: 'Target people who visited specific client URLs within a retention window. Requires the Meta Pixel.',
    icon: '🌐',
  },
  {
    type: 'LOOKALIKE',
    label: 'Lookalike audience',
    description: 'Find people similar to an existing audience. 1% match is most similar, up to 10% for broader reach.',
    icon: '👥',
  },
  {
    type: 'APP',
    label: 'App users',
    description: 'Target users who triggered specific events in a PiB Property (analytics event).',
    icon: '📱',
  },
  {
    type: 'ENGAGEMENT',
    label: 'Engagement',
    description: 'Reach people who engaged with the client Facebook Page, videos, lead forms, or events.',
    icon: '💬',
  },
]

export function CustomAudienceTypePicker({ onSelect, disabledTypes = [], disabledReason = {} }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {TYPES.map(({ type, label, description, icon }) => {
        const disabled = disabledTypes.includes(type)
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(type)}
            className={`text-left rounded-lg border p-4 transition ${
              disabled
                ? 'border-white/5 bg-white/[0.02] cursor-not-allowed opacity-50'
                : 'border-white/10 hover:border-[#F5A623] hover:bg-white/5'
            }`}
            aria-label={label}
          >
            <div className="text-2xl">{icon}</div>
            <h3 className="mt-2 font-medium">{label}</h3>
            <p className="mt-1 text-xs text-white/60">{description}</p>
            {disabled && disabledReason[type] && (
              <p className="mt-2 text-xs text-red-300">{disabledReason[type]}</p>
            )}
          </button>
        )
      })}
    </div>
  )
}
