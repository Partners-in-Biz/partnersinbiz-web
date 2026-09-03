// components/admin/governance/SettingsPlatformConfig.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSwitch } from '@/components/admin/governance/SettingsSwitch'

interface PlatformSettings {
  platformName: string
  senderName: string
  supportEmail: string
  marketingUrl: string
  appUrl: string
  maxUploadMb: number
  allowedFileTypes: string[]
  apiRateLimitPerMin: number
  maintenanceMode: boolean
  betaFeaturesEnabled: boolean
}

const EMPTY: PlatformSettings = {
  platformName: '', senderName: '', supportEmail: '', marketingUrl: '', appUrl: '',
  maxUploadMb: 25, allowedFileTypes: [], apiRateLimitPerMin: 120, maintenanceMode: false, betaFeaturesEnabled: false,
}

export function SettingsPlatformConfig({ canEdit }: { canEdit: boolean }) {
  const [form, setForm] = useState<PlatformSettings>(EMPTY)
  const [fileTypesText, setFileTypesText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/admin/settings')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Load failed')
      const data: PlatformSettings = body.data ?? body
      setForm({ ...EMPTY, ...data, allowedFileTypes: data.allowedFileTypes ?? [] })
      setFileTypesText((data.allowedFileTypes ?? []).join(', '))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load platform settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function set<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, allowedFileTypes: fileTypesText }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      const data: PlatformSettings = body.data ?? body
      setForm({ ...EMPTY, ...data, allowedFileTypes: data.allowedFileTypes ?? [] })
      setFileTypesText((data.allowedFileTypes ?? []).join(', '))
      setFeedback('Platform settings saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-pib-surface-soft)] px-3 py-2 text-sm text-[var(--color-pib-text)] disabled:opacity-60'

  return (
    <div className="pib-card space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Platform configuration</p>
        {!canEdit && <span className="text-[10px] text-[var(--color-pib-text-muted)]/60">Super-admin only</span>}
      </div>

      {feedback && <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">{feedback}</div>}
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading platform settings…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">Platform name</span>
              <input disabled={!canEdit} value={form.platformName} onChange={(e) => set('platformName', e.target.value)} className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">Sender name</span>
              <input disabled={!canEdit} value={form.senderName} onChange={(e) => set('senderName', e.target.value)} className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">Support email</span>
              <input disabled={!canEdit} value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">Marketing URL</span>
              <input disabled={!canEdit} value={form.marketingUrl} onChange={(e) => set('marketingUrl', e.target.value)} className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">App URL</span>
              <input disabled={!canEdit} value={form.appUrl} onChange={(e) => set('appUrl', e.target.value)} className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">Max upload (MB)</span>
              <input disabled={!canEdit} type="number" value={form.maxUploadMb} onChange={(e) => set('maxUploadMb', Number(e.target.value))} className={input} /></label>
            <label className="block md:col-span-2"><span className="text-xs text-[var(--color-pib-text-muted)]">Allowed file types (comma-separated)</span>
              <input disabled={!canEdit} value={fileTypesText} onChange={(e) => setFileTypesText(e.target.value)} placeholder="png, jpg, pdf, csv" className={input} /></label>
            <label className="block"><span className="text-xs text-[var(--color-pib-text-muted)]">API rate limit (per min)</span>
              <input disabled={!canEdit} type="number" value={form.apiRateLimitPerMin} onChange={(e) => set('apiRateLimitPerMin', Number(e.target.value))} className={input} /></label>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] px-3 py-2">
            <div>
              <p className="text-sm text-[var(--color-pib-text)]">Maintenance mode</p>
              <p className="text-[11px] text-[var(--color-pib-text-muted)]">Read-only mirror. Toggle on the maintenance page.</p>
            </div>
            <span className={`text-[10px] font-label uppercase tracking-widest px-2 py-1 rounded-md border ${form.maintenanceMode ? 'bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)] border-amber-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
              {form.maintenanceMode ? 'Active' : 'Off'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-pib-text)]">Beta features enabled</span>
            <SettingsSwitch checked={form.betaFeaturesEnabled} disabled={!canEdit} label="Beta features" onChange={() => set('betaFeaturesEnabled', !form.betaFeaturesEnabled)} />
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button type="button" onClick={save} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ background: 'var(--color-accent-v2)' }}>
                {saving ? 'Saving…' : 'Save platform settings'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
