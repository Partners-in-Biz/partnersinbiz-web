'use client'

import { useState } from 'react'
import type { Sequence, SequenceStep, SequenceStatus } from '@/lib/sequences/types'

// ── Input class helper ────────────────────────────────────────────────────────

const inputCls =
  'w-full text-sm px-3 py-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] text-[var(--color-pib-text)] placeholder-[var(--color-pib-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-pib-accent)]'

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

  return (
    <div className="bento-card !p-4 mb-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-semibold text-[var(--color-pib-text-muted)] uppercase tracking-wide">
          Step {index + 1}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            className="cursor-pointer w-6 h-6 flex items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            className="cursor-pointer w-6 h-6 flex items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_downward</span>
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove step"
            className="cursor-pointer w-6 h-6 flex items-center justify-center rounded text-[var(--color-pib-text-muted)] hover:text-red-400 hover:bg-red-400/[0.08] transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Channel + delay */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">Channel</label>
            <select
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
              placeholder="Hi {{firstName}}, your message here…"
              value={step.smsBody ?? ''}
              onChange={(e) => onChange({ ...step, smsBody: e.target.value })}
              className={`${inputCls} resize-y`}
            />
          </div>
        )}
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

      const returnedSeq: Sequence = (body as { data?: Sequence }).data ?? (body as Sequence)
      onSave(returnedSeq)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Section 1: Details ── */}
      <div className="bento-card !p-6">
        <p className="eyebrow !text-[10px] mb-4">Details</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
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
              placeholder="Optional description of this sequence's purpose"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--color-pib-text-muted)] mb-1">Status</label>
            <select
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
        <p className="eyebrow !text-[10px] mb-4">Email Steps</p>

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
          <span className="material-symbols-outlined text-[16px]">add</span>
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
          <span className="material-symbols-outlined text-[16px]">save</span>
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
  )
}
