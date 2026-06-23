'use client'

import { useEffect, useState } from 'react'

type CategoryPref = { inApp: boolean; email: boolean }
type Category = 'email' | 'crm' | 'social' | 'reports' | 'billing'
type Preferences = Record<Category, CategoryPref>

const CATEGORY_META: { key: Category; label: string; description: string; icon: string }[] = [
  { key: 'email', label: 'Email outreach', description: 'Sequence replies, sends, and bounce alerts.', icon: 'mail' },
  { key: 'crm', label: 'CRM', description: 'Lead, deal, and follow-up activity.', icon: 'contacts' },
  { key: 'social', label: 'Social', description: 'Scheduled posts, approvals, and engagement.', icon: 'share' },
  { key: 'reports', label: 'Reports', description: 'Scheduled reports and digest summaries.', icon: 'bar_chart' },
  { key: 'billing', label: 'Billing', description: 'Invoices, payments, and subscription events.', icon: 'receipt_long' },
]

const DEFAULTS: Preferences = {
  email: { inApp: true, email: true },
  crm: { inApp: true, email: true },
  social: { inApp: true, email: true },
  reports: { inApp: true, email: true },
  billing: { inApp: true, email: true },
}

const ENDPOINT = '/api/v1/account/notification-preferences'

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(ENDPOINT)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to load preferences')
        return body
      })
      .then((body) => {
        if (!alive) return
        const incoming = body?.data?.preferences ?? body?.preferences
        if (incoming) setPrefs({ ...DEFAULTS, ...incoming })
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load preferences')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  async function persist(next: Preferences) {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to save preferences')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  function toggle(cat: Category, channel: keyof CategoryPref) {
    // Optimistic update.
    const next: Preferences = {
      ...prefs,
      [cat]: { ...prefs[cat], [channel]: !prefs[cat][channel] },
    }
    setPrefs(next)
    void persist(next)
  }

  return (
    <section data-testid="notification-preferences" className="pib-card-section">
      <div className="pib-card-section-header flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Per-category preferences</p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Choose what reaches you</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Toggle in-app and email delivery for each notification category. Changes save automatically.
          </p>
        </div>
        <span className="shrink-0" aria-live="polite">
          {saving ? (
            <span className="pib-pill">Saving…</span>
          ) : saved ? (
            <span className="pib-pill pib-pill-success">Saved</span>
          ) : null}
        </span>
      </div>

      {error && <p className="px-5 pt-3 text-xs text-red-400" role="alert">{error}</p>}

      <div className="p-5">
        <div className="overflow-hidden rounded-xl border border-[var(--color-pib-line)]">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            <span>Category</span>
            <span className="w-16 text-center">In-app</span>
            <span className="w-16 text-center">Email</span>
          </div>
          {CATEGORY_META.map((cat) => (
            <div
              key={cat.key}
              data-testid={`notif-pref-row-${cat.key}`}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--color-pib-line)] px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-pib-text-muted)]" aria-hidden="true">
                  {cat.icon}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-pib-text)]">{cat.label}</p>
                  <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">{cat.description}</p>
                </div>
              </div>
              <div className="flex w-16 justify-center">
                <Toggle
                  checked={prefs[cat.key].inApp}
                  disabled={loading}
                  label={`In-app notifications for ${cat.label}`}
                  onChange={() => toggle(cat.key, 'inApp')}
                />
              </div>
              <div className="flex w-16 justify-center">
                <Toggle
                  checked={prefs[cat.key].email}
                  disabled={loading}
                  label={`Email notifications for ${cat.label}`}
                  onChange={() => toggle(cat.key, 'email')}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
        checked
          ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]'
          : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
