'use client'

/**
 * DealDrawer — create / edit a deal
 *
 * A5: adds probability slider, lost-reason textarea, and line-items editor
 * on top of the core deal fields.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Deal, DealLineItem, Currency } from '@/lib/crm/types'
import { extractPipelinesList } from '@/lib/pipelines/response'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { CompanyPicker } from './CompanyPicker'
import { DealLineItemsEditor } from './DealLineItemsEditor'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DealDrawerProps {
  /** When provided, the drawer is in edit mode. */
  deal?: Deal
  /** Pre-selected pipelineId. Required when creating. */
  defaultPipelineId?: string
  /** Pre-selected contactId. Required when creating. */
  defaultContactId?: string
  /** Display label for a pre-selected contact. */
  defaultContactLabel?: string
  /** Pre-selected companyId for account-scoped deal creation. */
  defaultCompanyId?: string
  /** Display label for a pre-selected company. */
  defaultCompanyName?: string
  /** Called after a successful save. Receives the saved deal ID. */
  onSaved: (dealId: string) => void
  /** Called when the drawer should close without saving. */
  onClose: () => void
  /** orgId for the ProductPicker */
  orgId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENCIES: Currency[] = ['ZAR', 'USD', 'EUR']

type ContactResult = {
  id: string
  name?: string
  email?: string
  company?: string
}

function isLostStage(stage?: PipelineStage): boolean {
  if (!stage) return false
  return stage.kind === 'lost' || stage.label.toLowerCase().includes('lost')
}

function readableContactLabel(label?: string): string | undefined {
  const trimmed = label?.trim()
  return trimmed || undefined
}

function ContactPicker({
  contactId,
  contactLabel,
  onChange,
}: {
  contactId: string
  contactLabel: string
  onChange: (contact: { id: string; label: string } | null) => void
}) {
  const [query, setQuery] = useState(contactLabel)
  const [results, setResults] = useState<ContactResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setQuery(contactLabel)
  }, [contactLabel])

  useEffect(() => {
    if (query.trim().length < 2 || query === contactLabel) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/crm/contacts?search=${encodeURIComponent(query)}&limit=8`)
        const body = await res.json().catch(() => ({}))
        if (!cancelled) {
          const list = body.data?.contacts ?? body.data ?? []
          setResults(Array.isArray(list) ? list : [])
          setOpen(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [contactLabel, query])

  function select(contact: ContactResult) {
    const label = contact.name || contact.email || contact.id
    setQuery(label)
    setResults([])
    setOpen(false)
    onChange({ id: contact.id, label })
  }

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!event.target.value) onChange(null)
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search contacts..."
          className="pib-input w-full pr-8"
        />
        {loading ? (
          <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-[var(--color-pib-text-muted)] animate-spin">progress_activity</span>
        ) : contactId ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setResults([])
              onChange(null)
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
            aria-label="Clear contact"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        ) : null}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] shadow-xl">
          {results.length === 0 ? (
            <div className="px-3 py-2">
              <p className="text-xs text-[var(--color-pib-text-muted)]">No contacts found.</p>
              <Link
                href="/portal/contacts"
                aria-label="Open contacts to create a deal contact"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-v2)] hover:underline"
              >
                <span className="material-symbols-outlined text-[14px]">contacts</span>
                Open contacts
              </Link>
            </div>
          ) : (
            results.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => select(contact)}
                className="w-full px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
              >
                <p className="text-sm font-medium text-[var(--color-pib-text)]">{contact.name || contact.email || contact.id}</p>
                <p className="text-[11px] text-[var(--color-pib-text-muted)]">{[contact.email, contact.company].filter(Boolean).join(' · ')}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DealDrawer({
  deal,
  defaultPipelineId,
  defaultContactId,
  defaultContactLabel,
  defaultCompanyId,
  defaultCompanyName,
  onSaved,
  onClose,
  orgId,
}: DealDrawerProps) {
  const isEdit = !!deal

  // Core fields
  const [title, setTitle] = useState(deal?.title ?? '')
  const [contactId, setContactId] = useState(deal?.contactId ?? defaultContactId ?? '')
  const [contactLabel, setContactLabel] = useState(readableContactLabel(defaultContactLabel) ?? deal?.contactId ?? defaultContactId ?? '')
  const [companyId, setCompanyId] = useState(deal?.companyId ?? defaultCompanyId ?? '')
  const [companyName, setCompanyName] = useState(deal?.companyName ?? defaultCompanyName ?? '')
  const [value, setValue] = useState(deal?.value ?? 0)
  const [currency, setCurrency] = useState<Currency>(deal?.currency ?? 'ZAR')
  const [notes, setNotes] = useState(deal?.notes ?? '')

  // Pipeline / stage
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState(deal?.pipelineId ?? defaultPipelineId ?? '')
  const [selectedStageId, setSelectedStageId] = useState(deal?.stageId ?? '')
  const [pipelinesLoading, setPipelinesLoading] = useState(true)

  // A5 fields
  const [probability, setProbability] = useState<number>(deal?.probability ?? 0)
  const [probabilityOverridden, setProbabilityOverridden] = useState(false)
  const [lostReason, setLostReason] = useState(deal?.lostReason ?? '')
  const [lineItems, setLineItems] = useState<DealLineItem[]>(deal?.lineItems ?? [])

  // Form state
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derived
  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId)
  const stages: PipelineStage[] = selectedPipeline
    ? [...selectedPipeline.stages].sort((a, b) => a.order - b.order)
    : []
  const selectedStage = stages.find(s => s.id === selectedStageId)
  const showLostReason = isLostStage(selectedStage)

  // ── Fetch pipelines ─────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/crm/pipelines')
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        const list = extractPipelinesList(body)
        setPipelines(list)

        if (!selectedPipelineId && list.length > 0) {
          const def = list.find(p => p.isDefault) ?? list[0]
          setSelectedPipelineId(def.id)
        }
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setPipelinesLoading(false) })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first open stage when pipeline changes (not for edits where stage is already set)
  useEffect(() => {
    if (!selectedPipeline) return
    const sorted = [...selectedPipeline.stages].sort((a, b) => a.order - b.order)

    if (!isEdit && !selectedStageId) {
      const firstOpen = sorted.find(s => s.kind === 'open') ?? sorted[0]
      if (firstOpen) {
        setSelectedStageId(firstOpen.id)
        if (!probabilityOverridden) setProbability(firstOpen.probability)
      }
    }
  }, [selectedPipeline]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stage change handler ────────────────────────────────────────────────────

  function handleStageChange(stageId: string) {
    setSelectedStageId(stageId)
    if (!probabilityOverridden) {
      const stage = stages.find(s => s.id === stageId)
      if (stage) setProbability(stage.probability)
    }
    // Clear lostReason if moving away from lost stage
    const stage = stages.find(s => s.id === stageId)
    if (!isLostStage(stage)) setLostReason('')
  }

  function handleProbabilityChange(val: number) {
    setProbability(val)
    setProbabilityOverridden(true)
  }

  function resetProbability() {
    const stage = stages.find(s => s.id === selectedStageId)
    if (stage) setProbability(stage.probability)
    setProbabilityOverridden(false)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    if (!contactId.trim()) { setError('Contact is required'); return }
    if (!selectedPipelineId) { setError('Pipeline is required'); return }
    if (!selectedStageId) { setError('Stage is required'); return }

    setError(null)
    setSaving(true)

    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        contactId,
        companyId: companyId || undefined,
        companyName: companyName || undefined,
        value,
        currency,
        pipelineId: selectedPipelineId,
        stageId: selectedStageId,
        notes: notes.trim(),
        probability,
        lineItems: lineItems.length > 0 ? lineItems : undefined,
      }
      if (showLostReason && lostReason.trim()) payload.lostReason = lostReason.trim()
      else payload.lostReason = null  // clear if stage is no longer lost

      const url = isEdit ? `/api/v1/crm/deals/${deal!.id}` : '/api/v1/crm/deals'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Failed to save deal')

      const savedId = isEdit ? deal!.id : (body.data?.id ?? '')
      onSaved(savedId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save deal')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const labelCls = 'block text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-1'
  const sectionCls = 'space-y-4'

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit deal' : 'Create deal'}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className="relative z-50 h-full w-full max-w-lg flex flex-col overflow-hidden"
        style={{ background: 'var(--color-pib-surface)', borderLeft: '1px solid var(--color-pib-line)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--color-pib-line)' }}
        >
          <p className="text-sm font-semibold text-[var(--color-pib-text)]">
            {isEdit ? 'Edit Deal' : 'New Deal'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className={labelCls}>Deal title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Acme Corp — Annual License"
              required
              className="pib-input w-full"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls}>Contact *</label>
              <ContactPicker
                contactId={contactId}
                contactLabel={contactLabel}
                onChange={(contact) => {
                  setContactId(contact?.id ?? '')
                  setContactLabel(contact?.label ?? '')
                }}
              />
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <CompanyPicker
                currentCompanyId={companyId || undefined}
                currentCompanyName={companyName || undefined}
                onChange={({ companyId: nextCompanyId, companyName: nextCompanyName }) => {
                  setCompanyId(nextCompanyId ?? '')
                  setCompanyName(nextCompanyName ?? '')
                }}
              />
            </div>
          </div>

          {/* Value + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Value</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={value}
                onChange={e => setValue(parseFloat(e.target.value) || 0)}
                className="pib-input w-full"
              />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as Currency)}
                className="pib-input w-full"
              >
                {CURRENCIES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Pipeline + Stage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Pipeline</label>
              {pipelinesLoading ? (
                <div className="pib-skeleton h-9 rounded" />
              ) : (
                <select
                  value={selectedPipelineId}
                  onChange={e => {
                    setSelectedPipelineId(e.target.value)
                    setSelectedStageId('')
                    setProbabilityOverridden(false)
                  }}
                  className="pib-input w-full"
                >
                  {pipelines.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={labelCls}>Stage</label>
              {pipelinesLoading ? (
                <div className="pib-skeleton h-9 rounded" />
              ) : (
                <select
                  value={selectedStageId}
                  onChange={e => handleStageChange(e.target.value)}
                  className="pib-input w-full"
                >
                  {stages.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Probability */}
          <div>
            <label className={labelCls}>Probability</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={probability}
                onChange={e => handleProbabilityChange(parseInt(e.target.value))}
                className="flex-1 accent-[var(--color-accent-v2)]"
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={probability}
                  onChange={e => handleProbabilityChange(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="pib-input w-16 text-right"
                />
                <span className="text-[var(--color-pib-text-muted)] text-sm">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-[var(--color-pib-text-muted)]">
                {probabilityOverridden ? 'overridden' : 'from stage'}
              </span>
              {probabilityOverridden && (
                <button
                  type="button"
                  onClick={resetProbability}
                  className="cursor-pointer text-[11px] text-[var(--color-accent-v2)] hover:opacity-80 flex items-center gap-0.5 transition-opacity"
                >
                  <span className="material-symbols-outlined text-[12px]">refresh</span>
                  reset
                </button>
              )}
            </div>
          </div>

          {/* Lost reason — only for lost stages */}
          {showLostReason && (
            <div>
              <label className={labelCls}>Lost reason</label>
              <textarea
                value={lostReason}
                onChange={e => setLostReason(e.target.value)}
                placeholder="Why was this deal lost?"
                rows={2}
                className="pib-input w-full resize-none"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="pib-input w-full resize-none"
            />
          </div>

          {/* Line items */}
          <div className={sectionCls}>
            <p className={labelCls}>Line Items</p>
            <DealLineItemsEditor
              value={lineItems}
              onChange={setLineItems}
              currency={currency}
              orgId={orgId}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: '#ef444420', color: '#f87171', border: '1px solid #ef444430' }}
            >
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-5 py-4 border-t shrink-0"
          style={{ borderColor: 'var(--color-pib-line)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer btn-pib-secondary text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="deal-drawer-form"
            disabled={saving}
            onClick={handleSubmit}
            className="cursor-pointer btn-pib-accent text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create deal'}
          </button>
        </div>
      </div>
    </div>
  )
}
