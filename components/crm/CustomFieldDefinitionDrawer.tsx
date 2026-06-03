'use client'

import { useEffect, useState } from 'react'
import type { CustomFieldDefinition, CustomFieldType, CustomFieldDropdownOption } from '@/lib/customFields/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CustomFieldDefinitionDrawerProps {
  definition?: Partial<CustomFieldDefinition>
  resource: 'contact' | 'deal' | 'company'
  mode: 'create' | 'edit'
  open: boolean
  onSave: (def: Partial<CustomFieldDefinition>) => Promise<void>
  onClose: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_TYPES: CustomFieldType[] = [
  'text', 'longtext', 'number', 'currency',
  'date', 'datetime',
  'dropdown', 'multi_select',
  'checkbox',
  'url', 'email', 'phone',
]

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  longtext: 'Long Text',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  datetime: 'Date & Time',
  dropdown: 'Dropdown',
  multi_select: 'Multi-select',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
}

const KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/
const KEY_FORMAT_MESSAGE = 'Start with a letter, then use lowercase letters, numbers, or underscores. Keep it under 40 characters.'

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
}

function Field({ label, htmlFor, required, error, children }: {
  label: string
  htmlFor?: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-label text-[var(--color-pib-text-muted)]">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function SectionDivider({ title }: { title: string }) {
  return (
    <div className="pt-4 pb-1 border-t border-[var(--color-pib-line)]">
      <p className="text-[10px] font-label uppercase tracking-wider text-[var(--color-pib-text-muted)]">{title}</p>
    </div>
  )
}

// ── Options editor ────────────────────────────────────────────────────────────

function OptionsEditor({
  options,
  onChange,
}: {
  options: CustomFieldDropdownOption[]
  onChange: (next: CustomFieldDropdownOption[]) => void
}) {
  function addOption() {
    onChange([...options, { value: `option_${options.length + 1}`, label: '' }])
  }

  function removeOption(idx: number) {
    onChange(options.filter((_, i) => i !== idx))
  }

  function updateOption(idx: number, field: keyof CustomFieldDropdownOption, val: string) {
    onChange(options.map((o, i) => i === idx ? { ...o, [field]: val } : o))
  }

  return (
    <div className="space-y-2">
      {options.map((opt, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="text"
            aria-label={`Option ${idx + 1} label`}
            placeholder="Label"
            value={opt.label}
            onChange={(e) => updateOption(idx, 'label', e.target.value)}
            className="pib-input flex-1"
          />
          <input
            type="text"
            aria-label={`Option ${idx + 1} value`}
            placeholder="Value"
            value={opt.value}
            onChange={(e) => updateOption(idx, 'value', e.target.value)}
            className="pib-input flex-1"
          />
          <input
            type="color"
            aria-label={`Option ${idx + 1} color`}
            value={opt.color ?? '#888888'}
            onChange={(e) => updateOption(idx, 'color', e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0"
          />
          <button
            type="button"
            onClick={() => removeOption(idx)}
            aria-label={`Remove option ${idx + 1}`}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-red-400 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        className="cursor-pointer text-xs text-[var(--color-accent-v2)] hover:underline flex items-center gap-1"
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
        Add option
      </button>
    </div>
  )
}

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  label: string
  key: string
  helpText: string
  group: string
  type: CustomFieldType
  required: boolean
  options: CustomFieldDropdownOption[]
  minLength: string
  maxLength: string
  min: string
  max: string
  currencyCode: string
}

function defToForm(def: Partial<CustomFieldDefinition>): FormState {
  return {
    label: def.label ?? '',
    key: def.key ?? '',
    helpText: def.helpText ?? '',
    group: def.group ?? '',
    type: def.type ?? 'text',
    required: def.required ?? false,
    options: def.options ?? [],
    minLength: def.minLength != null ? String(def.minLength) : '',
    maxLength: def.maxLength != null ? String(def.maxLength) : '',
    min: def.min != null ? String(def.min) : '',
    max: def.max != null ? String(def.max) : '',
    currencyCode: def.currencyCode ?? 'USD',
  }
}

function formToDef(f: FormState, resource: string): Partial<CustomFieldDefinition> {
  const out: Partial<CustomFieldDefinition> = {
    label: f.label.trim(),
    key: f.key.trim(),
    helpText: f.helpText.trim() || undefined,
    group: f.group.trim() || undefined,
    type: f.type,
    resource: resource as 'contact' | 'deal' | 'company',
    required: f.required,
  }
  if (f.type === 'dropdown' || f.type === 'multi_select') {
    out.options = f.options
  }
  if (f.type === 'text' || f.type === 'longtext') {
    if (f.minLength) out.minLength = parseInt(f.minLength, 10)
    if (f.maxLength) out.maxLength = parseInt(f.maxLength, 10)
  }
  if (f.type === 'number' || f.type === 'currency') {
    if (f.min) out.min = parseFloat(f.min)
    if (f.max) out.max = parseFloat(f.max)
  }
  if (f.type === 'currency') {
    out.currencyCode = f.currencyCode.trim() || 'USD'
  }
  return out
}

// ── Public component ──────────────────────────────────────────────────────────

export function CustomFieldDefinitionDrawer({
  definition,
  resource,
  mode,
  open,
  onSave,
  onClose,
}: CustomFieldDefinitionDrawerProps) {
  const [form, setForm] = useState<FormState>(() => defToForm(definition ?? {}))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [saving, setSaving] = useState(false)
  const [keyTouched, setKeyTouched] = useState(mode === 'edit')

  useEffect(() => {
    if (open) {
      setForm(defToForm(definition ?? {}))
      setErrors({})
      setKeyTouched(mode === 'edit')
    }
  }, [open, definition, mode])

  function set<K extends keyof FormState>(field: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [field]: val }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  function handleLabelChange(label: string) {
    setForm((f) => {
      const next: FormState = { ...f, label }
      if (!keyTouched) {
        next.key = deriveKey(label)
      }
      return next
    })
    if (errors.label) setErrors((e) => ({ ...e, label: undefined }))
  }

  function handleKeyChange(key: string) {
    set('key', key)
    setKeyTouched(true)
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof FormState, string>> = {}
    if (!form.label.trim()) newErrors.label = 'Label is required'
    if (!form.key.trim()) {
      newErrors.key = 'Key is required'
    } else if (!KEY_REGEX.test(form.key.trim())) {
      newErrors.key = KEY_FORMAT_MESSAGE
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      await onSave(formToDef(form, resource))
      onClose()
    } catch (err: unknown) {
      // Surface per-field errors from 400 response
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

  const title = mode === 'create' ? `New ${resource} field` : `Edit field`
  const needsOptions = form.type === 'dropdown' || form.type === 'multi_select'
  const needsTextConstraints = form.type === 'text' || form.type === 'longtext'
  const needsNumericConstraints = form.type === 'number' || form.type === 'currency'

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg h-full bg-[var(--color-pib-surface)] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-pib-line)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-pib-text)]">{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title} drawer`}
            onClick={onClose}
            className="cursor-pointer text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Scrollable form */}
        <form onSubmit={handleSubmit} id="cfd-form" className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Identity */}
          <Field label="Label" htmlFor="cfd-label" required error={errors.label}>
            <input
              id="cfd-label"
              type="text"
              value={form.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. Contract Start Date"
              className="pib-input w-full"
            />
          </Field>

          <Field label="Key" htmlFor="cfd-key" required error={errors.key}>
            <input
              id="cfd-key"
              type="text"
              value={form.key}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder="e.g. contract_start_date"
              className="pib-input w-full font-mono text-sm"
            />
            <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
              Lowercase letters, numbers, underscores. Max 40 chars.
            </p>
          </Field>

          <Field label="Help text" htmlFor="cfd-help">
            <input
              id="cfd-help"
              type="text"
              value={form.helpText}
              onChange={(e) => set('helpText', e.target.value)}
              placeholder="Shown below the input"
              className="pib-input w-full"
            />
          </Field>

          <Field label="Group" htmlFor="cfd-group">
            <input
              id="cfd-group"
              type="text"
              value={form.group}
              onChange={(e) => set('group', e.target.value)}
              placeholder="e.g. Billing, Compliance"
              className="pib-input w-full"
            />
          </Field>

          {/* Type */}
          <SectionDivider title="Type" />
          <Field label="Field type" htmlFor="cfd-type" required>
            <div className="relative group/type">
              <select
                id="cfd-type"
                value={form.type}
                onChange={(e) => set('type', e.target.value as CustomFieldType)}
                disabled={mode === 'edit'}
                className="pib-input w-full disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {ALL_TYPES.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              {mode === 'edit' && (
                <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-[var(--color-pib-text-muted)] pointer-events-none hidden group-hover/type:block">
                  Type cannot be changed after creation
                </span>
              )}
            </div>
          </Field>

          {/* Required */}
          <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--color-pib-text)]">
            <input
              type="checkbox"
              checked={form.required}
              onChange={(e) => set('required', e.target.checked)}
              className="cursor-pointer"
            />
            Required field
          </label>

          {/* Options editor */}
          {needsOptions && (
            <>
              <SectionDivider title="Options" />
              <OptionsEditor
                options={form.options}
                onChange={(opts) => set('options', opts)}
              />
            </>
          )}

          {/* Text constraints */}
          {needsTextConstraints && (
            <>
              <SectionDivider title="Constraints" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min length" htmlFor="cfd-minlen">
                  <input
                    id="cfd-minlen"
                    type="number"
                    min={0}
                    value={form.minLength}
                    onChange={(e) => set('minLength', e.target.value)}
                    className="pib-input w-full"
                  />
                </Field>
                <Field label="Max length" htmlFor="cfd-maxlen">
                  <input
                    id="cfd-maxlen"
                    type="number"
                    min={0}
                    value={form.maxLength}
                    onChange={(e) => set('maxLength', e.target.value)}
                    className="pib-input w-full"
                  />
                </Field>
              </div>
            </>
          )}

          {/* Numeric constraints */}
          {needsNumericConstraints && (
            <>
              <SectionDivider title="Constraints" />
              {form.type === 'currency' && (
                <Field label="Currency code" htmlFor="cfd-currency">
                  <input
                    id="cfd-currency"
                    type="text"
                    value={form.currencyCode}
                    maxLength={3}
                    onChange={(e) => set('currencyCode', e.target.value.toUpperCase())}
                    placeholder="USD"
                    className="pib-input w-24 uppercase"
                  />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min value" htmlFor="cfd-min">
                  <input
                    id="cfd-min"
                    type="number"
                    value={form.min}
                    onChange={(e) => set('min', e.target.value)}
                    className="pib-input w-full"
                  />
                </Field>
                <Field label="Max value" htmlFor="cfd-max">
                  <input
                    id="cfd-max"
                    type="number"
                    value={form.max}
                    onChange={(e) => set('max', e.target.value)}
                    className="pib-input w-full"
                  />
                </Field>
              </div>
            </>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-pib-line)] shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cancel ${title}`}
            className="cursor-pointer btn-pib-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="cfd-form"
            disabled={saving}
            aria-label="Save field"
            className="cursor-pointer btn-pib-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
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
