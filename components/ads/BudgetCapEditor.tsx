'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const PLATFORMS = ['meta', 'google', 'linkedin', 'tiktok'] as const
type Platform = (typeof PLATFORMS)[number]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'AUD'] as const
const PERIODS = ['daily', 'weekly', 'monthly'] as const
const SCOPES = ['org', 'platform', 'campaign'] as const

interface Props {
  orgId: string
  orgSlug?: string
  initial?: Partial<{
    name: string
    description: string
    scope: 'org' | 'platform' | 'campaign'
    platform: Platform
    campaignId: string
    capMajor: number
    currencyCode: string
    period: 'daily' | 'weekly' | 'monthly'
    alertThresholds: number[]
    autoPause: boolean
    autoResumeOnRollover: boolean
  }>
  /** When provided, edit mode submits PATCH; when omitted, create mode submits POST. */
  budgetId?: string
  onSaved?: (budget: unknown) => void
  onCancel?: () => void
}

function parseThresholds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0)
}

export function BudgetCapEditor({
  orgId,
  orgSlug,
  initial,
  budgetId,
  onSaved,
  onCancel,
}: Props) {
  const router = useRouter()

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [scope, setScope] = useState<'org' | 'platform' | 'campaign'>(initial?.scope ?? 'org')
  const [platform, setPlatform] = useState<Platform>(initial?.platform ?? 'meta')
  const [campaignId, setCampaignId] = useState(initial?.campaignId ?? '')
  const [capMajor, setCapMajor] = useState(String(initial?.capMajor ?? ''))
  const [currencyCode, setCurrencyCode] = useState(initial?.currencyCode ?? 'USD')
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>(initial?.period ?? 'daily')
  const [alertThresholds, setAlertThresholds] = useState(
    initial?.alertThresholds?.join(', ') ?? '75, 90, 100',
  )
  const [autoPause, setAutoPause] = useState(initial?.autoPause ?? false)
  const [autoResumeOnRollover, setAutoResumeOnRollover] = useState(
    initial?.autoResumeOnRollover ?? false,
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validate
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    const capNum = parseFloat(capMajor)
    if (isNaN(capNum) || capNum <= 0) {
      setError('Cap must be a positive number.')
      return
    }
    if (scope === 'platform' && !platform) {
      setError('Platform is required for platform-scoped budgets.')
      return
    }
    if (scope === 'campaign' && !campaignId.trim()) {
      setError('Campaign ID is required for campaign-scoped budgets.')
      return
    }

    const capCents = Math.round(capNum * 100)
    const thresholds = parseThresholds(alertThresholds)

    const input: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      capCents,
      currencyCode,
      period,
      alertThresholds: thresholds,
      autoPause,
      autoResumeOnRollover: autoPause ? autoResumeOnRollover : false,
    }

    if (!budgetId) {
      // create mode: include scope fields
      input.scope = scope
      if (scope === 'platform' || scope === 'campaign') input.platform = platform
      if (scope === 'campaign') input.campaignId = campaignId.trim()
    }

    setSubmitting(true)
    try {
      const url = budgetId
        ? `/api/v1/ads/budgets/${budgetId}`
        : '/api/v1/ads/budgets'
      const method = budgetId ? 'PATCH' : 'POST'
      const body = budgetId ? input : { input }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': orgId,
        },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Request failed')
      }
      const saved = json.data
      if (onSaved) {
        onSaved(saved)
      } else if (orgSlug && saved?.id) {
        router.push(`/admin/org/${orgSlug}/ads/budgets/${saved.id}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  const showPlatform = scope === 'platform' || scope === 'campaign'
  const showCampaignId = scope === 'campaign'

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Budget form">
      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Name */}
      <label className="block text-sm">
        <span className="font-medium">Name *</span>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Monthly org cap"
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          aria-label="Budget name"
        />
      </label>

      {/* Description */}
      <label className="block text-sm">
        <span className="font-medium">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          aria-label="Budget description"
        />
      </label>

      {/* Scope — only in create mode */}
      {!budgetId && (
        <fieldset>
          <legend className="text-sm font-medium">Scope *</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="budget-scope"
                  value={s}
                  checked={scope === s}
                  onChange={() => setScope(s)}
                />
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Platform */}
      {showPlatform && (
        <label className="block text-sm">
          <span className="font-medium">Platform *</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
            aria-label="Platform"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Campaign ID */}
      {showCampaignId && (
        <label className="block text-sm">
          <span className="font-medium">Campaign ID *</span>
          <input
            type="text"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            placeholder="cmp_..."
            className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
            aria-label="Campaign ID"
          />
          {orgSlug && (
            <span className="mt-1 block text-xs text-white/40">
              Find IDs at{' '}
              <a
                href={`/admin/org/${orgSlug}/ads/campaigns`}
                className="underline text-[#F5A623]"
                target="_blank"
                rel="noreferrer"
              >
                /ads/campaigns
              </a>
            </span>
          )}
        </label>
      )}

      {/* Cap */}
      <label className="block text-sm">
        <span className="font-medium">Cap ({currencyCode}) *</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          value={capMajor}
          onChange={(e) => setCapMajor(e.target.value)}
          placeholder="e.g. 500.00"
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          aria-label="Budget cap"
        />
      </label>

      {/* Currency */}
      <label className="block text-sm">
        <span className="font-medium">Currency</span>
        <select
          value={currencyCode}
          onChange={(e) => setCurrencyCode(e.target.value)}
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          aria-label="Currency"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {/* Period */}
      <fieldset>
        <legend className="text-sm font-medium">Period</legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {PERIODS.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input
                type="radio"
                name="budget-period"
                value={p}
                checked={period === p}
                onChange={() => setPeriod(p)}
              />
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Alert Thresholds */}
      <label className="block text-sm">
        <span className="font-medium">Alert thresholds (%)</span>
        <input
          type="text"
          value={alertThresholds}
          onChange={(e) => setAlertThresholds(e.target.value)}
          placeholder="75, 90, 100"
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          aria-label="Alert thresholds"
        />
        <span className="mt-1 block text-xs text-white/40">Comma-separated percentages</span>
      </label>

      {/* Auto-pause */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoPause}
          onChange={(e) => setAutoPause(e.target.checked)}
          aria-label="Auto-pause at 100%"
        />
        <span className="font-medium">Auto-pause campaigns at 100%</span>
      </label>

      {/* Auto-resume */}
      {autoPause && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoResumeOnRollover}
            onChange={(e) => setAutoResumeOnRollover(e.target.checked)}
            disabled={!autoPause}
            aria-label="Auto-resume on rollover"
          />
          <span className="font-medium">Auto-resume campaigns on period rollover</span>
        </label>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn-pib-accent text-sm disabled:opacity-50"
        >
          {submitting ? 'Saving…' : budgetId ? 'Save changes' : 'Create budget'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/10 px-4 py-2 text-sm text-white/60 hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
