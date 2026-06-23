// components/email/SequenceBuilder.tsx
//
// Orchestrates the visual email-sequence builder (US-107): loads/saves a
// Sequence via the existing /api/v1/sequences API, and composes the step
// builder, trigger config, and enrollment preview into a tabbed editor.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { SequenceStep, SequenceStatus } from '@/lib/sequences/types'
import SequenceStepBuilder from './SequenceStepBuilder'
import EnrollmentPreview from './EnrollmentPreview'
import TriggerConfigPanel, { type SequenceTrigger } from './TriggerConfigPanel'

type Tab = 'steps' | 'trigger' | 'preview'

// Local shape — the persisted sequence plus our additive `trigger` field
// (not yet in lib/sequences/types.ts; reported as a needed shared-type change).
interface SequenceDoc {
  id?: string
  name: string
  description: string
  status: SequenceStatus
  steps: SequenceStep[]
  topicId?: string
  trigger?: SequenceTrigger
}

interface Props {
  sequenceId?: string
  orgScope: PortalOrgRouteScope
  onDone: () => void
}

function unwrap<T>(body: unknown): T {
  const b = body as { data?: unknown }
  return (b?.data ?? body) as T
}

export default function SequenceBuilder({ sequenceId, orgScope, onDone }: Props) {
  const endpoint = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  const [tab, setTab] = useState<Tab>('steps')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<SequenceStatus>('draft')
  const [steps, setSteps] = useState<SequenceStep[]>([])
  const [trigger, setTrigger] = useState<SequenceTrigger>({ type: 'manual' })

  const [loading, setLoading] = useState(Boolean(sequenceId))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!sequenceId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetch(endpoint(`/api/v1/sequences/${sequenceId}`))
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${r.status}`)
        return body
      })
      .then((body) => {
        if (cancelled) return
        const seq = unwrap<SequenceDoc>(body)
        setName(seq.name ?? '')
        setDescription(seq.description ?? '')
        setStatus(seq.status ?? 'draft')
        setSteps(Array.isArray(seq.steps) ? seq.steps : [])
        if (seq.trigger) setTrigger(seq.trigger)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load sequence.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sequenceId, endpoint])

  const stepsForSave = useMemo(
    () => steps.map((s, i) => ({ ...s, stepNumber: i })),
    [steps],
  )

  async function handleSave(nextStatus?: SequenceStatus) {
    setSaving(true)
    setSaveError(null)
    const payload: SequenceDoc = {
      name: name.trim(),
      description: description.trim(),
      status: nextStatus ?? status,
      steps: stepsForSave,
      trigger,
    }
    if (orgScope.orgId) (payload as SequenceDoc & { orgId?: string }).orgId = orgScope.orgId

    try {
      if (!payload.name) throw new Error('Give the sequence a name first.')
      const url = sequenceId ? endpoint(`/api/v1/sequences/${sequenceId}`) : endpoint('/api/v1/sequences')
      const res = await fetch(url, {
        method: sequenceId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
      if (nextStatus) setStatus(nextStatus)
      onDone()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bento-card !p-6">
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading sequence…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="bento-card border-amber-400/25 bg-amber-400/10 !p-5">
        <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
        <h2 className="mt-1 font-display text-xl">Sequence could not load</h2>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
        <button type="button" onClick={onDone} className="btn-pib-secondary mt-4 text-sm">
          Back to automations
        </button>
      </div>
    )
  }

  const TABS: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'steps', label: 'Steps', icon: 'account_tree' },
    { id: 'trigger', label: 'Trigger', icon: 'bolt' },
    { id: 'preview', label: 'Preview enrollment', icon: 'play_circle' },
  ]

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="bento-card !p-5 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Sequence name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome onboarding"
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this sequence does"
              className="w-full rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pib-accent)]"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">Status:</span>
          <span
            className={[
              'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]',
              status === 'active'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                : status === 'paused'
                  ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]',
            ].join(' ')}
          >
            {status}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors',
              tab === t.id
                ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-text)]'
                : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.03]',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'steps' && <SequenceStepBuilder steps={steps} onChange={setSteps} />}
      {tab === 'trigger' && <TriggerConfigPanel value={trigger} onChange={setTrigger} endpoint={endpoint} />}
      {tab === 'preview' && <EnrollmentPreview steps={stepsForSave} />}

      {/* Save bar */}
      {saveError && (
        <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {saveError}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => handleSave('draft')}
          disabled={saving}
          className="btn-pib-secondary flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">save</span>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={() => handleSave('active')}
          disabled={saving}
          className="btn-pib-accent flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
          Save &amp; activate
        </button>
        <button type="button" onClick={onDone} disabled={saving} className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          Cancel
        </button>
      </div>
    </div>
  )
}
