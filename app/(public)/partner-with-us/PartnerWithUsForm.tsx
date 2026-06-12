'use client'

import { FormEvent, useState } from 'react'
import { PARTNER_OPPORTUNITIES } from '@/lib/partner-opportunities'

type Status = 'idle' | 'loading' | 'success' | 'error'

type SelectedOpportunity = {
  id: string
  title: string
  sourcePath: string
}

const ACCESS_HANDOFF_OPTIONS = [
  { value: 'none', label: 'No login needed / public links only' },
  { value: 'demo_credentials', label: 'I can provide clearly labelled demo credentials' },
  { value: 'secure_handoff_needed', label: 'Actual login may be needed — arrange secure handoff' },
] as const

const DEFAULT_OPPORTUNITY: SelectedOpportunity = {
  id: PARTNER_OPPORTUNITIES[0].id,
  title: PARTNER_OPPORTUNITIES[0].title,
  sourcePath: '/partner-with-us',
}

const INPUT_CLASS =
  'rounded-xl border border-[var(--color-pib-line-strong)] bg-[var(--color-pib-surface)] px-4 py-3 text-[var(--color-pib-text)] outline-none transition placeholder:text-[var(--color-pib-text-faint)] focus:border-[var(--color-pib-accent)]'

export default function PartnerWithUsForm({ opportunity = DEFAULT_OPPORTUNITY }: { opportunity?: SelectedOpportunity }) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    companyLocation: '',
    links: '',
    accessHandoff: ACCESS_HANDOFF_OPTIONS[0].value,
    notes: '',
    consent: false,
  })

  function update(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('loading')
    setError('')

    const normalized = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      companyLocation: form.companyLocation.trim(),
      links: form.links.trim(),
      notes: form.notes.trim(),
    }

    const details = [
      `Partner With Us interest`,
      `Opportunity: ${opportunity.title} (${opportunity.id})`,
      `Source page: ${opportunity.sourcePath}`,
      normalized.companyLocation ? `Company / location: ${normalized.companyLocation}` : null,
      normalized.phone ? `Phone / WhatsApp: ${normalized.phone}` : null,
      normalized.links ? `Useful links: ${normalized.links}` : null,
      `Reviewer access handoff: ${form.accessHandoff}`,
      `Consent to follow up: ${form.consent ? 'yes' : 'no'}`,
      '',
      normalized.notes,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: normalized.name,
          email: normalized.email,
          phone: normalized.phone,
          company: normalized.companyLocation,
          website: normalized.links,
          projectType: 'partnership',
          details,
          interest: {
            type: 'partner-opportunity',
            opportunityId: opportunity.id,
            opportunityTitle: opportunity.title,
            notes: normalized.notes,
            consent: form.consent,
            source: opportunity.sourcePath,
            links: normalized.links,
            accessHandoff: form.accessHandoff,
          },
        }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Interest could not be registered')
      }

      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="bento-card p-8">
        <p className="eyebrow mb-4">Interest registered</p>
        <h2 className="text-2xl font-display text-[var(--color-pib-text)]">
          Thanks — we’ll review this exact opportunity and come back to you.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
          We captured your interest in {opportunity.title}. If real login details are needed, we’ll arrange a secure
          handoff instead of using this public form.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="bento-card p-6 md:p-8">
      <p className="eyebrow mb-4">Register interest</p>
      <h2 className="text-2xl font-display leading-tight text-[var(--color-pib-text)]">{opportunity.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
        Capture enough detail for a useful follow-up. Public links and demo credentials are fine; never paste real
        passwords here.
      </p>

      <div className="mt-8 grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(value) => update('name', value)} required />
          <Field label="Email" type="email" value={form.email} onChange={(value) => update('email', value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Phone / WhatsApp optional" value={form.phone} onChange={(value) => update('phone', value)} />
          <Field
            label="Company / location optional"
            value={form.companyLocation}
            onChange={(value) => update('companyLocation', value)}
            placeholder="Company, town, region, club network..."
          />
        </div>

        <label className="grid gap-2 text-sm text-[var(--color-pib-text-muted)]">
          Useful sites or links optional
          <input
            value={form.links}
            onChange={(event) => update('links', event.target.value)}
            placeholder="Public website, club page, group, demo URL, LinkedIn, portfolio..."
            className={INPUT_CLASS}
          />
        </label>

        <label className="grid gap-2 text-sm text-[var(--color-pib-text-muted)]">
          Reviewer access handoff
          <select
            value={form.accessHandoff}
            onChange={(event) => update('accessHandoff', event.target.value)}
            className={INPUT_CLASS}
          >
            {ACCESS_HANDOFF_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm text-[var(--color-pib-text-muted)]">
          Notes
          <textarea
            value={form.notes}
            onChange={(event) => update('notes', event.target.value)}
            required
            rows={5}
            placeholder="Tell us what you can unlock, where, who you can reach, and what kind of partnership you want."
            className={`resize-none ${INPUT_CLASS}`}
          />
        </label>

        <label className="flex gap-3 rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 text-sm leading-relaxed text-[var(--color-pib-text-muted)]">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(event) => update('consent', event.target.checked)}
            required
            className="mt-1 h-4 w-4 accent-[var(--color-pib-accent)]"
          />
          <span>I agree that Partners in Biz can contact me about this opportunity and store this interest request for follow-up.</span>
        </label>
      </div>

      {status === 'error' && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <button type="submit" disabled={status === 'loading'} className="btn-pib-accent mt-6 w-full justify-center disabled:cursor-not-allowed disabled:opacity-70">
        {status === 'loading' ? 'Registering...' : 'Register interest'}
        <span className="material-symbols-outlined text-base">send</span>
      </button>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2 text-sm text-[var(--color-pib-text-muted)]">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className={INPUT_CLASS}
      />
    </label>
  )
}
