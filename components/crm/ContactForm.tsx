// components/crm/ContactForm.tsx
'use client'
import { useState } from 'react'

const STAGES = ['new','contacted','replied','demo','proposal','won','lost'] as const
const TYPES = ['lead','prospect','client','churned'] as const
const SOURCES = ['manual','form','import','outreach'] as const
// Subscription status (US-052) — mapped to subscribedAt/unsubscribedAt/bouncedAt server-side.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'bounced', label: 'Bounced' },
] as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AGREEMENT_ROLES = [
  { value: 'primary_contact', label: 'Primary contact' },
  { value: 'accounts_contact', label: 'Accounts contact' },
  { value: 'authorized_signatory', label: 'Authorised signatory' },
  { value: 'approval_contact', label: 'Approval contact' },
] as const

type ContactFormState = {
  name: string
  email: string
  phone: string
  jobTitle: string
  department: string
  timezone: string
  company: string
  website: string
  assignedTo: string
  source: string
  type: string
  stage: string
  status: string
  agreementRoles: string[]
  tagsInput: string
  notes: string
}

type ContactTextField = Exclude<keyof ContactFormState, 'agreementRoles'>

interface ContactFormProps {
  /**
   * Persists the contact. May resolve with the created contact's id; when it
   * does and `redirectTo` is supplied, the form navigates to the detail page.
   */
  onSave: (data: Record<string, unknown>) => Promise<void | { id?: string } | null | undefined>
  onCancel: () => void
  initial?: Record<string, unknown>
  contextName?: string
  /** When provided alongside an `onSave` that returns an id, navigate here on success (US-052). */
  redirectTo?: (id: string) => string
}

function deriveInitialStatus(initial: Record<string, unknown>): string {
  if (initial.bouncedAt) return 'bounced'
  if (initial.unsubscribedAt) return 'unsubscribed'
  if (typeof initial.status === 'string' && initial.status) return initial.status
  return 'active'
}

export function ContactForm({ onSave, onCancel, initial = {}, contextName, redirectTo }: ContactFormProps) {
  const initialRoles = Array.isArray(initial.agreementRoles)
    ? initial.agreementRoles.filter((role): role is string => typeof role === 'string')
    : []
  const initialTags = Array.isArray(initial.tags)
    ? initial.tags.filter((tag): tag is string => typeof tag === 'string').join(', ')
    : ''
  const [form, setForm] = useState<ContactFormState>({
    name: String(initial.name ?? ''),
    email: String(initial.email ?? ''),
    phone: String(initial.phone ?? ''),
    jobTitle: String(initial.jobTitle ?? ''),
    department: String(initial.department ?? ''),
    timezone: String(initial.timezone ?? ''),
    company: String(initial.company ?? ''),
    website: String(initial.website ?? ''),
    assignedTo: String(initial.assignedTo ?? ''),
    source: String(initial.source ?? 'manual'),
    type: String(initial.type ?? 'lead'),
    stage: String(initial.stage ?? 'new'),
    status: deriveInitialStatus(initial),
    agreementRoles: initialRoles,
    tagsInput: initialTags,
    notes: String(initial.notes ?? ''),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Per-field validation errors keyed by field, surfaced inline (US-052).
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ContactTextField, string>>>({})
  const context = contextName?.trim()

  function validate(state: ContactFormState): Partial<Record<ContactTextField, string>> {
    const errs: Partial<Record<ContactTextField, string>> = {}
    if (!state.name.trim()) errs.name = 'Name is required'
    if (!state.email.trim()) errs.email = 'Email is required'
    else if (!EMAIL_RE.test(state.email.trim())) errs.email = 'Enter a valid email address'
    return errs
  }

  function clearFieldError(key: ContactTextField) {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }
  const contextualLabel = (label: string) => {
    if (!context) return undefined
    return `${label} for ${context}`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate(form)
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      setError('')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { tagsInput, ...payload } = form
      const result = await onSave({
        ...payload,
        companyId: initial.companyId,
        companyName: initial.companyName,
        tags: splitTags(tagsInput),
      })
      const newId = result && typeof result === 'object' && typeof result.id === 'string' ? result.id : ''
      if (newId && redirectTo) {
        window.location.assign(redirectTo(newId))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: ContactTextField, type = 'text') => {
    const id = `crm-contact-${key}`
    const cleanLabel = label.replace(/\s*\*$/, '')
    const fieldError = fieldErrors[key]
    const errorId = `${id}-error`
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</label>
        <input
          id={id}
          type={type}
          aria-label={contextualLabel(`Contact ${cleanLabel.toLowerCase()}`)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? errorId : undefined}
          value={form[key]}
          onChange={(e) => {
            const value = e.target.value
            setForm((f) => ({ ...f, [key]: value }))
            clearFieldError(key)
          }}
          className="pib-input"
        />
        {fieldError && (
          <p id={errorId} role="alert" className="text-[11px]" style={{ color: 'var(--color-accent)' }}>
            {fieldError}
          </p>
        )}
      </div>
    )
  }

  function splitTags(value: string): string[] {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  const select = (label: string, key: ContactTextField, options: readonly string[]) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</label>
      <select
        aria-label={contextualLabel(`Contact ${label.toLowerCase()}`)}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="pib-input"
      >
        {options.map((o) => <option key={o} value={o} className="bg-black">{o}</option>)}
      </select>
    </div>
  )

  function toggleAgreementRole(role: string) {
    setForm((f) => ({
      ...f,
      agreementRoles: f.agreementRoles.includes(role)
        ? f.agreementRoles.filter((item) => item !== role)
        : [...f.agreementRoles, role],
    }))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6">
      {field('Name *', 'name')}
      {field('Email *', 'email', 'email')}
      {field('Phone', 'phone')}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('Job title', 'jobTitle')}
        {field('Department', 'department')}
      </div>
      {field('Timezone', 'timezone')}
      {field('Company', 'company')}
      {field('Website', 'website')}
      {field('Owner', 'assignedTo')}
      {select('Source', 'source', SOURCES)}
      {select('Type', 'type', TYPES)}
      {select('Stage', 'stage', STAGES)}
      <div className="flex flex-col gap-1">
        <label htmlFor="crm-contact-status" className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Status</label>
        <select
          id="crm-contact-status"
          aria-label={contextualLabel('Contact status')}
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          className="pib-input"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-black">{o.label}</option>)}
        </select>
        <p className="text-[11px] text-on-surface-variant">Sets the subscription state — Unsubscribed and Bounced exclude this contact from marketing sends.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="admin-crm-contact-tags" className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          Tags
        </label>
        <input
          id="admin-crm-contact-tags"
          type="text"
          aria-label={contextualLabel('Contact tags')}
          value={form.tagsInput}
          onChange={(e) => setForm((f) => ({ ...f, tagsInput: e.target.value }))}
          placeholder="vip, newsletter, key-account"
          className="pib-input"
        />
        <p className="text-[11px] text-on-surface-variant">Separate tags with commas so saved views, filters, and automation segments stay accurate.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Agreement roles</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {AGREEMENT_ROLES.map((role) => (
            <label key={role.value} className="flex items-center gap-2 rounded-md border border-outline-variant/60 px-3 py-2 text-xs text-on-surface-variant">
              <input
                type="checkbox"
                aria-label={contextualLabel(`${role.label} role`)}
                checked={form.agreementRoles.includes(role.value)}
                onChange={() => toggleAgreementRole(role.value)}
                className="h-4 w-4 rounded border-outline text-primary"
              />
              <span>{role.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="crm-contact-notes" className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notes</label>
        <textarea
          id="crm-contact-notes"
          aria-label={contextualLabel('Contact notes')}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={3}
          className="pib-input resize-none"
        />
      </div>
      {error && <p className="text-[11px]" style={{ color: 'var(--color-accent)' }}>{error}</p>}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="pib-btn-primary flex-1 justify-center text-sm font-label disabled:opacity-40"
          aria-label={contextualLabel('Save contact')}
        >
          {saving ? 'Saving…' : 'Save Contact'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="pib-btn-secondary flex-1 justify-center text-sm font-label"
          aria-label={contextualLabel('Cancel contact')}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
