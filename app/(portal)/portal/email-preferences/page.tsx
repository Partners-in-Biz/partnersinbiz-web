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
import { Icon, Skeleton, Panel, Button, Status } from '@/components/studio'
import { PageHeader } from '@/components/ui/AppFoundation'
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
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeader
          eyebrow="Email"
          title="Email preferences."
          description="Pick an organisation from the topbar to manage its email preferences."
        />
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
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Email"
        title="Email preferences."
        description={`Viewing: ${orgName || selectedOrgId}.`}
      />

      {savedFlash && <Status tone="success">{savedFlash}</Status>}

      {loading && <Skeleton height={96} />}

      {/* Section 1 — Org preferences config */}
      {cfg && (
        <Panel className="space-y-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span aria-hidden="true">
                <Icon name="tune" />
              </span>
              <h2 className="text-base">Preferences page</h2>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => updateCfg({ enabled: e.target.checked })}
               aria-label="Toggle"/>
              Master toggle (enforce preferences)
            </label>
          </header>

          <div className="grid grid-cols-1 gap-3">
            <label className="pib-label">
              Heading
              <input
                type="text"
                className="pib-input mt-1 block w-full"
                value={cfg.preferencesPageHeading}
                onChange={(e) => updateCfg({ preferencesPageHeading: e.target.value })}
               aria-label="Input"/>
            </label>
            <label className="pib-label">
              Subheading
              <textarea
                rows={2}
                className="pib-textarea mt-1 block w-full"
                value={cfg.preferencesPageSubheading}
                onChange={(e) => updateCfg({ preferencesPageSubheading: e.target.value })}
               aria-label="Input"/>
            </label>
            <label className="pib-label">
              Default frequency for new contacts
              <select
                className="pib-select mt-1 block w-full"
                value={cfg.defaultFrequency}
                onChange={(e) => updateCfg({ defaultFrequency: e.target.value as FrequencyChoice })}
               aria-label="Input">
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
              <h3 className="text-sm">Topics</h3>
              <button onClick={addTopic} className="st-btn st-btn--ghost st-btn--sm">
                + Add topic
              </button>
            </div>
            <ul className="space-y-2">
              {cfg.topics.map((t, idx) => (
                <li
                  key={`${t.id}-${idx}`}
                  className="grid grid-cols-1 items-center gap-2 rounded-[6px] border border-[var(--color-pib-line)] p-2 sm:grid-cols-[120px_1fr_1fr_80px_36px]"
                >
                  <input
                    type="text"
                    value={t.id}
                    placeholder="id"
                    aria-label={`Topic ${idx + 1} id`}
                    onChange={(e) => updateTopic(idx, { id: e.target.value })}
                    className="pib-input font-mono text-xs"
                  />
                  <input
                    type="text"
                    value={t.label}
                    placeholder="Label"
                    aria-label={`Topic ${idx + 1} label`}
                    onChange={(e) => updateTopic(idx, { label: e.target.value })}
                    className="pib-input"
                  />
                  <input
                    type="text"
                    value={t.description}
                    placeholder="Description" aria-label={`Topic ${idx + 1} description`}
                    onChange={(e) => updateTopic(idx, { description: e.target.value })}
                    className="pib-input"
                  />
                  <label className="flex items-center gap-1 text-[11px] text-[var(--color-pib-text-muted)]">
                    <input
                      type="checkbox"
                      checked={t.defaultOptIn}
                      onChange={(e) => updateTopic(idx, { defaultOptIn: e.target.checked })}
                     aria-label="Toggle"/>
                    opt-in
                  </label>
                  <button
                    onClick={() => removeTopic(idx)}
                    className="text-xs text-[var(--color-error)] transition-opacity hover:opacity-80"
                    title="Remove topic"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end">
            <button onClick={saveCfg} disabled={savingCfg} className="st-btn st-btn--primary st-btn--sm">
              {savingCfg ? 'Saving…' : 'Save preferences config'}
            </button>
          </div>
        </Panel>
      )}

      {/* Section 2 — Frequency cap */}
      {cap && (
        <Panel className="space-y-4">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span aria-hidden="true">
                <Icon name="speed" />
              </span>
              <h2 className="text-base">Frequency cap</h2>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
              <input
                type="checkbox"
                checked={cap.enabled}
                onChange={(e) => setCap({ ...cap, enabled: e.target.checked })}
               aria-label="Toggle"/>
              Enabled
            </label>
          </header>

          <div className="grid grid-cols-2 gap-4">
            <label className="pib-label">
              Max per 24 hours: <span className="font-medium text-[var(--color-pib-text)]">{cap.maxPer24Hours}</span>
              <input
                type="range"
                min={0}
                max={20}
                value={cap.maxPer24Hours}
                onChange={(e) => setCap({ ...cap, maxPer24Hours: Number(e.target.value) })}
                className="mt-2 block w-full"
               aria-label="Value"/>
            </label>
            <label className="pib-label">
              Max per 7 days: <span className="font-medium text-[var(--color-pib-text)]">{cap.maxPer7Days}</span>
              <input
                type="range"
                min={0}
                max={50}
                value={cap.maxPer7Days}
                onChange={(e) => setCap({ ...cap, maxPer7Days: Number(e.target.value) })}
                className="mt-2 block w-full"
               aria-label="Value"/>
            </label>
          </div>

          <div>
            <span className="pib-label mb-2 block">Exempt topics</span>
            <div className="flex flex-wrap gap-2">
              {(cfg?.topics ?? []).map((t) => {
                const checked = cap.exemptTopics.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className={`cursor-pointer ${checked ? 'pib-pill pib-pill-accent' : 'pib-pill'}`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      data-impeccable-disable="content-invisible-at-rest"
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
            <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
              Exempt topics never get capped, and never count towards the cap.
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={saveCap} disabled={savingCap} className="st-btn st-btn--primary st-btn--sm">
              {savingCap ? 'Saving…' : 'Save frequency cap'}
            </button>
          </div>
        </Panel>
      )}

      {/* Section 3 — Recent unsubscribes */}
      <Panel>
        <div className="mb-3 flex items-center gap-3">
          <Icon name="unsubscribe" />
          <h2 className="st-title text-base">Recent opt-outs</h2>
        </div>
        {unsubs.length === 0 ? (
          <p className="sc-body text-sm text-[var(--sc-ink-soft)]">No recent opt-outs.</p>
        ) : (
          <ul className="divide-y divide-[var(--sc-line)]">
            {unsubs.map((u) => (
              <li
                key={u.contactId}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span>{u.email || u.contactId}</span>
                  <span className="text-[11px] text-[var(--sc-ink-soft)]">
                    via {u.updatedFrom} · freq={u.frequency}
                    {u.unsubscribeAllAt ? ' · all' : ''}
                  </span>
                </div>
                <code className="font-mono text-[11px] text-[var(--sc-ink-soft)]">
                  {u.contactId.slice(0, 12)}…
                </code>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
