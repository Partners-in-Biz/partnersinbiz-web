'use client'

import { useEffect, useState } from 'react'
import { Surface, StatusPill, DialogDrawer } from '@/components/ui/AppFoundation'
import { apiGet, apiSend } from './OrgDetailApi'

interface KnownFlag { key: string; label: string; description: string }
interface FlagsResponse {
  flags: Record<string, boolean>
  knownFlags: KnownFlag[]
  overrideCount: number
}

export function OrgFeatureFlagsPanel({ slug }: { slug: string }) {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const [known, setKnown] = useState<KnownFlag[]>([])
  const [overrideCount, setOverrideCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState('')
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGet<FlagsResponse>(`/api/v1/admin/org/${slug}/feature-flags`)
      .then((d) => {
        if (cancelled) return
        setFlags(d.flags || {})
        setKnown(d.knownFlags || [])
        setOverrideCount(d.overrideCount || 0)
        setLoading(false)
      })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [slug])

  async function persist(next: Record<string, boolean>) {
    setSaving(true)
    setError('')
    try {
      const res = await apiSend<{ flags: Record<string, boolean>; overrideCount: number }>(
        `/api/v1/admin/org/${slug}/feature-flags`, 'PUT', { flags: next },
      )
      setFlags(res.flags)
      setOverrideCount(res.overrideCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save flags')
    } finally {
      setSaving(false)
    }
  }

  function toggle(key: string) {
    persist({ ...flags, [key]: !(flags[key] === true) })
  }

  function addCustom() {
    const key = newKey.trim()
    if (!key) return
    setNewKey('')
    persist({ ...flags, [key]: true })
  }

  function confirmRemove() {
    if (!removeTarget) return
    const next = { ...flags }
    delete next[removeTarget]
    setRemoveTarget(null)
    persist(next)
  }

  if (loading) return <Surface className="text-on-surface-variant text-sm">Loading feature flags…</Surface>

  const knownKeys = new Set(known.map((k) => k.key))
  const customKeys = Object.keys(flags).filter((k) => !knownKeys.has(k))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">
          Per-org feature overrides. Defaults are off; an enabled flag is an override.
        </p>
        <StatusPill tone={overrideCount > 0 ? 'accent' : 'neutral'}>
          {overrideCount} override{overrideCount === 1 ? '' : 's'}
        </StatusPill>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Surface header={<span className="font-label">Known flags</span>}>
        <div className="divide-y divide-white/5">
          {known.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface">{f.label}</p>
                <p className="text-xs text-on-surface-variant">{f.description}</p>
                <code className="text-[10px] text-on-surface-variant">{f.key}</code>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flags[f.key] === true}
                disabled={saving}
                onClick={() => toggle(f.key)}
                className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50"
                style={{ background: flags[f.key] === true ? 'var(--color-pib-accent)' : 'rgba(255,255,255,0.15)' }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                  style={{ left: flags[f.key] === true ? '22px' : '2px' }}
                />
              </button>
            </div>
          ))}
        </div>
      </Surface>

      {customKeys.length > 0 && (
        <Surface header={<span className="font-label">Custom flags</span>}>
          <div className="divide-y divide-white/5">
            {customKeys.map((key) => (
              <div key={key} className="flex items-center justify-between gap-4 py-3">
                <code className="text-sm text-on-surface">{key}</code>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={flags[key] === true}
                    disabled={saving}
                    onClick={() => toggle(key)}
                    className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50"
                    style={{ background: flags[key] === true ? 'var(--color-pib-accent)' : 'rgba(255,255,255,0.15)' }}
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                      style={{ left: flags[key] === true ? '22px' : '2px' }}
                    />
                  </button>
                  <button
                    type="button"
                    className="pib-btn-ghost text-xs"
                    onClick={() => setRemoveTarget(key)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      <Surface header={<span className="font-label">Add custom flag</span>}>
        <div className="flex gap-2">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="featureKeyName"
            className="pib-input flex-1"
          />
          <button type="button" className="pib-btn-secondary" disabled={!newKey.trim() || saving} onClick={addCustom}>
            Add flag
          </button>
        </div>
      </Surface>

      <DialogDrawer
        open={removeTarget !== null}
        title="Remove flag override?"
        description={`This deletes the "${removeTarget}" override. The flag reverts to its default (off).`}
        onClose={() => setRemoveTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => setRemoveTarget(null)}>Cancel</button>
            <button type="button" className="pib-btn-primary" onClick={confirmRemove}>Remove override</button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-variant">
          Removing a flag override cannot be undone from here — you would need to re-add the key. Continue?
        </p>
      </DialogDrawer>
    </div>
  )
}
