// components/email/SequenceBuilder.tsx
//
// Orchestrates the visual email-sequence builder (US-107): loads/saves a
// Sequence via the existing /api/v1/sequences API, and composes the step
// builder, trigger config, and enrollment preview into a tabbed editor.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { SequenceQuietHours, SequenceStep, SequenceStatus } from '@/lib/sequences/types'
import SequenceStepBuilder from './SequenceStepBuilder'
import EnrollmentPreview from './EnrollmentPreview'
import TriggerConfigPanel, { type SequenceTrigger } from './TriggerConfigPanel'
import SequenceDeadLetterControl from './SequenceDeadLetterControl'

import { Icon } from '@/components/studio'

type Tab = 'steps' | 'trigger' | 'preview'

// Local shape  -  the persisted sequence plus our additive `trigger` field
// (not yet in lib/sequences/types.ts; reported as a needed shared-type change).
interface SequenceDoc {
  id?: string
  name: string
  description: string
  status: SequenceStatus
  steps: SequenceStep[]
  topicId?: string
  trigger?: SequenceTrigger
  quietHours?: SequenceQuietHours
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
  const [quietHours, setQuietHours] = useState<SequenceQuietHours>({ enabled: false, startMinuteLocal: 20 * 60, endMinuteLocal: 8 * 60, timezoneMode: 'recipient' })

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
        if (seq.quietHours) setQuietHours(seq.quietHours)
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
      quietHours,
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
      <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45 p-3">
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading sequence…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-amber-400/25 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-3">
        <p className="eyebrow !text-[10px] text-[var(--st-warning)]">Source health</p>
        <h2 className="mt-1 text-xl">Sequence could not load</h2>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
        <button type="button" onClick={onDone} className="mt-3 h-8 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]">
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
    <div className="overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/45">
      {/* Meta */}
      <div className="space-y-3 border-b border-[var(--color-card-border)] p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Sequence name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome onboarding"
              className="w-full h-8 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs outline-none focus:border-primary/50"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] text-[var(--color-pib-text-muted)] mb-1">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this sequence does"
              className="w-full h-8 rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs outline-none focus:border-primary/50"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">Status:</span>
          <span
            className={[
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px]',
              status === 'active'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                : status === 'paused'
                  ? 'border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] text-[var(--st-warning)]'
                  : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)]',
            ].join(' ')}
          >
            {status}
          </span>
        </div>
        <div className="grid gap-2 rounded-lg border border-[var(--color-card-border)] p-2 md:grid-cols-4">
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]">
            <input type="checkbox" checked={quietHours.enabled} onChange={(e) => setQuietHours((value) => ({ ...value, enabled: e.target.checked }))} />
            Quiet hours
          </label>
          <label className="text-[11px] text-[var(--color-pib-text-muted)]">
            Starts
            <input aria-label="Quiet hours start" type="time" value={`${String(Math.floor(quietHours.startMinuteLocal / 60)).padStart(2, '0')}:${String(quietHours.startMinuteLocal % 60).padStart(2, '0')}`} onChange={(e) => { const [hour, minute] = e.target.value.split(':').map(Number); setQuietHours((value) => ({ ...value, startMinuteLocal: hour * 60 + minute })) }} className="mt-1 h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs" />
          </label>
          <label className="text-[11px] text-[var(--color-pib-text-muted)]">
            Ends
            <input aria-label="Quiet hours end" type="time" value={`${String(Math.floor(quietHours.endMinuteLocal / 60)).padStart(2, '0')}:${String(quietHours.endMinuteLocal % 60).padStart(2, '0')}`} onChange={(e) => { const [hour, minute] = e.target.value.split(':').map(Number); setQuietHours((value) => ({ ...value, endMinuteLocal: hour * 60 + minute })) }} className="mt-1 h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs" />
          </label>
          <label className="text-[11px] text-[var(--color-pib-text-muted)]">
            Timezone
            <select aria-label="Quiet hours timezone" value={quietHours.timezoneMode} onChange={(e) => setQuietHours((value) => ({ ...value, timezoneMode: e.target.value as SequenceQuietHours['timezoneMode'] }))} className="mt-1 h-8 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-xs">
              <option value="recipient">Each recipient</option>
              <option value="organization">Organisation</option>
            </select>
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-[var(--color-card-border)] p-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors',
              tab === t.id
                ? 'border-primary/30 bg-primary/10 text-[var(--color-pib-text)]'
                : 'border-[var(--color-card-border)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.03]',
            ].join(' ')}
          >
            <Icon name={t.icon} className="text-[15px]" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'steps' && <SequenceStepBuilder steps={steps} onChange={setSteps} />}
      {tab === 'trigger' && <TriggerConfigPanel value={trigger} onChange={setTrigger} endpoint={endpoint} />}
      {tab === 'preview' && (
        <>
          <EnrollmentPreview steps={stepsForSave} />
          {sequenceId && <SequenceDeadLetterControl sequenceId={sequenceId} endpoint={endpoint} />}
        </>
      )}

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
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2.5 text-xs text-[var(--color-pib-text-muted)] hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:opacity-50"
        >
          <Icon name="save" className="text-[16px]" />
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={() => handleSave('active')}
          disabled={saving}
          className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black disabled:opacity-50"
        >
          <Icon name="rocket_launch" className="text-[16px]" />
          Save &amp; activate
        </button>
        <button type="button" onClick={onDone} disabled={saving} className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          Cancel
        </button>
      </div>
    </div>
  )
}
