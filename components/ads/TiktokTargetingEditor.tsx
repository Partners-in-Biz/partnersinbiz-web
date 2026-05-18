'use client'
// components/ads/TiktokTargetingEditor.tsx
// Phase 2 baseline targeting editor for TikTok campaigns.
// - Locations: comma-separated TikTok location IDs (numeric)
// - Age groups: multi-select checkboxes (6 groups)
// - Gender: radio (UNLIMITED | MALE | FEMALE)
// - Languages: comma-separated codes
// - Advanced JSON textarea for full tkTargeting facet IDs
// Sub-3c Phase 2 Batch 3B.

import { useState } from 'react'
import type { AdTargeting } from '@/lib/ads/types'
import type { TiktokTargeting } from '@/lib/ads/providers/tiktok/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TiktokTargetingValue {
  canonical: AdTargeting
  tkTargeting?: TiktokTargeting
}

type TiktokGender = 'GENDER_UNLIMITED' | 'GENDER_MALE' | 'GENDER_FEMALE'
type TiktokAgeGroup =
  | 'AGE_13_17'
  | 'AGE_18_24'
  | 'AGE_25_34'
  | 'AGE_35_44'
  | 'AGE_45_54'
  | 'AGE_55_100'

interface Props {
  value: TiktokTargetingValue
  onChange: (v: TiktokTargetingValue) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGE_GROUPS: { value: TiktokAgeGroup; label: string }[] = [
  { value: 'AGE_13_17', label: '13–17' },
  { value: 'AGE_18_24', label: '18–24' },
  { value: 'AGE_25_34', label: '25–34' },
  { value: 'AGE_35_44', label: '35–44' },
  { value: 'AGE_45_54', label: '45–54' },
  { value: 'AGE_55_100', label: '55+' },
]

const GENDER_OPTIONS: { value: TiktokGender; label: string }[] = [
  { value: 'GENDER_UNLIMITED', label: 'All genders' },
  { value: 'GENDER_MALE', label: 'Male' },
  { value: 'GENDER_FEMALE', label: 'Female' },
]

const inputCls =
  'mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:border-[#F5A623]/60'
const labelCls = 'block text-sm font-medium'

// ─── Component ────────────────────────────────────────────────────────────────

export function TiktokTargetingEditor({ value, onChange }: Props) {
  const currentTk = value.tkTargeting ?? {}

  const [locationsRaw, setLocationsRaw] = useState(
    (currentTk.location_ids ?? []).join(', ')
  )
  const [languagesRaw, setLanguagesRaw] = useState(
    (currentTk.languages ?? []).join(', ')
  )
  const [advancedJson, setAdvancedJson] = useState(
    Object.keys(currentTk).length > 0
      ? JSON.stringify(currentTk, null, 2)
      : ''
  )
  const [jsonError, setJsonError] = useState<string | null>(null)

  const selectedGender: TiktokGender = currentTk.gender ?? 'GENDER_UNLIMITED'
  const selectedAgeGroups: TiktokAgeGroup[] = (currentTk.age_groups as TiktokAgeGroup[]) ?? []

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function mergeAndFire(patch: Partial<TiktokTargeting>) {
    const merged: TiktokTargeting = { ...currentTk, ...patch }
    // Rebuild canonical best-effort
    const canonical: AdTargeting = {
      ...value.canonical,
      demographics: {
        ageMin:
          merged.age_groups?.includes('AGE_13_17')
            ? 13
            : merged.age_groups?.includes('AGE_18_24')
              ? 18
              : value.canonical?.demographics?.ageMin ?? 18,
        ageMax:
          merged.age_groups?.includes('AGE_55_100')
            ? 65
            : value.canonical?.demographics?.ageMax ?? 65,
        genders:
          merged.gender === 'GENDER_MALE'
            ? ['male']
            : merged.gender === 'GENDER_FEMALE'
              ? ['female']
              : undefined,
      },
    }
    onChange({ canonical, tkTargeting: merged })
  }

  function handleLocationsChange(raw: string) {
    setLocationsRaw(raw)
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n))
    mergeAndFire({ location_ids: ids.length ? ids : undefined })
  }

  function handleLanguagesChange(raw: string) {
    setLanguagesRaw(raw)
    const langs = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    mergeAndFire({ languages: langs.length ? langs : undefined })
  }

  function handleGenderChange(g: TiktokGender) {
    mergeAndFire({ gender: g })
  }

  function handleAgeGroupToggle(group: TiktokAgeGroup) {
    const next = selectedAgeGroups.includes(group)
      ? selectedAgeGroups.filter((g) => g !== group)
      : [...selectedAgeGroups, group]
    mergeAndFire({ age_groups: next.length ? (next as TiktokTargeting['age_groups']) : undefined })
  }

  function handleAdvancedJsonBlur() {
    if (!advancedJson.trim()) {
      setJsonError(null)
      return
    }
    try {
      const parsed = JSON.parse(advancedJson) as TiktokTargeting
      setJsonError(null)
      const merged: TiktokTargeting = { ...currentTk, ...parsed }
      onChange({ ...value, tkTargeting: merged })
    } catch {
      setJsonError('Invalid JSON — please check the pasted targeting object.')
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Locations */}
      <div>
        <label className={labelCls}>
          Locations (TikTok location IDs)
          <input
            className={inputCls}
            value={locationsRaw}
            onChange={(e) => handleLocationsChange(e.target.value)}
            placeholder="6252001, 6255149"
            aria-label="Locations"
          />
        </label>
        <p className="mt-1 text-xs text-white/40">
          Paste numeric TikTok location IDs separated by commas. Find IDs via TikTok Ads
          Manager → Audience → Locations.
        </p>
      </div>

      {/* Age groups */}
      <fieldset>
        <legend className={labelCls}>Age groups</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {AGE_GROUPS.map((ag) => (
            <label
              key={ag.value}
              className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                selectedAgeGroups.includes(ag.value)
                  ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                  : 'border-white/10 text-white/60 hover:bg-white/5'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedAgeGroups.includes(ag.value)}
                onChange={() => handleAgeGroupToggle(ag.value)}
                aria-label={ag.value}
              />
              {ag.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-white/40">
          Leave all unchecked to target all ages.
        </p>
      </fieldset>

      {/* Gender */}
      <fieldset>
        <legend className={labelCls}>Gender</legend>
        <div className="mt-2 flex gap-3">
          {GENDER_OPTIONS.map((g) => (
            <label
              key={g.value}
              className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                selectedGender === g.value
                  ? 'border-[#F5A623] bg-[#F5A623]/5 text-[#F5A623]'
                  : 'border-white/10 text-white/60 hover:bg-white/5'
              }`}
            >
              <input
                type="radio"
                name="tiktok-gender"
                checked={selectedGender === g.value}
                onChange={() => handleGenderChange(g.value)}
                aria-label={g.value}
              />
              {g.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Languages */}
      <div>
        <label className={labelCls}>
          Languages
          <input
            className={inputCls}
            value={languagesRaw}
            onChange={(e) => handleLanguagesChange(e.target.value)}
            placeholder="en, es, fr"
            aria-label="Languages"
          />
        </label>
        <p className="mt-1 text-xs text-white/40">
          ISO language codes separated by commas. Leave blank to target all languages.
        </p>
      </div>

      {/* Advanced JSON */}
      <div>
        <span className={labelCls}>Advanced targeting JSON (optional)</span>
        <textarea
          className={`${inputCls} min-h-[120px] font-mono`}
          value={advancedJson}
          onChange={(e) => setAdvancedJson(e.target.value)}
          onBlur={handleAdvancedJsonBlur}
          placeholder={`{\n  "interest_category_ids": [123456],\n  "behavior_ids": [789]\n}`}
          aria-label="Advanced TikTok targeting JSON"
        />
        {jsonError && (
          <p className="mt-1 text-xs text-red-400">{jsonError}</p>
        )}
        <p className="mt-1 text-xs text-white/40">
          Full facet picker UI arrives in Phase 3 — for now paste TikTok facet IDs from
          TikTok Ads Manager (interest_category_ids, behavior_ids, included_audiences, etc.).
        </p>
      </div>
    </div>
  )
}
