// @deprecated-replace: supersedes TargetingEditorBasic — use this for all Phase 4+ ad-set targeting
'use client'
import { useState, useEffect } from 'react'
import type { AdTargeting, AdCustomAudience, AdSavedAudience } from '@/lib/ads/types'

interface Props {
  orgId: string
  value: AdTargeting
  onChange: (next: AdTargeting) => void
}

const POPULAR_COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'IE', name: 'Ireland' },
  { code: 'NZ', name: 'New Zealand' },
]

export function TargetingEditor({ orgId, value, onChange }: Props) {
  const [savedAudiences, setSavedAudiences] = useState<AdSavedAudience[]>([])
  const [customAudiences, setCustomAudiences] = useState<AdCustomAudience[]>([])
  const [caPickerOpen, setCaPickerOpen] = useState(false)
  const [savedSelectorOpen, setSavedSelectorOpen] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Fetch SAs + READY CAs on mount
  useEffect(() => {
    fetch('/api/v1/ads/saved-audiences', { headers: { 'X-Org-Id': orgId } })
      .then((r) => r.json())
      .then((body) => {
        if (body.success) setSavedAudiences(body.data as AdSavedAudience[])
      })
      .catch(() => {})

    fetch('/api/v1/ads/custom-audiences?status=READY', { headers: { 'X-Org-Id': orgId } })
      .then((r) => r.json())
      .then((body) => {
        if (body.success) setCustomAudiences(body.data as AdCustomAudience[])
      })
      .catch(() => {})
  }, [orgId])

  const countries = value.geo.countries ?? []
  const includeIds = value.customAudiences?.include ?? []
  const excludeIds = value.customAudiences?.exclude ?? []

  function toggleCountry(code: string) {
    const next = countries.includes(code)
      ? countries.filter((c) => c !== code)
      : [...countries, code]
    onChange({ ...value, geo: { ...value.geo, countries: next } })
  }

  function setAge(field: 'ageMin' | 'ageMax', n: number) {
    onChange({ ...value, demographics: { ...value.demographics, [field]: n } })
  }

  function toggleGender(g: 'male' | 'female') {
    const cur = value.demographics.genders ?? []
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]
    onChange({
      ...value,
      demographics: { ...value.demographics, genders: next.length ? next : undefined },
    })
  }

  function applySavedAudience(saId: string) {
    const sa = savedAudiences.find((s) => s.id === saId)
    if (sa) {
      onChange(sa.targeting)
      setSavedSelectorOpen(false)
    }
  }

  function setIncludeExclude(include: string[], exclude: string[]) {
    onChange({
      ...value,
      customAudiences: { include, exclude },
    })
    setCaPickerOpen(false)
  }

  async function saveAsSavedAudience() {
    if (!saveName.trim()) return
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const res = await fetch('/api/v1/ads/saved-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          input: {
            name: saveName.trim(),
            targeting: value,
          },
        }),
      })
      const body = await res.json()
      if (body.success) {
        const newSa = body.data as AdSavedAudience
        setSavedAudiences((prev) => [newSa, ...prev])
        setSaveModalOpen(false)
        setSaveMessage(`Saved targeting template ${newSa.name}.`)
        setSaveName('')
      } else {
        setSaveError(body.error ?? 'Save failed')
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Saved Audience selector */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="text-sm text-[#F5A623] underline"
          onClick={() => setSavedSelectorOpen((o) => !o)}
        >
          {savedSelectorOpen ? 'Hide saved audiences' : `Apply saved audience (${savedAudiences.length})`}
        </button>
        <button
          type="button"
          className="text-xs text-white/60 underline"
          onClick={() => {
            setSaveMessage(null)
            setSaveError(null)
            setSaveModalOpen(true)
          }}
        >
          Save current as template
        </button>
      </div>
      {saveMessage && (
        <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {saveMessage}
        </div>
      )}
      {savedSelectorOpen && (
        <div className="rounded border border-white/10 p-3">
          {savedAudiences.length === 0 ? (
            <p className="text-xs text-white/40">No saved audiences yet.</p>
          ) : (
            <ul className="space-y-1">
              {savedAudiences.map((sa) => (
                <li key={sa.id}>
                  <button
                    type="button"
                    className="w-full text-left rounded px-2 py-1.5 text-sm hover:bg-white/5"
                    onClick={() => applySavedAudience(sa.id)}
                  >
                    <span className="font-medium">{sa.name}</span>
                    {sa.description && <span className="ml-2 text-xs text-white/40">{sa.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Countries */}
      <fieldset>
        <legend className="text-sm font-medium">Countries</legend>
        <div className="mt-2 grid grid-cols-2 gap-1">
          {POPULAR_COUNTRIES.map((c) => (
            <label
              key={c.code}
              className="flex items-center gap-2 rounded border border-white/5 px-3 py-1.5 text-sm hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={countries.includes(c.code)}
                onChange={() => toggleCountry(c.code)}
                aria-label={c.name}
              />
              <span>{c.name}</span>
              <span className="ml-auto text-xs text-white/30">{c.code}</span>
            </label>
          ))}
        </div>
        {countries.length === 0 && (
          <div className="mt-2 text-xs text-red-300">Pick at least one country.</div>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="font-medium">Min age</span>
          <input
            type="number"
            min={13}
            max={65}
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={value.demographics.ageMin}
            onChange={(e) => setAge('ageMin', Number(e.target.value))}
            aria-label="Minimum age"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Max age</span>
          <input
            type="number"
            min={13}
            max={65}
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={value.demographics.ageMax}
            onChange={(e) => setAge('ageMax', Number(e.target.value))}
            aria-label="Maximum age"
          />
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Gender</legend>
        <p className="text-xs text-white/40 mt-0.5">Leave both unchecked to target all genders.</p>
        <div className="mt-2 flex gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.demographics.genders?.includes('male') ?? false}
              onChange={() => toggleGender('male')}
            />
            Male
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.demographics.genders?.includes('female') ?? false}
              onChange={() => toggleGender('female')}
            />
            Female
          </label>
        </div>
      </fieldset>

      {/* Custom Audiences */}
      <fieldset>
        <legend className="text-sm font-medium">Custom audiences</legend>
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between rounded border border-white/10 px-3 py-2 text-sm">
            <div>
              <span className="text-emerald-300">Include {includeIds.length}</span>
              <span className="mx-2 text-white/30">·</span>
              <span className="text-red-300">Exclude {excludeIds.length}</span>
            </div>
            <button
              type="button"
              className="text-xs text-[#F5A623] underline"
              onClick={() => setCaPickerOpen(true)}
            >
              {includeIds.length + excludeIds.length === 0 ? 'Add audiences' : 'Edit'}
            </button>
          </div>
        </div>
      </fieldset>

      {/* CA Picker Modal */}
      {caPickerOpen && (
        <CAPickerModal
          customAudiences={customAudiences}
          initialInclude={includeIds}
          initialExclude={excludeIds}
          onApply={setIncludeExclude}
          onClose={() => setCaPickerOpen(false)}
        />
      )}

      {/* Save Modal */}
      {saveModalOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#0A0A0B] p-6">
            <h2 className="text-lg font-semibold">Save as template</h2>
            <p className="mt-1 text-xs text-white/60">Reuse this targeting on future ad sets.</p>
            <label className="mt-4 block text-sm">
              <span className="font-medium">Name</span>
              <input
                className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. US adults 25-54"
                autoFocus
                aria-label="Save name"
                disabled={saving}
              />
            </label>
            {saveError && (
              <div role="alert" className="mt-3 rounded border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {saveError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="btn-pib-ghost text-sm"
                onClick={() => {
                  setSaveError(null)
                  setSaveModalOpen(false)
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn-pib-accent text-sm"
                onClick={saveAsSavedAudience}
                disabled={!saveName.trim() || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface CAPickerModalProps {
  customAudiences: AdCustomAudience[]
  initialInclude: string[]
  initialExclude: string[]
  onApply: (include: string[], exclude: string[]) => void
  onClose: () => void
}

function CAPickerModal({ customAudiences, initialInclude, initialExclude, onApply, onClose }: CAPickerModalProps) {
  const [include, setInclude] = useState<string[]>(initialInclude)
  const [exclude, setExclude] = useState<string[]>(initialExclude)

  function toggle(list: 'include' | 'exclude', id: string) {
    if (list === 'include') {
      setInclude((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      setExclude((prev) => prev.filter((x) => x !== id))
    } else {
      setExclude((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      setInclude((prev) => prev.filter((x) => x !== id))
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg border border-white/10 bg-[#0A0A0B] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Custom audiences</h2>
          <button className="text-sm text-white/40 underline" onClick={onClose}>Cancel</button>
        </div>
        <p className="mt-1 text-xs text-white/60">
          Click to add to Include or Exclude. Same audience can&apos;t appear in both.
        </p>
        <div className="mt-4 max-h-96 overflow-y-auto">
          {customAudiences.length === 0 ? (
            <p className="text-sm text-white/40">No READY custom audiences. Create one under Audiences.</p>
          ) : (
            <ul className="space-y-1">
              {customAudiences.map((ca) => {
                const isInclude = include.includes(ca.id)
                const isExclude = exclude.includes(ca.id)
                return (
                  <li key={ca.id} className="flex items-center justify-between rounded border border-white/5 px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{ca.name}</div>
                      <div className="text-xs text-white/40">
                        {ca.type.toLowerCase().replace('_', ' ')} · {ca.approximateSize ?? '?'}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${
                          isInclude ? 'bg-emerald-500/20 text-emerald-300' : 'border border-white/10 text-white/60'
                        }`}
                        onClick={() => toggle('include', ca.id)}
                      >
                        Include
                      </button>
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${
                          isExclude ? 'bg-red-500/20 text-red-300' : 'border border-white/10 text-white/60'
                        }`}
                        onClick={() => toggle('exclude', ca.id)}
                      >
                        Exclude
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-white/10 pt-4">
          <button className="btn-pib-ghost text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-pib-accent text-sm" onClick={() => onApply(include, exclude)}>
            Apply ({include.length + exclude.length})
          </button>
        </div>
      </div>
    </div>
  )
}
