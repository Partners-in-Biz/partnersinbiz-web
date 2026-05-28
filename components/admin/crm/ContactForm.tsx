// components/admin/crm/ContactForm.tsx
'use client'
import { useState } from 'react'

const STAGES = ['new','contacted','replied','demo','proposal','won','lost'] as const
const TYPES = ['lead','prospect','client','churned'] as const
const SOURCES = ['manual','form','import','outreach'] as const
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
  company: string
  website: string
  source: string
  type: string
  stage: string
  agreementRoles: string[]
  tagsInput: string
  notes: string
}

type ContactTextField = Exclude<keyof ContactFormState, 'agreementRoles'>

interface ContactFormProps {
  onSave: (data: Record<string, unknown>) => Promise<void>
  onCancel: () => void
  initial?: Record<string, unknown>
}

export function ContactForm({ onSave, onCancel, initial = {} }: ContactFormProps) {
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
    company: String(initial.company ?? ''),
    website: String(initial.website ?? ''),
    source: String(initial.source ?? 'manual'),
    type: String(initial.type ?? 'lead'),
    stage: String(initial.stage ?? 'new'),
    agreementRoles: initialRoles,
    tagsInput: initialTags,
    notes: String(initial.notes ?? ''),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const { tagsInput, ...payload } = form
      await onSave({ ...payload, tags: splitTags(tagsInput) })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: ContactTextField, type = 'text') => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="pib-input"
      />
    </div>
  )

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
      {field('Company', 'company')}
      {field('Website', 'website')}
      {select('Source', 'source', SOURCES)}
      {select('Type', 'type', TYPES)}
      {select('Stage', 'stage', STAGES)}
      <div className="flex flex-col gap-1">
        <label htmlFor="admin-crm-contact-tags" className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          Tags
        </label>
        <input
          id="admin-crm-contact-tags"
          type="text"
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
        <label className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Notes</label>
        <textarea
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
        >
          {saving ? 'Saving…' : 'Save Contact'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="pib-btn-secondary flex-1 justify-center text-sm font-label"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
