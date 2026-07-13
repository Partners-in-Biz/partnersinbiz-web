'use client'

import { useEffect, useState } from 'react'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { StageEditor } from './StageEditor'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PipelineDrawerProps {
  pipeline?: Partial<Pipeline>
  mode: 'create' | 'edit'
  open: boolean
  onSave: (data: Partial<Pipeline>) => Promise<void>
  onClose: () => void
}

// ── Default stages for new pipelines ─────────────────────────────────────────

function defaultStages(): PipelineStage[] {
  return [
    { id: 'discovery',   label: 'Discovery',   kind: 'open', order: 0, probability: 10 },
    { id: 'proposal',    label: 'Proposal',    kind: 'open', order: 1, probability: 30 },
    { id: 'negotiation', label: 'Negotiation', kind: 'open', order: 2, probability: 60 },
    { id: 'won',         label: 'Won',         kind: 'won',  order: 3, probability: 100 },
    { id: 'lost',        label: 'Lost',        kind: 'lost', order: 4, probability: 0 },
  ]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, htmlFor, required, error, children }: {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="border-t border-[var(--color-card-border)] pt-3 pb-1">
      <p className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">{title}</p>
    </div>
  )
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  name: string
  description: string
  stages: PipelineStage[]
  isDefault: boolean
}

function pipelineToForm(p: Partial<Pipeline>): FormState {
  return {
    name: p.name ?? '',
    description: p.description ?? '',
    stages: p.stages?.length ? p.stages : defaultStages(),
    isDefault: p.isDefault ?? false,
  }
}

// ── Public component ──────────────────────────────────────────────────────────

export function PipelineDrawer({ pipeline, mode, open, onSave, onClose }: PipelineDrawerProps) {
  const [form, setForm] = useState<FormState>(() => pipelineToForm(pipeline ?? {}))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(pipelineToForm(pipeline ?? {}))
      setErrors({})
    }
  }, [open, pipeline])

  function set<K extends keyof FormState>(field: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [field]: val }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) newErrors.name = 'Name is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      await onSave({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        stages: form.stages,
        ...(mode === 'edit' ? { isDefault: form.isDefault } : {}),
      })
      onClose()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'details' in err) {
        const details = (err as { details: { key: string; message: string }[] }).details
        const fieldErrors: Partial<Record<keyof FormState, string>> = {}
        for (const d of details) {
          fieldErrors[d.key as keyof FormState] = d.message
        }
        setErrors(fieldErrors)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const title = mode === 'create' ? 'New pipeline' : 'Edit pipeline'

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-[var(--color-card-border)] bg-[var(--color-card)]">
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-card-border)] px-3">
          <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title} drawer`}
            onClick={onClose}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} id="pipeline-form" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          <Field label="Name" htmlFor="pipeline-name" required error={errors.name}>
            <input
              id="pipeline-name"
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Sales, Renewals, Onboarding"
              className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-on-surface placeholder:text-on-surface-variant"
            />
          </Field>

          <Field label="Description" htmlFor="pipeline-description">
            <textarea
              id="pipeline-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional description"
              rows={2}
              className="w-full resize-none rounded-md border border-[var(--color-card-border)] bg-transparent p-2 text-sm text-on-surface placeholder:text-on-surface-variant"
            />
          </Field>

          {/* isDefault toggle — edit mode only */}
          {mode === 'edit' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface">
              <input
                type="checkbox"
                aria-label="Set as default pipeline"
                checked={form.isDefault}
                onChange={(e) => set('isDefault', e.target.checked)}
                className="cursor-pointer"
              />
              Set as default pipeline
            </label>
          )}

          <SectionDivider title="Stages" />
          <StageEditor
            stages={form.stages}
            onChange={(next) => set('stages', next)}
          />
        </form>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-card-border)] px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cancel ${title}`}
            className="flex h-8 cursor-pointer items-center rounded-md border border-[var(--color-card-border)] px-2 text-xs text-on-surface-variant transition hover:bg-white/[0.05] hover:text-on-surface"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="pipeline-form"
            disabled={saving}
            aria-label="Save pipeline"
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
