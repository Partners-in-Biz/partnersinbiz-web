'use client'

// LeadCaptureSourceForm — create/edit UI for the v2 "lead capture" system
// (collection: lead_capture_sources, API: /api/v1/capture-sources).
//
// Closes:
//   US-057 — opt-in mode, success message, fields configurator, theme,
//            auto-apply tags.
//   US-091 — webhook URL + secret, plus a "Delivery log" panel showing the
//            last N webhook delivery attempts.
//
// Distinct from CaptureSourcesWorkspace.tsx, which drives the LEGACY
// (publicKey-based) /api/v1/crm/capture-sources system.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fmtTimestamp } from '@/lib/format/timestamp'

type CaptureFieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select'
type DoubleOptInMode = 'off' | 'on'
type CaptureSourceType =
  | 'newsletter'
  | 'lead-magnet'
  | 'contact-form'
  | 'embed-widget'
  | 'api'

interface CaptureField {
  key: string
  label: string
  type: CaptureFieldType
  required: boolean
  options?: string[]
  placeholder?: string
}

interface CaptureWidgetTheme {
  primaryColor: string
  textColor: string
  backgroundColor: string
  borderRadius: number
  buttonText: string
  headingText: string
  subheadingText: string
}

interface WebhookDeliveryAttempt {
  attempt: number
  ok: boolean
  statusCode: number | null
  error: string | null
  durationMs: number
  at: string
}

interface WebhookDelivery {
  id: string
  status: 'success' | 'failed'
  statusCode: number | null
  attemptCount: number
  lastError: string | null
  url: string
  attempts: WebhookDeliveryAttempt[]
  createdAt: unknown
}

interface CaptureSource {
  id: string
  orgId: string
  name: string
  type: CaptureSourceType
  doubleOptIn: DoubleOptInMode
  successMessage: string
  successRedirectUrl?: string
  fields: CaptureField[]
  tagsToApply: string[]
  widgetTheme: CaptureWidgetTheme
  active: boolean
  webhookUrl?: string
  webhookSecret?: string
  deliveries?: WebhookDelivery[]
}

const DEFAULT_THEME: CaptureWidgetTheme = {
  primaryColor: '#0f766e',
  textColor: '#111827',
  backgroundColor: '#ffffff',
  borderRadius: 12,
  buttonText: 'Subscribe',
  headingText: 'Join our newsletter',
  subheadingText: 'Get the latest updates straight to your inbox.',
}

const TYPE_OPTIONS: { value: CaptureSourceType; label: string }[] = [
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'lead-magnet', label: 'Lead magnet' },
  { value: 'contact-form', label: 'Contact form' },
  { value: 'embed-widget', label: 'Embed widget' },
  { value: 'api', label: 'API' },
]

const FIELD_TYPE_OPTIONS: { value: CaptureFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
]

// Starter fields the configurator can add with one click.
const FIELD_PRESETS: { key: string; label: string; type: CaptureFieldType }[] = [
  { key: 'firstName', label: 'First name', type: 'text' },
  { key: 'lastName', label: 'Last name', type: 'text' },
  { key: 'name', label: 'Full name', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'company', label: 'Company', type: 'text' },
]

interface Props {
  orgId?: string
  sourceId?: string // present when editing
  listHref: string
  surface?: 'portal' | 'admin-org'
}

function scopedHeaders(orgId?: string, contentType = false): Record<string, string> {
  const cleanOrgId = orgId?.trim()
  return {
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
    ...(cleanOrgId ? { 'X-Org-Id': cleanOrgId } : {}),
  }
}

function withOrg(path: string, orgId?: string, extra?: Record<string, string>): string {
  const search = new URLSearchParams(extra)
  const clean = orgId?.trim()
  if (clean) search.set('orgId', clean)
  const q = search.toString()
  return q ? `${path}?${q}` : path
}

const LABEL =
  'block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5'
const INPUT =
  'w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm'
const CARD =
  'rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-5 space-y-4'

function slugifyKey(label: string): string {
  const camel = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
  return camel || `field${Math.random().toString(36).slice(2, 6)}`
}

export function LeadCaptureSourceForm({ orgId, sourceId, listHref, surface = 'portal' }: Props) {
  const router = useRouter()
  const isEdit = Boolean(sourceId)

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [type, setType] = useState<CaptureSourceType>('newsletter')
  const [active, setActive] = useState(true)
  const [doubleOptIn, setDoubleOptIn] = useState<DoubleOptInMode>('off')
  const [successMessage, setSuccessMessage] = useState('Thanks — you are subscribed!')
  const [successRedirectUrl, setSuccessRedirectUrl] = useState('')
  const [tags, setTags] = useState('')
  const [fields, setFields] = useState<CaptureField[]>([])
  const [theme, setTheme] = useState<CaptureWidgetTheme>({ ...DEFAULT_THEME })
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])

  const detailEndpoint = useMemo(
    () => (sourceId ? withOrg(`/api/v1/capture-sources/${sourceId}`, orgId) : ''),
    [sourceId, orgId],
  )

  const hydrate = useCallback((s: CaptureSource) => {
    setName(s.name ?? '')
    setType((s.type as CaptureSourceType) ?? 'newsletter')
    setActive(s.active !== false)
    setDoubleOptIn(s.doubleOptIn === 'on' ? 'on' : 'off')
    setSuccessMessage(s.successMessage ?? 'Thanks — you are subscribed!')
    setSuccessRedirectUrl(s.successRedirectUrl ?? '')
    setTags((s.tagsToApply ?? []).join(', '))
    setFields(Array.isArray(s.fields) ? s.fields : [])
    setTheme({ ...DEFAULT_THEME, ...(s.widgetTheme ?? {}) })
    setWebhookUrl(s.webhookUrl ?? '')
    setWebhookSecret(s.webhookSecret ?? '')
    setDeliveries(Array.isArray(s.deliveries) ? s.deliveries : [])
  }, [])

  const loadSource = useCallback(() => {
    if (!sourceId) return
    setLoading(true)
    setLoadError(null)
    fetch(withOrg(`/api/v1/capture-sources/${sourceId}`, orgId, { includeDeliveries: 'true' }), {
      headers: scopedHeaders(orgId),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body?.error ?? `Failed to load (${r.status})`)
        return body
      })
      .then((body) => hydrate((body.data ?? body) as CaptureSource))
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [sourceId, orgId, hydrate])

  useEffect(() => {
    if (isEdit) loadSource()
  }, [isEdit, loadSource])

  // ── Field configurator helpers ────────────────────────────────────────────
  function addField(preset?: { key: string; label: string; type: CaptureFieldType }) {
    setFields((prev) => {
      if (preset && prev.some((f) => f.key === preset.key)) return prev
      const next: CaptureField = preset
        ? { key: preset.key, label: preset.label, type: preset.type, required: false }
        : { key: slugifyKey('field'), label: '', type: 'text', required: false }
      return [...prev, next]
    })
  }

  function updateField(idx: number, patch: Partial<CaptureField>) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i !== idx) return f
        const merged = { ...f, ...patch }
        // Auto-derive a key from the label if the user hasn't set one explicitly.
        if (patch.label !== undefined && (!f.key || f.key === slugifyKey(f.label))) {
          merged.key = slugifyKey(patch.label)
        }
        return merged
      }),
    )
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx))
  }

  function buildPayload(): Record<string, unknown> {
    const tagsToApply = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const cleanedFields = fields
      .filter((f) => f.label.trim())
      .map((f) => ({
        key: (f.key || slugifyKey(f.label)).trim(),
        label: f.label.trim(),
        type: f.type,
        required: f.required === true,
        ...(f.placeholder ? { placeholder: f.placeholder } : {}),
        ...(f.type === 'select' && f.options?.length ? { options: f.options } : {}),
      }))
    return {
      name: name.trim(),
      type,
      active,
      doubleOptIn,
      successMessage: successMessage.trim() || 'Thanks — you are subscribed!',
      successRedirectUrl: successRedirectUrl.trim(),
      tagsToApply,
      fields: cleanedFields,
      widgetTheme: theme,
      webhookUrl: webhookUrl.trim(),
      webhookSecret: webhookSecret.trim(),
      ...(orgId?.trim() ? { orgId: orgId.trim() } : {}),
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = buildPayload()
      const res = await fetch(
        isEdit ? withOrg(`/api/v1/capture-sources/${sourceId}`, orgId) : withOrg('/api/v1/capture-sources', orgId),
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: scopedHeaders(orgId, true),
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? 'Failed to save')
        return
      }
      router.push(listHref)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="pib-skeleton h-28 rounded-xl" />
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
        <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
        <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
          Could not load this capture source
        </h2>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
        <button type="button" onClick={loadSource} className="btn-pib-secondary mt-4 text-sm">
          Retry
        </button>
      </section>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">{surface === 'admin-org' ? 'Client lead capture' : 'Lead capture'}</p>
          <h1 className="pib-page-title mt-2">{isEdit ? 'Edit capture source' : 'New capture source'}</h1>
          <p className="pib-page-sub max-w-2xl">
            Configure how this source collects leads — opt-in mode, the fields it asks for, theming,
            auto-applied tags, and an optional outbound webhook.
          </p>
        </div>
      </header>

      {/* Basics */}
      <div className={CARD}>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Basics</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={LABEL}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Homepage newsletter"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as CaptureSourceType)} className={INPUT}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
          <span>Active (accepting submissions)</span>
        </label>
      </div>

      {/* Opt-in mode (US-057) */}
      <div className={CARD}>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Opt-in mode</h2>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none">
            <input
              type="radio"
              name="doubleOptIn"
              checked={doubleOptIn === 'off'}
              onChange={() => setDoubleOptIn('off')}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">Single opt-in</span>
              <span className="block text-xs text-[var(--color-pib-text-muted)]">
                Contacts are subscribed immediately on submit.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none">
            <input
              type="radio"
              name="doubleOptIn"
              checked={doubleOptIn === 'on'}
              onChange={() => setDoubleOptIn('on')}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">Double opt-in</span>
              <span className="block text-xs text-[var(--color-pib-text-muted)]">
                A confirmation email is sent first; enrollment is deferred until the contact clicks
                the confirm link. The confirmation email subject/body can be customised via the API.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Success message (US-057) */}
      <div className={CARD}>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">After submission</h2>
        <div>
          <label className={LABEL}>Success message</label>
          <textarea
            value={successMessage}
            onChange={(e) => setSuccessMessage(e.target.value)}
            rows={2}
            placeholder="Thanks — you are subscribed!"
            className={INPUT}
          />
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
            Shown to the visitor after a successful submit.
          </p>
        </div>
        <div>
          <label className={LABEL}>Redirect URL (optional)</label>
          <input
            value={successRedirectUrl}
            onChange={(e) => setSuccessRedirectUrl(e.target.value)}
            placeholder="https://example.com/thanks"
            type="url"
            className={INPUT}
          />
        </div>
      </div>

      {/* Fields configurator (US-057) */}
      <div className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Form fields</h2>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Email is always collected and required. Add the extra fields this form should ask for.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {FIELD_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => addField(p)}
              disabled={fields.some((f) => f.key === p.key)}
              className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] text-[var(--color-pib-text)] border border-[var(--color-pib-line)] transition-colors disabled:opacity-40"
            >
              + {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addField()}
            className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] text-[var(--color-pib-text)] border border-[var(--color-pib-line)] transition-colors"
          >
            + Custom field
          </button>
        </div>

        {fields.length > 0 && (
          <div className="space-y-3">
            {fields.map((f, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-3 space-y-2"
              >
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
                  <div>
                    <label className={LABEL}>Label</label>
                    <input
                      value={f.label}
                      onChange={(e) => updateField(idx, { label: e.target.value })}
                      placeholder="First name"
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Type</label>
                    <select
                      value={f.type}
                      onChange={(e) => updateField(idx, { type: e.target.value as CaptureFieldType })}
                      className={INPUT}
                    >
                      {FIELD_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Key</label>
                    <input
                      value={f.key}
                      onChange={(e) => updateField(idx, { key: e.target.value.trim() })}
                      placeholder="firstName"
                      className={`${INPUT} font-mono`}
                    />
                  </div>
                </div>

                {f.type === 'select' && (
                  <div>
                    <label className={LABEL}>Options (comma-separated)</label>
                    <input
                      value={(f.options ?? []).join(', ')}
                      onChange={(e) =>
                        updateField(idx, {
                          options: e.target.value
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Small, Medium, Large"
                      className={INPUT}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(idx, { required: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <span>Required</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(idx)}
                    className="px-2.5 py-1 rounded-md text-xs text-[#FCA5A5] bg-white/[0.04] hover:bg-red-500/10 border border-[var(--color-pib-line)] transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-apply tags (US-057) */}
      <div className={CARD}>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Auto-apply tags</h2>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="lead, newsletter, website"
          className={INPUT}
        />
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Comma-separated. These tags are applied to every contact created or matched through this
          source.
        </p>
      </div>

      {/* Theme (US-057) */}
      <div className={CARD}>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Theme</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={LABEL}>Primary color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.primaryColor}
                onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                className="h-9 w-12 rounded border border-[var(--color-pib-line)] bg-transparent"
              />
              <input
                value={theme.primaryColor}
                onChange={(e) => setTheme((t) => ({ ...t, primaryColor: e.target.value }))}
                className={`${INPUT} font-mono`}
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Text color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.textColor}
                onChange={(e) => setTheme((t) => ({ ...t, textColor: e.target.value }))}
                className="h-9 w-12 rounded border border-[var(--color-pib-line)] bg-transparent"
              />
              <input
                value={theme.textColor}
                onChange={(e) => setTheme((t) => ({ ...t, textColor: e.target.value }))}
                className={`${INPUT} font-mono`}
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Background color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={theme.backgroundColor}
                onChange={(e) => setTheme((t) => ({ ...t, backgroundColor: e.target.value }))}
                className="h-9 w-12 rounded border border-[var(--color-pib-line)] bg-transparent"
              />
              <input
                value={theme.backgroundColor}
                onChange={(e) => setTheme((t) => ({ ...t, backgroundColor: e.target.value }))}
                className={`${INPUT} font-mono`}
              />
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className={LABEL}>Heading text</label>
            <input
              value={theme.headingText}
              onChange={(e) => setTheme((t) => ({ ...t, headingText: e.target.value }))}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Subheading text</label>
            <input
              value={theme.subheadingText}
              onChange={(e) => setTheme((t) => ({ ...t, subheadingText: e.target.value }))}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Button text</label>
            <input
              value={theme.buttonText}
              onChange={(e) => setTheme((t) => ({ ...t, buttonText: e.target.value }))}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Border radius (px)</label>
            <input
              type="number"
              min={0}
              max={48}
              value={theme.borderRadius}
              onChange={(e) =>
                setTheme((t) => ({ ...t, borderRadius: Number.isFinite(+e.target.value) ? +e.target.value : t.borderRadius }))
              }
              className={INPUT}
            />
          </div>
        </div>
      </div>

      {/* Webhook (US-091) */}
      <div className={CARD}>
        <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Outbound webhook</h2>
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Each submission POSTs the payload to this URL with up to 3 retries and exponential
          backoff. Delivery is asynchronous and never delays the visitor&apos;s submit.
        </p>
        <div>
          <label className={LABEL}>Webhook URL</label>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.example.com/pib"
            type="url"
            className={INPUT}
          />
        </div>
        <div>
          <label className={LABEL}>Signing secret (optional)</label>
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="Used to HMAC-SHA256 sign each delivery (X-PIB-Signature)"
            className={`${INPUT} font-mono`}
          />
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
            When set, deliveries include <code>X-PIB-Signature: sha256=…</code> and{' '}
            <code>X-PIB-Timestamp</code> headers so the receiver can verify authenticity.
          </p>
        </div>

        {isEdit && (
          <div className="border-t border-[var(--color-pib-line)] pt-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-xs font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                Delivery log
              </h3>
              <button
                type="button"
                onClick={loadSource}
                className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] text-[var(--color-pib-text)] border border-[var(--color-pib-line)] transition-colors"
              >
                Refresh
              </button>
            </div>
            {deliveries.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No deliveries yet.</p>
            ) : (
              <div className="space-y-2">
                {deliveries.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          d.status === 'success'
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                            : 'border-red-400/30 bg-red-500/10 text-red-200'
                        }`}
                      >
                        {d.status === 'success' ? 'Delivered' : 'Failed'}
                      </span>
                      <span className="text-xs text-[var(--color-pib-text-muted)]">
                        {d.statusCode ? `HTTP ${d.statusCode}` : 'no response'} · {d.attemptCount}{' '}
                        attempt{d.attemptCount === 1 ? '' : 's'}
                        {fmtTimestamp(d.createdAt) ? ` · ${fmtTimestamp(d.createdAt)}` : ''}
                      </span>
                    </div>
                    {d.lastError && (
                      <p className="mt-1 text-xs text-[#FCA5A5] break-all">{d.lastError}</p>
                    )}
                    {Array.isArray(d.attempts) && d.attempts.length > 1 && (
                      <div className="mt-2 space-y-0.5">
                        {d.attempts.map((a) => (
                          <p
                            key={a.attempt}
                            className="text-[11px] font-mono text-[var(--color-pib-text-muted)]"
                          >
                            #{a.attempt} {a.ok ? 'ok' : 'fail'}{' '}
                            {a.statusCode ? `(${a.statusCode})` : ''} {a.durationMs}ms
                            {a.error ? ` — ${a.error}` : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-[#FCA5A5]">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push(listHref)}
          className="btn-pib-secondary !py-2 !px-4 !text-sm"
          disabled={saving}
        >
          Cancel
        </button>
        <button type="submit" disabled={saving || !name.trim()} className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-50">
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create source'}
        </button>
      </div>
    </form>
  )
}
