// app/(admin)/admin/email-preferences/page.tsx
//
// Admin page for managing per-org email preferences:
//   1) Preferences-page config: heading/subhead, topics, default frequency,
//      master toggle.
//   2) Frequency cap: max emails per 24h/7d, exempt topics.
//   3) Recent unsubscribes / opt-out activity from the last ~50 contacts.

'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'
import type {
  FrequencyChoice,
  OrgPreferencesConfig,
  SubscriptionTopic,
} from '@/lib/preferences/types'
import { FREQUENCY_CHOICES } from '@/lib/preferences/types'
import type { FrequencyCapConfig } from '@/lib/email/frequency'

interface UnsubRow {
  contactId: string
  orgId: string
  email?: string
  frequency: FrequencyChoice
  unsubscribeAllAt: { _seconds?: number; seconds?: number } | null
  updatedAt: { _seconds?: number; seconds?: number } | null
  updatedFrom: string
}

export default function EmailPreferencesAdminPage() {
  const { selectedOrgId, orgName } = useOrg()
  const [cfg, setCfg] = useState<OrgPreferencesConfig | null>(null)
  const [cap, setCap] = useState<FrequencyCapConfig | null>(null)
  const [unsubs, setUnsubs] = useState<UnsubRow[]>([])
  const [savingCfg, setSavingCfg] = useState(false)
  const [savingCap, setSavingCap] = useState(false)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedOrgId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/v1/orgs/${selectedOrgId}/preferences-config`).then((r) => r.json()),
      fetch(`/api/v1/orgs/${selectedOrgId}/frequency-cap`).then((r) => r.json()),
      fetch(`/api/v1/orgs/${selectedOrgId}/preferences-config/recent-unsubs`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .catch(() => ({ data: [] })),
    ])
      .then(([cfgRes, capRes, unsubRes]) => {
        if (cfgRes?.success) setCfg(cfgRes.data)
        if (capRes?.success) setCap(capRes.data)
        if (unsubRes?.data) setUnsubs(unsubRes.data)
      })
      .finally(() => setLoading(false))
  }, [selectedOrgId])

  if (!selectedOrgId) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-on-surface mb-2">Email preferences</h1>
        <p className="text-on-surface-variant text-sm">
          Pick an organisation from the topbar to manage its email preferences.
        </p>
      </div>
    )
  }

  function flash(msg: string) {
    setSavedFlash(msg)
    setTimeout(() => setSavedFlash(null), 2200)
  }

  async function saveCfg() {
    if (!cfg) return
    setSavingCfg(true)
    try {
      const res = await fetch(`/api/v1/orgs/${selectedOrgId}/preferences-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const body = await res.json()
      if (body?.success) {
        setCfg(body.data)
        flash('Saved preferences config')
      }
    } finally {
      setSavingCfg(false)
    }
  }

  async function saveCap() {
    if (!cap) return
    setSavingCap(true)
    try {
      const res = await fetch(`/api/v1/orgs/${selectedOrgId}/frequency-cap`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cap),
      })
      const body = await res.json()
      if (body?.success) {
        setCap(body.data)
        flash('Saved frequency cap')
      }
    } finally {
      setSavingCap(false)
    }
  }

  function updateCfg(p: Partial<OrgPreferencesConfig>) {
    setCfg((prev) => (prev ? { ...prev, ...p } : prev))
  }

  function updateTopic(idx: number, p: Partial<SubscriptionTopic>) {
    setCfg((prev) => {
      if (!prev) return prev
      const topics = [...prev.topics]
      topics[idx] = { ...topics[idx], ...p }
      return { ...prev, topics }
    })
  }

  function addTopic() {
    setCfg((prev) =>
      prev
        ? {
            ...prev,
            topics: [
              ...prev.topics,
              {
                id: `topic-${prev.topics.length + 1}`,
                label: 'New topic',
                description: '',
                defaultOptIn: true,
              },
            ],
          }
        : prev,
    )
  }

  function removeTopic(idx: number) {
    setCfg((prev) =>
      prev ? { ...prev, topics: prev.topics.filter((_, i) => i !== idx) } : prev,
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
          Email
        </p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Email preferences</h1>
        <p className="text-xs text-on-surface-variant mt-1">
          Viewing: <span className="font-medium text-on-surface">{orgName || selectedOrgId}</span>
        </p>
      </div>

      {savedFlash && (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm px-3 py-2">
          {savedFlash}
        </div>
      )}

      {loading && <p className="text-sm text-on-surface-variant">Loading…</p>}

      {/* Section 1 — Org preferences config */}
      {cfg && (
        <section className="pib-card space-y-4 p-4">
          <header className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-on-surface">Preferences page</h2>
            <label className="flex items-center gap-2 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => updateCfg({ enabled: e.target.checked })}
              />
              Master toggle (enforce preferences)
            </label>
          </header>

          <div className="grid grid-cols-1 gap-3">
            <label className="text-xs text-on-surface-variant">
              Heading
              <input
                type="text"
                className="mt-1 block w-full rounded-md bg-[var(--color-surface-container)] border border-white/10 px-3 py-2 text-sm text-on-surface"
                value={cfg.preferencesPageHeading}
                onChange={(e) => updateCfg({ preferencesPageHeading: e.target.value })}
              />
            </label>
            <label className="text-xs text-on-surface-variant">
              Subheading
              <textarea
                rows={2}
                className="mt-1 block w-full rounded-md bg-[var(--color-surface-container)] border border-white/10 px-3 py-2 text-sm text-on-surface"
                value={cfg.preferencesPageSubheading}
                onChange={(e) => updateCfg({ preferencesPageSubheading: e.target.value })}
              />
            </label>
            <label className="text-xs text-on-surface-variant">
              Default frequency for new contacts
              <select
                className="mt-1 block w-full rounded-md bg-[var(--color-surface-container)] border border-white/10 px-3 py-2 text-sm text-on-surface"
                value={cfg.defaultFrequency}
                onChange={(e) => updateCfg({ defaultFrequency: e.target.value as FrequencyChoice })}
              >
                {FREQUENCY_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-on-surface">Topics</h3>
              <button
                onClick={addTopic}
                className="text-xs px-2 py-1 rounded bg-[var(--color-surface-container)] hover:bg-white/5"
              >
                + Add topic
              </button>
            </div>
            <ul className="space-y-2">
              {cfg.topics.map((t, idx) => (
                <li
                  key={`${t.id}-${idx}`}
                  className="grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr_80px_36px] gap-2 items-center bg-[var(--color-surface-container)]/40 rounded-md p-2"
                >
                  <input
                    type="text"
                    value={t.id}
                    placeholder="id"
                    onChange={(e) => updateTopic(idx, { id: e.target.value })}
                    className="rounded bg-[var(--color-surface-container)] border border-white/10 px-2 py-1 text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={t.label}
                    placeholder="Label"
                    onChange={(e) => updateTopic(idx, { label: e.target.value })}
                    className="rounded bg-[var(--color-surface-container)] border border-white/10 px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    value={t.description}
                    placeholder="Description"
                    onChange={(e) => updateTopic(idx, { description: e.target.value })}
                    className="rounded bg-[var(--color-surface-container)] border border-white/10 px-2 py-1 text-sm"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={t.defaultOptIn}
                      onChange={(e) => updateTopic(idx, { defaultOptIn: e.target.checked })}
                    />
                    opt-in
                  </label>
                  <button
                    onClick={() => removeTopic(idx)}
                    className="text-xs text-red-400 hover:text-red-300"
                    title="Remove topic"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveCfg}
              disabled={savingCfg}
              className="text-sm px-4 py-2 rounded-md bg-amber-500 text-black font-medium hover:bg-amber-400 disabled:opacity-50"
            >
              {savingCfg ? 'Saving…' : 'Save preferences config'}
            </button>
          </div>
        </section>
      )}

      {/* Section 2 — Frequency cap */}
      {cap && (
        <section className="pib-card space-y-4 p-4">
          <header className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-on-surface">Frequency cap</h2>
            <label className="flex items-center gap-2 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                checked={cap.enabled}
                onChange={(e) => setCap({ ...cap, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </header>

          <div className="grid grid-cols-2 gap-4">
            <label className="text-xs text-on-surface-variant">
              Max per 24 hours: <span className="text-on-surface font-medium">{cap.maxPer24Hours}</span>
              <input
                type="range"
                min={0}
                max={20}
                value={cap.maxPer24Hours}
                onChange={(e) => setCap({ ...cap, maxPer24Hours: Number(e.target.value) })}
                className="mt-2 block w-full"
              />
            </label>
            <label className="text-xs text-on-surface-variant">
              Max per 7 days: <span className="text-on-surface font-medium">{cap.maxPer7Days}</span>
              <input
                type="range"
                min={0}
                max={50}
                value={cap.maxPer7Days}
                onChange={(e) => setCap({ ...cap, maxPer7Days: Number(e.target.value) })}
                className="mt-2 block w-full"
              />
            </label>
          </div>

          <div>
            <span className="text-xs text-on-surface-variant block mb-2">Exempt topics</span>
            <div className="flex flex-wrap gap-2">
              {(cfg?.topics ?? []).map((t) => {
                const checked = cap.exemptTopics.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className={`text-xs px-3 py-1 rounded-full border cursor-pointer ${
                      checked
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                        : 'bg-[var(--color-surface-container)] border-white/10 text-on-surface-variant'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(cap.exemptTopics)
                        if (e.target.checked) next.add(t.id)
                        else next.delete(t.id)
                        setCap({ ...cap, exemptTopics: [...next] })
                      }}
                    />
                    {t.label || t.id}
                  </label>
                )
              })}
            </div>
            <p className="text-[11px] text-on-surface-variant/60 mt-1">
              Exempt topics never get capped, and never count towards the cap.
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveCap}
              disabled={savingCap}
              className="text-sm px-4 py-2 rounded-md bg-amber-500 text-black font-medium hover:bg-amber-400 disabled:opacity-50"
            >
              {savingCap ? 'Saving…' : 'Save frequency cap'}
            </button>
          </div>
        </section>
      )}

      {/* Section 3 — Recent unsubscribes */}
      <section className="pib-card p-4">
        <h2 className="text-base font-semibold text-on-surface mb-3">Recent opt-outs</h2>
        {unsubs.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No recent opt-outs.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {unsubs.map((u) => (
              <li
                key={u.contactId}
                className="py-2 flex items-center justify-between text-sm gap-2"
              >
                <div className="flex flex-col">
                  <span className="text-on-surface">{u.email || u.contactId}</span>
                  <span className="text-[11px] text-on-surface-variant">
                    via {u.updatedFrom} · freq={u.frequency}
                    {u.unsubscribeAllAt ? ' · all' : ''}
                  </span>
                </div>
                <code className="text-[11px] font-mono text-on-surface-variant">
                  {u.contactId.slice(0, 12)}…
                </code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
