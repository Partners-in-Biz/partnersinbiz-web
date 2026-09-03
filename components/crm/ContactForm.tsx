// components/crm/ContactForm.tsx
'use client'
import { useState } from 'react'
import { ProfileLinksFields } from '@/components/crm/ProfileLinksFields'
import {
  contactPayloadFromValues,
  contactValuesFromRecord,
  sanitizeOtherLinks,
  type ProfileLink,
  type ProfileLinkFieldValues,
} from '@/lib/crm/profileLinks'

const STAGES = ['new','contacted','replied','demo','proposal','won','lost'] as const
const TYPES = ['lead','prospect','client','churned'] as const
const SOURCES = ['manual','form','import','outreach'] as const
// Subscription status (US-052) - mapped to subscribedAt/unsubscribedAt/bouncedAt server-side.
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
    assignedTo: String(initial.assignedTo ?? ''),
    source: String(initial.source ?? 'manual'),
    type: String(initial.type ?? 'lead'),
    stage: String(initial.stage ?? 'new'),
    status: deriveInitialStatus(initial),
    agreementRoles: initialRoles,
    tagsInput: initialTags,
    notes: String(initial.notes ?? ''),
  })
  const [profileLinks, setProfileLinks] = useState<ProfileLinkFieldValues>(() => contactValuesFromRecord(initial))
  const [otherLinks, setOtherLinks] = useState<ProfileLink[]>(() => sanitizeOtherLinks(initial.otherLinks) ?? [])
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
        ...contactPayloadFromValues(profileLinks),
        otherLinks: sanitizeOtherLinks(otherLinks) ?? [],
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
        <label htmlFor={id} className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</label>
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
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)]"
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
      <label className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</label>
      <select
        aria-label={contextualLabel(`Contact ${label.toLowerCase()}`)}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)]"
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
      {field('Name *', 'name')}
      {field('Email *', 'email', 'email')}
      {field('Phone', 'phone')}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('Job title', 'jobTitle')}
        {field('Department', 'department')}
      </div>
      {field('Timezone', 'timezone')}
      {field('Company', 'company')}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Links & profiles</p>
        <ProfileLinksFields
          idPrefix="crm-contact"
          ariaPrefix={context || undefined}
          values={profileLinks}
          otherLinks={otherLinks}
          onChange={setProfileLinks}
          onOtherLinksChange={setOtherLinks}
        />
      </div>
      {field('Owner', 'assignedTo')}
      {select('Source', 'source', SOURCES)}
      {select('Type', 'type', TYPES)}
      {select('Stage', 'stage', STAGES)}
      <div className="flex flex-col gap-1">
        <label htmlFor="crm-contact-status" className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Status</label>
        <select
          id="crm-contact-status"
          aria-label={contextualLabel('Contact status')}
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)]"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-black">{o.label}</option>)}
        </select>
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">Sets the subscription state - Unsubscribed and Bounced exclude this contact from marketing sends.</p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="admin-crm-contact-tags" className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
          Tags
        </label>
        <input
          id="admin-crm-contact-tags"
          type="text"
          aria-label={contextualLabel('Contact tags')}
          value={form.tagsInput}
          onChange={(e) => setForm((f) => ({ ...f, tagsInput: e.target.value }))}
          placeholder="vip, newsletter, key-account"
          className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-transparent px-2 text-sm text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-muted)]"
        />
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">Separate tags with commas so saved views, filters, and automation segments stay accurate.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Agreement roles</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {AGREEMENT_ROLES.map((role) => (
            <label key={role.value} className="flex items-center gap-2 rounded-md border border-[var(--color-card-border)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)]">
              <input
                type="checkbox"
                aria-label={contextualLabel(`${role.label} role`)}
                checked={form.agreementRoles.includes(role.value)}
                onChange={() => toggleAgreementRole(role.value)}
                className="h-4 w-4 rounded border-[var(--color-pib-line)] text-primary"
              />
              <span>{role.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="crm-contact-notes" className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Notes</label>
        <textarea
          id="crm-contact-notes"
          aria-label={contextualLabel('Contact notes')}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={3}
          className="w-full resize-none rounded-md border border-[var(--color-card-border)] bg-transparent p-2 text-sm text-[var(--color-pib-text)]"
        />
      </div>
      {error && <p className="text-[11px]" style={{ color: 'var(--color-accent)' }}>{error}</p>}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex h-9 flex-1 items-center justify-center rounded-md bg-[var(--color-accent-v2)] px-3 text-xs font-medium text-black transition disabled:opacity-40"
          aria-label={contextualLabel('Save contact')}
        >
          {saving ? 'Saving…' : 'Save Contact'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-9 flex-1 items-center justify-center rounded-md border border-[var(--color-card-border)] px-3 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
          aria-label={contextualLabel('Cancel contact')}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
