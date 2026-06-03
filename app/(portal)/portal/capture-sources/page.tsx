'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import type { CaptureSource, CaptureSourceType } from '@/lib/crm/captureSources'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'

interface CampaignSummary {
  id: string
  name: string
  status: string
}

interface SequenceSummary {
  id: string
  name: string
  status: string
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://partnersinbiz.online'

const TYPE_STYLES: Record<CaptureSourceType, string> = {
  form: 'bg-blue-500/15 text-blue-300 border border-blue-500/25',
  api: 'bg-purple-500/15 text-purple-300 border border-purple-500/25',
  csv: 'bg-amber-500/15 text-amber-300 border border-amber-500/25',
  integration: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
  manual: 'bg-white/10 text-[var(--color-pib-text-muted)] border border-[var(--color-pib-line-strong)]',
}

const TYPE_LABELS: Record<CaptureSourceType, string> = {
  form: 'Form',
  api: 'API',
  csv: 'CSV',
  integration: 'Integration',
  manual: 'Manual',
}

function TypeBadge({ type }: { type: CaptureSourceType }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${TYPE_STYLES[type]}`}>
      {TYPE_LABELS[type]}
    </span>
  )
}

function StatusBadge({ source }: { source: CaptureSource }) {
  const captured = source.capturedCount ?? 0
  if (!source.enabled) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-amber-500/25 bg-amber-500/10 text-amber-200">
        Paused
      </span>
    )
  }
  if (captured === 0) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-sky-500/25 bg-sky-500/10 text-sky-200">
        No captures yet
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-emerald-500/25 bg-emerald-500/10 text-emerald-200">
      Ready for traffic
    </span>
  )
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: string | number
  detail: string
  icon: string
}) {
  return (
    <div className="rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
            {label}
          </p>
          <p className="mt-2 text-2xl font-display text-[var(--color-pib-text)]">{value}</p>
        </div>
        <span
          className="material-symbols-outlined rounded-lg border border-[var(--color-pib-line)] bg-white/[0.04] p-2 text-[18px] text-[var(--color-pib-text-muted)]"
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">{detail}</p>
    </div>
  )
}

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // ignore
        }
      }}
      className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] text-[var(--color-pib-text)] border border-[var(--color-pib-line)] transition-colors"
      type="button"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

function buildSnippet(publicKey: string): string {
  return `<script src="${BASE_URL}/embed/form/${publicKey}" async></script>\n<div data-pib-form></div>`
}

function buildCurl(publicKey: string): string {
  return `curl -X POST ${BASE_URL}/api/public/capture/${publicKey} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"email":"jane@example.com","name":"Jane"}'`
}

function SourceCard({
  source,
  campaigns,
  sequences,
  initiallyExpanded,
  onUpdated,
  onDeleted,
}: {
  source: CaptureSource
  campaigns: CampaignSummary[]
  sequences: SequenceSummary[]
  initiallyExpanded: boolean
  onUpdated: (s: CaptureSource) => void
  onDeleted: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(source.name)
  const [tagsDraft, setTagsDraft] = useState((source.autoTags ?? []).join(', '))
  const [redirectDraft, setRedirectDraft] = useState(source.redirectUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => {
    setNameDraft(source.name)
    setTagsDraft((source.autoTags ?? []).join(', '))
    setRedirectDraft(source.redirectUrl ?? '')
  }, [source.name, source.autoTags, source.redirectUrl])

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/crm/capture-sources/${source.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to update')
        return
      }
      onUpdated(json.data as CaptureSource)
    } catch {
      setError('Failed to update')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleEnabled() {
    await patch({ enabled: !source.enabled })
  }

  async function handleNameSave() {
    const next = nameDraft.trim()
    setEditingName(false)
    if (!next || next === source.name) {
      setNameDraft(source.name)
      return
    }
    await patch({ name: next })
  }

  async function handleTagsBlur() {
    const next = tagsDraft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const current = source.autoTags ?? []
    if (next.length === current.length && next.every((t, i) => t === current[i])) return
    await patch({ autoTags: next })
  }

  async function handleRedirectBlur() {
    if (redirectDraft === (source.redirectUrl ?? '')) return
    await patch({ redirectUrl: redirectDraft })
  }

  async function handleConsentChange(v: boolean) {
    await patch({ consentRequired: v })
  }

  async function handleCampaignsChange(ids: string[]) {
    await patch({ autoCampaignIds: ids })
  }

  async function handleSequencesChange(ids: string[]) {
    await patch({ autoSequenceIds: ids })
  }

  async function confirmRotateKey() {
    setRotateConfirmOpen(false)
    await patch({ rotateKey: true })
  }

  async function confirmDelete() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/crm/capture-sources/${source.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to delete')
        setBusy(false)
        return
      }
      onDeleted(source.id)
    } catch {
      setError('Failed to delete')
      setBusy(false)
    }
  }

  function toggleCampaign(id: string) {
    const set = new Set(source.autoCampaignIds ?? [])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    handleCampaignsChange(Array.from(set))
  }

  function toggleSequence(id: string) {
    const set = new Set(source.autoSequenceIds ?? [])
    if (set.has(id)) set.delete(id)
    else set.add(id)
    handleSequencesChange(Array.from(set))
  }

  const captured = source.capturedCount ?? 0
  const lastAt = fmtTimestamp(source.lastCapturedAt)
  const tagCount = source.autoTags?.length ?? 0
  const campaignCount = source.autoCampaignIds?.length ?? 0
  const sequenceCount = source.autoSequenceIds?.length ?? 0
  const readinessItems = [
    source.enabled ? 'Live' : 'Paused',
    captured > 0 ? `${captured} captured` : 'No captures yet',
    tagCount > 0 ? `${tagCount} auto-tag${tagCount === 1 ? '' : 's'}` : 'No auto-tags',
    campaignCount + sequenceCount > 0 ? 'Auto-enrolls' : 'No nurture',
  ]

  return (
    <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] overflow-hidden">
      <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="material-symbols-outlined rounded-lg border border-[var(--color-pib-line)] bg-white/[0.04] p-2 text-[var(--color-pib-text-muted)] text-[20px]"
            aria-hidden="true"
          >
            inventory_2
          </span>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleNameSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') {
                    setNameDraft(source.name)
                    setEditingName(false)
                  }
                }}
                autoFocus
                className="font-medium bg-[var(--color-pib-bg)] px-2 py-1 rounded-md border border-[var(--color-pib-line-strong)] text-sm w-full max-w-xs text-[var(--color-pib-text)]"
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="font-medium text-[var(--color-pib-text)] hover:underline text-left truncate"
                type="button"
                title="Click to rename"
              >
                {source.name}
              </button>
            )}
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
              {captured} captured
              {lastAt ? <span> · last {lastAt}</span> : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {readinessItems.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[var(--color-pib-line)] bg-white/[0.03] px-2 py-0.5 text-[11px] text-[var(--color-pib-text-muted)]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
          <TypeBadge type={source.type} />
          <StatusBadge source={source} />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={source.enabled}
              onChange={handleToggleEnabled}
              disabled={busy}
              className="h-4 w-4"
            />
            <span>{source.enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[var(--color-pib-text)] text-sm border border-[var(--color-pib-line)] hover:bg-white/[0.08] transition-colors"
            type="button"
            aria-label={`${expanded ? 'Hide details' : 'Details'} for ${source.name}`}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>

      {error && <p className="px-4 pb-2 text-sm text-[#FCA5A5]">{error}</p>}

      {expanded && (
        <div className="border-t border-[var(--color-pib-line)] p-4 space-y-5">
          {/* Public key */}
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Public ingest key
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs px-2 py-1 rounded-md bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)] break-all text-[var(--color-pib-text)]">
                {source.publicKey}
              </span>
              <CopyButton value={source.publicKey} />
              <button
                onClick={() => setRotateConfirmOpen(true)}
                disabled={busy}
                className="px-2.5 py-1 rounded-md text-xs bg-white/[0.04] hover:bg-white/[0.08] text-[var(--color-pib-text)] border border-[var(--color-pib-line)] transition-colors disabled:opacity-50"
                type="button"
                aria-label={`Rotate public key for ${source.name}`}
              >
                Rotate
              </button>
            </div>
            {rotateConfirmOpen && (
              <section
                role="alertdialog"
                aria-labelledby={`capture-source-rotate-title-${source.id}`}
                aria-describedby={`capture-source-rotate-description-${source.id}`}
                className="mt-3 rounded-lg border border-amber-300/30 bg-amber-400/10 px-4 py-3 shadow-xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">
                      key
                    </span>
                    <div className="min-w-0">
                      <p className="eyebrow !text-[10px] text-amber-100">Public key rotation confirmation</p>
                      <h3 id={`capture-source-rotate-title-${source.id}`} className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                        Rotate public key for &quot;{source.name}&quot;?
                      </h3>
                      <p id={`capture-source-rotate-description-${source.id}`} className="mt-2 text-sm text-amber-50/90">
                        This immediately invalidates the current embed/API key. Update every form, API client, and integration using this capture source before sending more traffic.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRotateConfirmOpen(false)}
                      className="btn-pib-secondary text-xs"
                      disabled={busy}
                      aria-label={`Cancel key rotation for capture source ${source.name}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmRotateKey}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-200/30 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-300/25 disabled:opacity-50"
                      aria-label={`Confirm rotate public key for capture source ${source.name}`}
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                        key
                      </span>
                      {busy ? 'Rotating...' : 'Rotate key'}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>

          {/* Snippet (form only) */}
          {source.type === 'form' && (
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
                Embed snippet
              </label>
              <div className="rounded-md bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)] p-3 font-mono text-xs text-[var(--color-pib-text)] whitespace-pre-wrap break-all">
                {buildSnippet(source.publicKey)}
              </div>
              <div className="mt-2">
                <CopyButton value={buildSnippet(source.publicKey)} label="Copy snippet" />
              </div>
            </div>
          )}

          {/* curl (api only) */}
          {source.type === 'api' && (
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
                API endpoint
              </label>
              <div className="rounded-md bg-[var(--color-pib-bg)] border border-[var(--color-pib-line)] p-3 font-mono text-xs text-[var(--color-pib-text)] whitespace-pre-wrap break-all">
                {buildCurl(source.publicKey)}
              </div>
              <div className="mt-2">
                <CopyButton value={buildCurl(source.publicKey)} label="Copy curl" />
              </div>
            </div>
          )}

          {/* Auto-tags */}
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Auto-tags
            </label>
            <input
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={handleTagsBlur}
              placeholder="lead, website, newsletter"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
            />
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
              Comma-separated. Applied to every captured contact.
            </p>
          </div>

          {/* Auto-enroll campaigns */}
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Auto-enroll campaigns
            </label>
            {campaigns.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                No active campaigns to choose from.
              </p>
            ) : (
              <div className="space-y-1.5">
                {campaigns.map((c) => {
                  const checked = (source.autoCampaignIds ?? []).includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCampaign(c.id)}
                        disabled={busy}
                        className="h-4 w-4"
                      />
                      <span>{c.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Auto-enroll direct sequences */}
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
              Auto-enroll sequences
            </label>
            {sequences.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                No active sequences to choose from.{' '}
                <Link href="/portal/settings/sequences/new" className="text-[var(--color-pib-accent)] hover:underline">
                  Create a sequence
                </Link>
              </p>
            ) : (
              <div className="space-y-1.5">
                {sequences.map((sequence) => {
                  const checked = (source.autoSequenceIds ?? []).includes(sequence.id)
                  return (
                    <label
                      key={sequence.id}
                      className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSequence(sequence.id)}
                        disabled={busy}
                        className="h-4 w-4"
                      />
                      <span>{sequence.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Form-only: redirect URL + consent */}
          {source.type === 'form' && (
            <>
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1.5">
                  Redirect URL
                </label>
                <input
                  value={redirectDraft}
                  onChange={(e) => setRedirectDraft(e.target.value)}
                  onBlur={handleRedirectBlur}
                  placeholder="https://example.com/thanks"
                  type="url"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
                />
                <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
                  Where the form sends visitors after a successful submit. Leave empty to show a thank-you message in place.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--color-pib-text)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={source.consentRequired}
                  onChange={(e) => handleConsentChange(e.target.checked)}
                  disabled={busy}
                  className="h-4 w-4"
                />
                <span>Consent required (show explicit opt-in checkbox)</span>
              </label>
            </>
          )}

          {/* Delete */}
          <div className="space-y-3 border-t border-[var(--color-pib-line)] pt-3">
            {deleteConfirmOpen && (
              <section
                role="alertdialog"
                aria-labelledby={`capture-source-delete-title-${source.id}`}
                aria-describedby={`capture-source-delete-description-${source.id}`}
                className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 shadow-xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <span className="material-symbols-outlined mt-0.5 text-red-300" aria-hidden="true">
                      warning
                    </span>
                    <div className="min-w-0">
                      <p className="eyebrow !text-[10px] text-red-200">Capture source delete confirmation</p>
                      <h3 id={`capture-source-delete-title-${source.id}`} className="mt-1 font-display text-lg text-[var(--color-pib-text)]">
                        Delete capture source &quot;{source.name}&quot;?
                      </h3>
                      <p id={`capture-source-delete-description-${source.id}`} className="mt-2 text-sm text-red-100/90">
                        This removes the tracked intake channel, embed/API key, and future attribution path. Existing captured contacts and CRM history stay available for audit.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmOpen(false)}
                      className="btn-pib-secondary text-xs"
                      disabled={busy}
                      aria-label={`Cancel delete for capture source ${source.name}`}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDelete}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-300/30 bg-red-400/15 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:bg-red-400/25 disabled:opacity-50"
                      aria-label={`Confirm delete capture source ${source.name}`}
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                        delete
                      </span>
                      {busy ? 'Deleting...' : 'Delete source'}
                    </button>
                  </div>
                </div>
              </section>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-[#FCA5A5] text-sm border border-[var(--color-pib-line)] hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                type="button"
                aria-label={`Delete capture source ${source.name}`}
              >
                Delete source
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PortalCaptureSourcesPage() {
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [sequences, setSequences] = useState<SequenceSummary[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<CaptureSourceType>('form')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const newSourceNameRef = useRef<HTMLInputElement>(null)

  const loadSources = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetch('/api/v1/crm/capture-sources')
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load capture sources (${r.status})`)
        }
        return body
      })
      .then((body) => setSources((body.data ?? []) as CaptureSource[]))
      .catch((err) => {
        setSources([])
        setLoadError(err instanceof Error ? err.message : 'Failed to load capture sources')
      })
      .finally(() => setLoading(false))
  }, [])

  const loadCampaigns = useCallback(() => {
    fetch('/api/v1/campaigns?status=active')
      .then((r) => r.json())
      .then((body) => {
        const list = (body.data ?? []) as Array<{ id: string; name: string; status: string }>
        setCampaigns(list.map((c) => ({ id: c.id, name: c.name, status: c.status })))
      })
      .catch(() => {})
  }, [])

  const loadSequences = useCallback(() => {
    fetch('/api/v1/crm/sequences')
      .then((r) => r.json())
      .then((body) => {
        const raw = body.data?.sequences ?? body.data ?? []
        const list = Array.isArray(raw) ? raw as Array<{ id: string; name: string; status: string }> : []
        setSequences(
          list
            .filter((sequence) => sequence.status === 'active')
            .map((sequence) => ({
              id: sequence.id,
              name: sequence.name,
              status: sequence.status,
            })),
        )
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadSources()
    loadCampaigns()
    loadSequences()
  }, [loadSources, loadCampaigns, loadSequences])

  const metrics = useMemo(() => {
    const totalCaptures = sources.reduce((sum, source) => sum + (source.capturedCount ?? 0), 0)
    const activeSources = sources.filter((source) => source.enabled).length
    const conversionReady = sources.filter(
      (source) =>
        source.enabled &&
        ((source.autoTags?.length ?? 0) > 0 ||
          (source.autoCampaignIds?.length ?? 0) > 0 ||
          (source.autoSequenceIds?.length ?? 0) > 0 ||
          source.consentRequired),
    ).length
    const needsAttention = sources.filter(
      (source) => !source.enabled || (source.enabled && (source.capturedCount ?? 0) === 0),
    ).length
    return { totalCaptures, activeSources, conversionReady, needsAttention }
  }, [sources])

  const sourceMix = useMemo(() => {
    const counts = sources.reduce<Record<CaptureSourceType, number>>(
      (acc, source) => {
        acc[source.type] += 1
        return acc
      },
      { form: 0, api: 0, csv: 0, integration: 0, manual: 0 },
    )
    return (Object.keys(counts) as CaptureSourceType[]).filter((type) => counts[type] > 0)
  }, [sources])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setSubmitting(true)
    setFormError(null)
    try {
      const res = await fetch('/api/v1/crm/capture-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: newType }),
      })
      const body = await res.json()
      if (!res.ok) {
        setFormError(body.error ?? 'Failed to create source')
        return
      }
      const created = body.data as CaptureSource
      setSources((prev) => [created, ...prev])
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.add(created.id)
        return next
      })
      setNewName('')
      setNewType('form')
    } catch {
      setFormError('Failed to create source')
    } finally {
      setSubmitting(false)
    }
  }

  function handleUpdated(updated: CaptureSource) {
    setSources((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)))
  }

  function handleDeleted(id: string) {
    setSources((prev) => prev.filter((s) => s.id !== id))
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function focusFirstFormSource() {
    setNewType('form')
    newSourceNameRef.current?.focus()
  }

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">CRM</p>
          <h1 className="pib-page-title mt-2">Capture command center</h1>
          <p className="pib-page-sub max-w-2xl">
            Manage every path that feeds contacts into the CRM, from embedded forms to partner APIs and CSV imports. Keep each channel measurable, tagged, and ready for follow-up.
          </p>
        </div>
        <Link
          href="/portal/capture-sources/import"
          className="btn-pib-secondary !py-2 !px-4 !text-sm"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            upload_file
          </span>
          Import CSV
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total captures"
          value={metrics.totalCaptures}
          detail="Contacts attributed to tracked intake channels."
          icon="groups"
        />
        <MetricCard
          label="Active channels"
          value={`${metrics.activeSources}/${sources.length}`}
          detail="Live forms, APIs, imports, and manual channels."
          icon="radio_button_checked"
        />
        <MetricCard
          label="Conversion focus"
          value={metrics.conversionReady}
          detail="Sources with consent, tags, or nurture routing."
          icon="conversion_path"
        />
        <MetricCard
          label="Needs attention"
          value={metrics.needsAttention}
          detail="Paused or live channels with no recorded captures."
          icon="priority_high"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Create an intake channel</h2>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                Start with the channel type, then add tags, nurture routing, consent, and embed/API instructions from the source card.
              </p>
            </div>
          </div>
          <form onSubmit={handleCreate} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
            <input
              ref={newSourceNameRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Source name (e.g. Homepage form)"
              className="px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
              disabled={submitting}
              autoComplete="off"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as CaptureSourceType)}
              className="px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] text-sm"
              disabled={submitting}
              aria-label="Capture source type"
            >
              <option value="form">Form</option>
              <option value="api">API</option>
              <option value="manual">Manual</option>
            </select>
            <button
              type="submit"
              disabled={submitting || !newName.trim()}
              className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </form>
          {formError && <p className="mt-2 text-sm text-[#FCA5A5]">{formError}</p>}
        </div>

        <div className="rounded-xl bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] p-4">
          <h2 className="text-sm font-medium text-[var(--color-pib-text)]">Channel mix</h2>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Balance high-intent forms with imports and partner APIs so CRM growth is not trapped in one channel.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {sourceMix.length === 0 ? (
              <span className="text-sm text-[var(--color-pib-text-muted)]">No channels yet</span>
            ) : (
              sourceMix.map((type) => <TypeBadge key={type} type={type} />)
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="pib-skeleton h-20 rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  Capture sources could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadSources}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Retry loading capture sources"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : sources.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="p-5">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-pib-accent)]/25 bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]">
                <span className="material-symbols-outlined text-[21px]" aria-hidden>
                  add_business
                </span>
              </span>
              <p className="eyebrow !text-[10px]">Intake launch</p>
              <h2 className="mt-3 text-xl font-semibold text-[var(--color-pib-text)]">
                No tracked intake channels yet.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Create the first capture source so contacts arrive with source attribution, consent context, tags, and a visible follow-up path for the team.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={focusFirstFormSource}
                  className="btn-pib-accent inline-flex items-center gap-1.5 text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden>
                    dynamic_form
                  </span>
                  Set up first form source
                </button>
                <Link
                  href="/portal/capture-sources/import"
                  className="btn-pib-secondary inline-flex items-center gap-1.5 text-sm"
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden>
                    upload_file
                  </span>
                  Import CSV
                </Link>
              </div>
            </div>
            <div className="border-t border-[var(--color-pib-line)] bg-black/10 p-4 lg:border-l lg:border-t-0">
              <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                First-channel checklist
              </p>
              <div className="mt-4 space-y-3">
                {[
                  ['Attribution', 'Name the source so every new contact keeps origin context.'],
                  ['Consent', 'Decide whether the first form needs explicit opt-in.'],
                  ['Routing', 'Add tags or campaigns before the channel receives traffic.'],
                ].map(([label, copy]) => (
                  <div key={label} className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{label}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{copy}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((s) => (
            <SourceCard
              key={s.id}
              source={s}
              campaigns={campaigns}
              sequences={sequences}
              initiallyExpanded={expandedIds.has(s.id)}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
