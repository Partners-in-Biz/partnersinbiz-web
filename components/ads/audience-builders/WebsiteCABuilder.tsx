'use client'
import { useState } from 'react'
import type { AdCustomAudience, WebsiteCAUrlRule } from '@/lib/ads/types'

interface Props {
  orgId: string
  onComplete?: (ca: AdCustomAudience) => void
  onCancel?: () => void
}

const RETENTION_OPTIONS = [30, 60, 90, 180]

export function WebsiteCABuilder({ orgId, onComplete, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pixelId, setPixelId] = useState('')
  const [retentionDays, setRetentionDays] = useState(30)
  const [rules, setRules] = useState<WebsiteCAUrlRule[]>([{ op: 'url_contains', value: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateRule(idx: number, patch: Partial<WebsiteCAUrlRule>) {
    setRules((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function addRule() {
    setRules((rs) => [...rs, { op: 'url_contains', value: '' }])
  }
  function removeRule(idx: number) {
    setRules((rs) => rs.filter((_, i) => i !== idx))
  }

  function canSubmit(): boolean {
    return (
      name.trim() !== '' &&
      pixelId.trim() !== '' &&
      rules.length > 0 &&
      rules.every((r) => r.value.trim() !== '')
    )
  }

  async function submit() {
    if (!canSubmit()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/ads/custom-audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
        body: JSON.stringify({
          input: {
            type: 'WEBSITE',
            name,
            description,
            status: 'BUILDING',
            source: {
              kind: 'WEBSITE',
              pixelId,
              retentionDays,
              rules,
            },
          },
        }),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
      onComplete?.(body.data as AdCustomAudience)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block text-sm">
        <span className="font-medium">Audience name</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Audience name"
          disabled={submitting}
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Description (optional)</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          aria-label="Description"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Meta Pixel ID</span>
        <input
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
          placeholder="123456789012345"
          disabled={submitting}
          aria-label="Pixel ID"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Retention</span>
        <select
          className="mt-1 w-full rounded border border-white/10 bg-white/5 px-3 py-2 text-sm"
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
          disabled={submitting}
          aria-label="Retention"
        >
          {RETENTION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="text-sm font-medium">URL rules</legend>
        <p className="mt-0.5 text-xs text-white/40">
          Visitor matches if URL satisfies any of these rules within {retentionDays} days.
        </p>
        <div className="mt-2 space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm"
                value={r.op}
                onChange={(e) => updateRule(i, { op: e.target.value as WebsiteCAUrlRule['op'] })}
                aria-label={`Rule ${i + 1} op`}
                disabled={submitting}
              >
                <option value="url_contains">URL contains</option>
                <option value="url_equals">URL equals</option>
                <option value="url_not_contains">URL does not contain</option>
              </select>
              <input
                className="flex-1 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-sm"
                value={r.value}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                placeholder="/pricing"
                aria-label={`Rule ${i + 1} value`}
                disabled={submitting}
              />
              {rules.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-white/40 underline"
                  onClick={() => removeRule(i)}
                  disabled={submitting}
                  aria-label={`Remove rule ${i + 1}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-[var(--sc-accent)] underline"
            onClick={addRule}
            disabled={submitting}
          >
            + Add rule
          </button>
        </div>
      </fieldset>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            className="btn-pib-ghost text-sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={submit}
          disabled={!canSubmit() || submitting}
        >
          {submitting ? 'Creating…' : 'Create audience'}
        </button>
      </div>
    </div>
  )
}
