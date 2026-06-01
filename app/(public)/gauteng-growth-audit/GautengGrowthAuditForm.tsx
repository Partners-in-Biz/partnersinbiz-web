'use client'

import { useState } from 'react'

type Status = 'idle' | 'loading' | 'success' | 'error'

interface FormState {
  name: string
  email: string
  businessLink: string
  whatsapp: string
  challenge: string
}

const INITIAL: FormState = {
  name: '',
  email: '',
  businessLink: '',
  whatsapp: '',
  challenge: '',
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export default function GautengGrowthAuditForm() {
  const [data, setData] = useState<FormState>(INITIAL)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setData((current) => ({ ...current, [key]: value }))
  }

  function isComplete() {
    return Object.values(data).every((value) => value.trim().length > 0)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')

    if (!isComplete()) {
      setStatus('error')
      setMessage('Please add your name, email, business link, WhatsApp number, and biggest challenge.')
      return
    }

    if (!isValidEmail(data.email.trim())) {
      setStatus('error')
      setMessage('Please use a valid email address so we can send the audit summary.')
      return
    }

    setStatus('loading')

    const details = [
      'Gauteng Growth Audit request',
      '',
      `Business and online link: ${data.businessLink.trim()}`,
      `WhatsApp: ${data.whatsapp.trim()}`,
      `Biggest challenge: ${data.challenge.trim()}`,
      'Offer: Website + 90-day SEO + social media sprint',
      'Source page: /gauteng-growth-audit',
    ].join('\n')

    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name.trim(),
          email: data.email.trim().toLowerCase(),
          company: data.businessLink.trim(),
          phone: data.whatsapp.trim(),
          website: data.businessLink.trim(),
          projectType: 'marketing',
          details,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Submission failed')
      }
      setStatus('success')
      setMessage('Your audit request is in.')
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Submission failed')
    }
  }

  if (status === 'success') {
    return (
      <div className="bento-card p-6 md:p-8" role="status" aria-live="polite">
        <p className="eyebrow mb-3">Audit requested</p>
        <h2 className="font-display text-3xl leading-tight text-[var(--color-pib-text)]">
          {message}
        </h2>
        <p className="mt-4 text-[var(--color-pib-text-muted)]">
          We will review your website, Google visibility, and social presence, then reply within
          one business day with the first fixes we would make.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bento-card p-6 md:p-8" noValidate>
      <p className="eyebrow mb-3">Free audit</p>
      <h2 className="font-display text-3xl leading-tight text-[var(--color-pib-text)]">
        Find the enquiry leaks.
      </h2>
      <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">
        Five fields. We reply within one business day with practical fixes, not a generic sales deck.
      </p>

      <div className="mt-6 grid gap-4">
        <Field
          label="Your name"
          value={data.name}
          onChange={(value) => update('name', value)}
          placeholder="Ava Owner"
        />
        <Field
          label="Email address"
          type="email"
          value={data.email}
          onChange={(value) => update('email', value)}
          placeholder="ava@example.com"
        />
        <Field
          label="Business and online link"
          value={data.businessLink}
          onChange={(value) => update('businessLink', value)}
          placeholder="Ava Florist - https://..."
        />
        <Field
          label="WhatsApp number"
          value={data.whatsapp}
          onChange={(value) => update('whatsapp', value)}
          placeholder="067 000 0000"
        />
        <label className="grid gap-2 text-sm font-medium text-[var(--color-pib-text)]">
          <span>Biggest online growth challenge</span>
          <textarea
            value={data.challenge}
            onChange={(event) => update('challenge', event.target.value)}
            rows={4}
            placeholder="What is not turning into leads yet?"
            className="w-full rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] px-4 py-3 text-base text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-pib-accent)]"
          />
        </label>
      </div>

      {message && (
        <p className="mt-4 text-sm text-[var(--color-pib-accent)]" role="alert">
          {message}
        </p>
      )}

      <button
        type="submit"
        className="btn-pib-accent mt-6 w-full justify-center"
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Sending audit request...' : 'Get my free growth audit'}
      </button>
    </form>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
}

function Field({ label, value, onChange, placeholder, type = 'text' }: FieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium text-[var(--color-pib-text)]">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] px-4 py-3 text-base text-[var(--color-pib-text)] outline-none transition focus:border-[var(--color-pib-accent)]"
      />
    </label>
  )
}
