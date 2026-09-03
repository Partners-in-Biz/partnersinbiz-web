'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatZar, intervalLabel, intervalSuffix } from '@/lib/billing/format'
import {
  DEFAULT_PLAN_LIMITS,
  KNOWN_FEATURE_FLAGS,
  PLAN_INTERVALS,
  isUnlimited,
  type BillingInterval,
  type Plan,
  type PlanLimits,
} from '@/lib/plans/types'

const LIMIT_KEYS = Object.keys(DEFAULT_PLAN_LIMITS)

const LIMIT_LABELS: Record<string, string> = {
  seats: 'Team seats',
  organizations: 'Client organisations',
  socialPostsPerMonth: 'Social posts / month',
  aiGenerationsPerMonth: 'AI generations / month',
  emailsPerMonth: 'Emails / month',
  storageMb: 'Storage (MB)',
  seoSprints: 'Active SEO sprints',
}

function limitLabel(key: string): string {
  return LIMIT_LABELS[key] ?? key
}

function limitDisplay(value: number | undefined): string {
  if (value === undefined || value === null) return '-'
  if (isUnlimited(value)) return 'Unlimited'
  return value.toLocaleString()
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

interface FormState {
  key: string
  name: string
  description: string
  priceZar: string
  interval: BillingInterval
  sortOrder: string
  trialDays: string
  active: boolean
  featureFlags: Record<string, boolean>
  limits: Record<string, string>
}

function emptyForm(): FormState {
  const limits: Record<string, string> = {}
  for (const k of LIMIT_KEYS) limits[k] = String(DEFAULT_PLAN_LIMITS[k])
  const featureFlags: Record<string, boolean> = {}
  for (const f of KNOWN_FEATURE_FLAGS) featureFlags[f.key] = false
  return {
    key: '',
    name: '',
    description: '',
    priceZar: '0',
    interval: 'monthly',
    sortOrder: '0',
    trialDays: '',
    active: true,
    featureFlags,
    limits,
  }
}

function formFromPlan(plan: Plan): FormState {
  const limits: Record<string, string> = {}
  for (const k of LIMIT_KEYS) {
    const v = (plan.limits as PlanLimits | undefined)?.[k]
    limits[k] = v === undefined ? String(DEFAULT_PLAN_LIMITS[k]) : String(v)
  }
  const featureFlags: Record<string, boolean> = {}
  for (const f of KNOWN_FEATURE_FLAGS) featureFlags[f.key] = Boolean(plan.featureFlags?.[f.key])
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description ?? '',
    priceZar: String(plan.priceZar ?? 0),
    interval: plan.interval,
    sortOrder: String(plan.sortOrder ?? 0),
    trialDays: plan.trialDays ? String(plan.trialDays) : '',
    active: Boolean(plan.active),
    featureFlags,
    limits,
  }
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/plans')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load plans')
        setPlans([])
      } else {
        setPlans((body.data ?? []) as Plan[])
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load plans')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const activeCount = useMemo(() => plans.filter((p) => p.active && !p.archived).length, [plans])
  const archivedCount = useMemo(() => plans.filter((p) => p.archived).length, [plans])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setFormError(null)
    setShowEditor(true)
  }

  function openEdit(plan: Plan) {
    setEditingId(plan.id ?? null)
    setForm(formFromPlan(plan))
    setFormError(null)
    setShowEditor(true)
  }

  function closeEditor() {
    setShowEditor(false)
    setEditingId(null)
    setFormError(null)
  }

  function buildPayload() {
    const limits: Record<string, number> = {}
    for (const k of LIMIT_KEYS) {
      const n = Number(form.limits[k])
      limits[k] = Number.isFinite(n) ? n : DEFAULT_PLAN_LIMITS[k]
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim(),
      priceZar: Number(form.priceZar),
      interval: form.interval,
      sortOrder: Number(form.sortOrder),
      active: form.active,
      featureFlags: form.featureFlags,
      limits,
      trialDays: form.trialDays.trim() === '' ? 0 : Number(form.trialDays),
    }
    if (!editingId) payload.key = form.key.trim().toLowerCase()
    return payload
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setNotice(null)

    if (!editingId && !form.key.trim()) {
      setFormError('Plan key is required')
      return
    }
    if (!editingId && !/^[a-z0-9_-]+$/.test(form.key.trim().toLowerCase())) {
      setFormError('Key may only contain lowercase letters, numbers, hyphens and underscores')
      return
    }
    if (!form.name.trim()) {
      setFormError('Plan name is required')
      return
    }
    const price = Number(form.priceZar)
    if (!Number.isFinite(price) || price < 0) {
      setFormError('Price must be a non-negative number')
      return
    }

    setSaving(true)
    try {
      const url = editingId ? `/api/v1/admin/plans/${editingId}` : '/api/v1/admin/plans'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      const body = await res.json()
      if (!res.ok) {
        setFormError(body?.error ?? 'Failed to save plan')
        return
      }
      setNotice(editingId ? `Plan "${form.name.trim()}" updated.` : `Plan "${form.name.trim()}" created.`)
      closeEditor()
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save plan')
    } finally {
      setSaving(false)
    }
  }

  async function toggleArchive(plan: Plan) {
    if (!plan.id) return
    setBusyId(plan.id)
    setTopError(null)
    setNotice(null)
    try {
      if (plan.archived) {
        // Unarchive via PATCH (restore to active offering).
        const res = await fetch(`/api/v1/admin/plans/${plan.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: false, active: true }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'Failed to unarchive plan')
        setNotice(`Plan "${plan.name}" restored.`)
      } else {
        // Archive via DELETE (soft-archive: archived + inactive).
        const res = await fetch(`/api/v1/admin/plans/${plan.id}`, { method: 'DELETE' })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error ?? 'Failed to archive plan')
        setNotice(`Plan "${plan.name}" archived.`)
      }
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to update plan')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleActive(plan: Plan) {
    if (!plan.id || plan.archived) return
    setBusyId(plan.id)
    setTopError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !plan.active }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update plan')
      setNotice(`Plan "${plan.name}" is now ${plan.active ? 'inactive' : 'active'}.`)
      await load()
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to update plan')
    } finally {
      setBusyId(null)
    }
  }

  function setLimit(key: string, value: string) {
    setForm((prev) => ({ ...prev, limits: { ...prev.limits, [key]: value } }))
  }

  function setFlag(key: string, value: boolean) {
    setForm((prev) => ({ ...prev, featureFlags: { ...prev.featureFlags, [key]: value } }))
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Admin · Billing</p>
          <h1 className="pib-page-title mt-2">Subscription Plans</h1>
          <p className="pib-page-sub max-w-2xl">
            Plans drive FeatureGate capabilities and per-organisation limits. Billing is realised through
            EFT and PayPal invoices - there is no Stripe / card-on-file processor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          <button onClick={openCreate} className="st-btn st-btn--primary">
            + New plan
          </button>
          <Link href="/admin/settings" className="st-btn st-btn--ghost">
            Back to settings
          </Link>
        </div>
      </header>

      {topError && (
        <div className="st-panel px-4 py-3 text-sm text-[var(--color-error)]">
          {topError}
        </div>
      )}

      {notice && (
        <div className="st-panel px-4 py-3 text-sm text-[var(--st-success)]">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="pib-stat-card">
          <p className="sc-tiny">Total plans</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{plans.length}</p>
        </div>
        <div className="pib-stat-card">
          <p className="sc-tiny">Active &amp; offered</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{activeCount}</p>
        </div>
        <div className="pib-stat-card">
          <p className="sc-tiny">Archived</p>
          <p className="text-2xl font-headline font-medium text-[var(--color-pib-text)] mt-1">{archivedCount}</p>
        </div>
      </div>

      {showEditor && (
        <form onSubmit={handleSave} className="st-panel p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-headline font-medium text-[var(--color-pib-text)]">
              {editingId ? 'Edit plan' : 'New plan'}
            </h2>
            <button type="button" onClick={closeEditor} className="st-btn st-btn--ghost text-xs font-label">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="sc-tiny">
                Key {editingId && <span className="normal-case tracking-normal">(immutable)</span>}
              </span>
              <input
                type="text"
                value={form.key}
                onChange={(e) => setForm((p) => ({ ...p, key: e.target.value }))}
                placeholder="growth"
                className="st-input w-full mt-1 font-mono"
                disabled={!!editingId}
                required={!editingId}
              />
            </label>
            <label className="block">
              <span className="sc-tiny">Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Growth"
                className="st-input w-full mt-1"
                required
              />
            </label>
            <label className="block md:col-span-2">
              <span className="sc-tiny">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="For agencies scaling up their client roster."
                className="st-input w-full mt-1 min-h-[64px]"
                rows={2}
              />
            </label>
            <label className="block">
              <span className="sc-tiny">Price (ZAR, Rands)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.priceZar}
                onChange={(e) => setForm((p) => ({ ...p, priceZar: e.target.value }))}
                className="st-input w-full mt-1"
                required
              />
            </label>
            <label className="block">
              <span className="sc-tiny">Interval</span>
              <select
                value={form.interval}
                onChange={(e) => setForm((p) => ({ ...p, interval: e.target.value as BillingInterval }))}
                className="st-input w-full mt-1"
              >
                {PLAN_INTERVALS.map((iv) => (
                  <option key={iv} value={iv}>
                    {intervalLabel(iv)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sc-tiny">Sort order</span>
              <input
                type="number"
                step="1"
                value={form.sortOrder}
                onChange={(e) => setForm((p) => ({ ...p, sortOrder: e.target.value }))}
                className="st-input w-full mt-1"
              />
            </label>
            <label className="block">
              <span className="sc-tiny">
                Trial days (blank = none)
              </span>
              <input
                type="number"
                min={0}
                step="1"
                value={form.trialDays}
                onChange={(e) => setForm((p) => ({ ...p, trialDays: e.target.value }))}
                placeholder="0"
                className="st-input w-full mt-1"
              />
            </label>
            <label className="flex items-center gap-2 md:col-span-2 mt-1">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
                className="h-4 w-4"
              />
              <span className="text-sm text-[var(--color-pib-text)]">Active (offered on the pricing page)</span>
            </label>
          </div>

          <div>
            <p className="sc-tiny mb-2">
              Feature flags (FeatureGate)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {KNOWN_FEATURE_FLAGS.map((flag) => (
                <label
                  key={flag.key}
                  className="flex items-center gap-2 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={!!form.featureFlags[flag.key]}
                    onChange={(e) => setFlag(flag.key, e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-[var(--color-pib-text)]">{flag.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="sc-tiny mb-2">
              Usage limits (use -1 for unlimited)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {LIMIT_KEYS.map((key) => (
                <label key={key} className="block">
                  <span className="text-[11px] text-[var(--color-pib-text-muted)]">{limitLabel(key)}</span>
                  <input
                    type="number"
                    step="1"
                    min={-1}
                    value={form.limits[key]}
                    onChange={(e) => setLimit(key, e.target.value)}
                    className="st-input w-full mt-1"
                  />
                </label>
              ))}
            </div>
          </div>

          {formError && <p className="text-xs text-[var(--color-error)]">{formError}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeEditor} className="st-btn st-btn--ghost text-sm font-label">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="st-btn st-btn--primary text-sm font-label">
              {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create plan'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-28 rounded-[6px]" />
          <Skeleton className="h-28 rounded-[6px]" />
          <Skeleton className="h-28 rounded-[6px]" />
        </div>
      ) : plans.length === 0 ? (
        <div className="st-panel p-8 text-center">
          <p className="text-sm text-[var(--color-pib-text-muted)]">No plans yet.</p>
          <p className="text-xs text-[var(--color-pib-text-faint)] mt-1">
            Create your first plan to start gating features and limits for client organisations.
          </p>
          <button onClick={openCreate} className="st-btn st-btn--primary text-sm font-label mt-4">
            + New plan
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {plans.map((plan) => {
            const busy = busyId === plan.id
            const flagCount = Object.values(plan.featureFlags ?? {}).filter(Boolean).length
            return (
              <li
                key={plan.id}
                className={`st-panel p-4 ${plan.archived ? 'opacity-60' : ''}`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-medium text-[var(--color-pib-text)]">{plan.name}</p>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)]">
                        {plan.key}
                      </span>
                      {plan.archived ? (
                        <span className="st-status">
                          Archived
                        </span>
                      ) : plan.active ? (
                        <span className="st-status st-status st-status--info">
                          Active
                        </span>
                      ) : (
                        <span className="st-status st-status st-status--warning">
                          Inactive
                        </span>
                      )}
                    </div>
                    {plan.description && (
                      <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 max-w-2xl">{plan.description}</p>
                    )}
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-xl font-headline font-medium text-[var(--color-pib-text)]">
                        {formatZar(plan.priceZar)}
                      </span>
                      <span className="text-xs text-[var(--color-pib-text-muted)]">
                        {intervalSuffix(plan.interval) || `· ${intervalLabel(plan.interval)}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
                    <button
                      onClick={() => openEdit(plan)}
                      disabled={busy}
                      className="st-btn st-btn--secondary text-xs font-label"
                    >
                      Edit
                    </button>
                    {!plan.archived && (
                      <button
                        onClick={() => toggleActive(plan)}
                        disabled={busy}
                        className="st-btn st-btn--ghost text-xs font-label"
                      >
                        {busy ? 'Working...' : plan.active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                    <button
                      onClick={() => toggleArchive(plan)}
                      disabled={busy}
                      className="st-btn st-btn--ghost text-xs font-label"
                    >
                      {busy ? 'Working...' : plan.archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--color-pib-text-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-label uppercase tracking-wide text-[10px]">Features</span>
                    <span className="text-[var(--color-pib-text)]">{flagCount}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="font-label uppercase tracking-wide text-[10px]">Seats</span>
                    <span className="text-[var(--color-pib-text)]">{limitDisplay(plan.limits?.seats)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="font-label uppercase tracking-wide text-[10px]">Orgs</span>
                    <span className="text-[var(--color-pib-text)]">{limitDisplay(plan.limits?.organizations)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="font-label uppercase tracking-wide text-[10px]">Social / mo</span>
                    <span className="text-[var(--color-pib-text)]">{limitDisplay(plan.limits?.socialPostsPerMonth)}</span>
                  </span>
                  {plan.trialDays ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="font-label uppercase tracking-wide text-[10px]">Trial</span>
                      <span className="text-[var(--color-pib-text)]">{plan.trialDays}d</span>
                    </span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
