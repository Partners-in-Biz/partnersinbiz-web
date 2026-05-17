'use client'
// components/ads/LinkedinTargetingEditor.tsx
// Phase 2 baseline targeting editor for LinkedIn campaigns.
// - Geo: comma-separated ISO country codes → canonical AdTargeting.geo.countries
// - LI-specific: raw JSON textarea for LinkedinTargetingCriteria (facets arrive in Phase 3)

import { useState } from 'react'
import type { AdTargeting } from '@/lib/ads/types'
import type { LinkedinTargetingCriteria } from '@/lib/ads/providers/linkedin/types'

export interface LinkedinTargetingValue {
  canonical: AdTargeting
  liTargetingCriteria?: LinkedinTargetingCriteria
}

interface Props {
  value: LinkedinTargetingValue
  onChange: (v: LinkedinTargetingValue) => void
}

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

export function LinkedinTargetingEditor({ value, onChange }: Props) {
  // Country chips — derive initial display from value
  const [countriesRaw, setCountriesRaw] = useState(
    (value.canonical?.geo?.countries ?? ['US']).join(', ')
  )
  const [liJson, setLiJson] = useState(
    value.liTargetingCriteria ? JSON.stringify(value.liTargetingCriteria, null, 2) : ''
  )
  const [jsonError, setJsonError] = useState<string | null>(null)

  function handleCountriesChange(raw: string) {
    setCountriesRaw(raw)
    const countries = raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
    onChange({
      ...value,
      canonical: {
        ...value.canonical,
        geo: { ...value.canonical?.geo, countries },
      },
    })
  }

  function handleJsonBlur() {
    if (!liJson.trim()) {
      setJsonError(null)
      onChange({ ...value, liTargetingCriteria: undefined })
      return
    }
    try {
      const parsed = JSON.parse(liJson) as LinkedinTargetingCriteria
      setJsonError(null)
      onChange({ ...value, liTargetingCriteria: parsed })
    } catch {
      setJsonError('Invalid JSON — please check the pasted targeting criteria.')
    }
  }

  const countries = (value.canonical?.geo?.countries ?? ['US'])

  return (
    <div className="space-y-5">
      {/* Geo locations */}
      <div>
        <label className={labelCls}>
          Locations (ISO country codes)
          <input
            className={inputCls}
            value={countriesRaw}
            onChange={(e) => handleCountriesChange(e.target.value)}
            placeholder="US, GB, DE"
            aria-label="Locations"
          />
        </label>
        {/* Country chips */}
        {countries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {countries.map((c) => (
              <span
                key={c}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-white/70"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        <p className="mt-1 text-xs text-white/40">
          Separate multiple countries with commas (e.g. US, GB, DE).
        </p>
      </div>

      {/* LinkedIn-specific JSON */}
      <div>
        <span className={labelCls}>LinkedIn-specific targeting (advanced)</span>
        <textarea
          className={`${inputCls} min-h-[120px] font-mono`}
          value={liJson}
          onChange={(e) => setLiJson(e.target.value)}
          onBlur={handleJsonBlur}
          placeholder={`{\n  "include": {\n    "and": [{ "or": { "urn:li:adTargetingFacet:companies": ["urn:li:organization:1234"] } }]\n  }\n}`}
          aria-label="LinkedIn targeting criteria JSON"
        />
        {jsonError && (
          <p className="mt-1 text-xs text-red-400">{jsonError}</p>
        )}
        <p className="mt-1 text-xs text-white/40">
          Paste LinkedIn targeting JSON here for facets such as companies, industries, job
          functions, and seniority. Full facet UI builders arrive in Phase 3. Leave blank to
          use geo-only targeting.
        </p>
      </div>
    </div>
  )
}
