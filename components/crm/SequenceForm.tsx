'use client'

import { useState } from 'react'
import type { Sequence, SequenceStep, SequenceStatus } from '@/lib/sequences/types'
import { validateSequenceActivation } from '@/lib/sequences/validation'

// ── Input class helper ────────────────────────────────────────────────────────

const inputCls =
  'w-full text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]'

function stepChannel(step: SequenceStep) {
  return step.channel === 'sms' ? 'sms' : 'email'
}

function stepReady(step: SequenceStep) {
  if (stepChannel(step) === 'sms') return Boolean(step.smsBody?.trim())
  return Boolean(step.subject?.trim() && (step.bodyHtml?.trim() || step.bodyText?.trim()))
}

function describeCadence(steps: SequenceStep[]) {
  if (!steps.length) return 'No steps configured'
  const totalDays = steps.reduce((sum, step) => sum + Math.max(0, Number(step.delayDays) || 0), 0)
  if (totalDays === 0) return 'same-day journey'
  return `${totalDays} day${totalDays === 1 ? '' : 's'} from first to last touch`
}

// ── StepRow ───────────────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: SequenceStep
  index: number
  total: number
  onChange: (updated: SequenceStep) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const isSms = step.channel === 'sms'
  const stepNumber = index + 1

  return (
    <div className="bento-card !p-4 mb-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wide">
            Step {index + 1}
          </span>
          <p className="mt-1 truncate text-[11px] text-[var(--color-pib-text-muted)]">
            {stepChannel(step).toUpperCase()} · day {Math.max(0, Number(step.delayDays) || 0)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            aria-label={`Move step ${stepNumber} up`}
            className="cursor-pointer w-6 h-6 flex items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_upward</span>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            aria-label={`Move step ${stepNumber} down`}
            className="cursor-pointer w-6 h-6 flex items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">arrow_downward</span>
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove step"
            aria-label={`Remove step ${stepNumber}`}
            className="cursor-pointer w-6 h-6 flex items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Channel + delay */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">Channel</label>
            <select
              aria-label={`Step ${stepNumber} channel`}
              value={step.channel ?? 'email'}
              onChange={(e) =>
                onChange({ ...step, channel: e.target.value as 'email' | 'sms' })
              }
              className={inputCls}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div className="w-32">
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
              Send after N days
            </label>
            <input
              type="number"
              aria-label={`Step ${stepNumber} send delay in days`}
              min={0}
              value={step.delayDays}
              onChange={(e) =>
                onChange({ ...step, delayDays: Math.max(0, Number(e.target.value)) })
              }
              className={inputCls}
            />
          </div>
        </div>

        {/* Email fields */}
        {!isSms && (
          <>
            <div>
              <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
                Subject <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label={`Step ${stepNumber} email subject`}
                placeholder="Email subject line"
                value={step.subject}
                onChange={(e) => onChange({ ...step, subject: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
                Email body (HTML)
              </label>
              <textarea
                rows={8}
                aria-label={`Step ${stepNumber} email body`}
                placeholder="<p>Hello {{firstName}},</p>"
                value={step.bodyHtml}
                onChange={(e) => onChange({ ...step, bodyHtml: e.target.value })}
                className={`${inputCls} resize-y`}
              />
            </div>
          </>
        )}

        {/* SMS field */}
        {isSms && (
          <div>
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
              SMS body <span className="text-red-400">*</span>
            </label>
            <textarea
              rows={4}
              aria-label={`Step ${stepNumber} SMS body`}
              placeholder="Hi {{firstName}}, your message here…"
              value={step.smsBody ?? ''}
              onChange={(e) => onChange({ ...step, smsBody: e.target.value })}
              className={`${inputCls} resize-y`}
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--color-pib-text-muted)]">
        <span className={stepReady(step) ? 'h-2 w-2 rounded-full bg-emerald-400' : 'h-2 w-2 rounded-full bg-amber-400'} />
        {stepReady(step) ? 'Ready to send' : 'Needs subject/body copy before launch'}
      </div>
    </div>
  )
}

// ── Default step ──────────────────────────────────────────────────────────────

function blankStep(index: number): SequenceStep {
  return {
    stepNumber: index,
    delayDays: index === 0 ? 0 : 1,
    subject: '',
    bodyHtml: '',
    bodyText: '',
    channel: 'email',
  }
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  initial?: Partial<Sequence>
  onSave: (seq: Sequence) => void
  onCancel: () => void
}

// ── SequenceForm ──────────────────────────────────────────────────────────────

export function SequenceForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [status, setStatus] = useState<SequenceStatus>(initial?.status ?? 'draft')
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial?.steps && initial.steps.length > 0 ? initial.steps : [blankStep(0)]
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const isEdit = Boolean(initial?.id)
  const readySteps = steps.filter(stepReady).length
  const emailSteps = steps.filter((step) => stepChannel(step) === 'email').length
  const smsSteps = steps.filter((step) => stepChannel(step) === 'sms').length
  const firstTouch = steps[0]
    ? stepChannel(steps[0]) === 'sms'
      ? steps[0].smsBody?.trim() || 'SMS body missing'
      : steps[0].subject?.trim() || 'Email subject missing'
    : 'No first touch configured'

  // ── Step helpers ───────────────────────────────────────────────────────────

  function addStep() {
    setSteps((prev) => [...prev, blankStep(prev.length)])
  }

  function updateStep(index: number, updated: SequenceStep) {
    setSteps((prev) => prev.map((s, i) => (i === index ? updated : s)))
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    setSteps((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  // ── Validate + save ────────────────────────────────────────────────────────

  async function handleSubmit() {
    setValidationError(null)
    setSaveError(null)

    if (!name.trim()) {
      setValidationError('Sequence name is required.')
      return
    }
    if (steps.length === 0) {
      setValidationError('Add at least one step.')
      return
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      if (s.channel === 'sms') {
        if (!s.smsBody?.trim()) {
          setValidationError(`Step ${i + 1}: SMS body is required.`)
          return
        }
      } else {
        if (!s.subject.trim()) {
          setValidationError(`Step ${i + 1}: Subject is required.`)
          return
        }
      }
    }

    // Assign stepNumbers from array position
    const numberedSteps: SequenceStep[] = steps.map((s, i) => ({ ...s, stepNumber: i }))
    const activationError = validateSequenceActivation({ status, steps: numberedSteps })
    if (activationError) {
      setValidationError(activationError)
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        status,
        steps: numberedSteps,
        orgId: initial?.orgId ?? '',
        goals: initial?.goals ?? [],
        topicId: initial?.topicId,
      }

      const url = isEdit
        ? `/api/v1/crm/sequences/${initial!.id}`
        : '/api/v1/crm/sequences'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)

      const returnedSeq: Sequence =
        (body as { data?: { sequence?: Sequence } }).data?.sequence ??
        (body as { data?: Sequence }).data ??
        (body as Sequence)
      onSave(returnedSeq)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
      {/* ── Section 1: Details ── */}
      <div className="bento-card !p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow !text-[10px]">Journey identity</p>
            <h2 className="mt-2 text-sm font-semibold">Name the follow-up outcome</h2>
          </div>
          <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">route</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              aria-label="Sequence name"
              placeholder="e.g. New lead welcome sequence"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
              Description
            </label>
            <textarea
              rows={2}
              aria-label="Sequence description"
              placeholder="Optional description of this sequence's purpose"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">Status</label>
            <select
              aria-label="Sequence status"
              value={status}
              onChange={(e) => setStatus(e.target.value as SequenceStatus)}
              className={inputCls}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Section 2: Steps ── */}
      <div className="bento-card !p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow !text-[10px]">Journey steps</p>
            <h2 className="mt-2 text-sm font-semibold">Design the touchpoint path</h2>
          </div>
          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)]">
            {readySteps}/{steps.length} ready
          </span>
        </div>

        {steps.length === 0 && (
          <p className="text-sm text-[var(--color-pib-text-muted)] mb-3">
            No steps yet. Add one below.
          </p>
        )}

        {steps.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            index={i}
            total={steps.length}
            onChange={(updated) => updateStep(i, updated)}
            onRemove={() => removeStep(i)}
            onMoveUp={() => moveStep(i, -1)}
            onMoveDown={() => moveStep(i, 1)}
          />
        ))}

        <button
          type="button"
          onClick={addStep}
          className="cursor-pointer btn-pib-secondary text-sm flex items-center gap-1.5 mt-3"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          Add step
        </button>
      </div>

      {/* ── Validation / save errors ── */}
      {(validationError ?? saveError) && (
        <p className="text-sm text-red-400 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">error</span>
          {validationError ?? saveError}
        </p>
      )}

      {/* ── Footer buttons ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="cursor-pointer btn-pib-accent flex items-center gap-1.5 text-sm disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">save</span>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create sequence'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="cursor-pointer btn-pib-secondary text-sm disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div className="bento-card !p-5">
          <p className="eyebrow !text-[10px]">Sequence preview</p>
          <h2 className="mt-2 text-sm font-semibold">{name.trim() || 'Untitled sequence'}</h2>
          <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
            {status === 'active' ? 'Active' : status === 'paused' ? 'Paused' : 'Draft'} journey with{' '}
            <span className="text-[var(--color-pib-text)]">{steps.length} step{steps.length === 1 ? '' : 's'}</span> over{' '}
            <span className="text-[var(--color-pib-text)]">{describeCadence(steps)}</span>.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
              <p className="text-[10px] text-[var(--color-pib-text-muted)]">Ready</p>
              <p className="mt-1 text-lg font-semibold">{readySteps}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
              <p className="text-[10px] text-[var(--color-pib-text-muted)]">Email</p>
              <p className="mt-1 text-lg font-semibold">{emailSteps}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
              <p className="text-[10px] text-[var(--color-pib-text-muted)]">SMS</p>
              <p className="mt-1 text-lg font-semibold">{smsSteps}</p>
            </div>
          </div>
        </div>

        <div className="bento-card !p-5">
          <p className="eyebrow !text-[10px]">First touch</p>
          <p className="mt-3 line-clamp-3 text-sm">{firstTouch}</p>
          <div className="mt-4 space-y-2">
            {steps.map((step, index) => (
              <div key={`${step.stepNumber}-${index}`} className="flex items-center gap-3 rounded-lg border border-[var(--color-pib-line)] px-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-pib-line)] text-[10px]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {stepChannel(step) === 'sms' ? step.smsBody || 'SMS body missing' : step.subject || 'Subject missing'}
                  </p>
                  <p className="text-[10px] text-[var(--color-pib-text-muted)]">
                    {stepChannel(step).toUpperCase()} · day {Math.max(0, Number(step.delayDays) || 0)}
                  </p>
                </div>
                <span className={stepReady(step) ? 'h-2 w-2 rounded-full bg-emerald-400' : 'h-2 w-2 rounded-full bg-amber-400'} />
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
