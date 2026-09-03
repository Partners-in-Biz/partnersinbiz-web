'use client'

import { useEffect, useState } from 'react'
import type { Pipeline, PipelineStage } from '@/lib/pipelines/types'
import { StageEditor } from './StageEditor'
import { Icon } from '@/components/studio'

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
      <label htmlFor={htmlFor} className="pib-label">
        {label}{required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  )
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="border-t border-[var(--color-pib-line)] pt-3 pb-1">
      <p className="pib-label">{title}</p>
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
    <div className="pib-dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="pib-dialog-drawer relative w-full max-w-xl">
        {/* Header */}
        <div className="pib-dialog-header">
          <h2 className="pib-dialog-title">{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title} drawer`}
            onClick={onClose}
            className="pib-dialog-close cursor-pointer"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>

        {/* Scrollable form body */}
        <form onSubmit={handleSubmit} id="pipeline-form" className="pib-dialog-body space-y-4">
          <Field label="Name" htmlFor="pipeline-name" required error={errors.name}>
            <input
              id="pipeline-name"
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Sales, Renewals, Onboarding"
              aria-label="Pipeline name"
              className="pib-input h-9 w-full text-sm"
            />
          </Field>

          <Field label="Description" htmlFor="pipeline-description">
            <textarea
              id="pipeline-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional description"
              aria-label="Pipeline description"
              rows={2}
              className="pib-textarea w-full resize-none text-sm"
            />
          </Field>

          {/* isDefault toggle - edit mode only */}
          {mode === 'edit' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-pib-text)]">
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
        <div className="pib-dialog-footer justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cancel ${title}`}
            className="btn-pib-secondary h-8 px-3 text-xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="pipeline-form"
            disabled={saving}
            aria-label="Save pipeline"
            className="btn-pib-primary h-8 gap-1.5 px-3 text-xs"
          >
            {saving ? (
              <>
                <Icon name="progress_activity" className="text-[16px] animate-spin" />
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
