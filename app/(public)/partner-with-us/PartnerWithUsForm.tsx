'use client'

import { FormEvent, useState } from 'react'

const VENTURES = [
  'I am Ballito regional partner',
  'Athleet ground sales partner',
  'Both opportunities',
  'Something adjacent',
] as const

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function PartnerWithUsForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    venture: VENTURES[0],
    name: '',
    email: '',
    phone: '',
    region: '',
    network: '',
    note: '',
  })

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('loading')
    setError('')

    const details = [
      `Venture: ${form.venture}`,
      form.region ? `Region / area: ${form.region}` : null,
      form.phone ? `Phone / WhatsApp: ${form.phone}` : null,
      form.network ? `Existing network: ${form.network}` : null,
      '',
      form.note.trim(),
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          company: form.region.trim(),
          projectType: 'Partner With Us application',
          details,
        }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Application could not be sent')
      }

      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-[2rem] border border-yellow-300/40 bg-yellow-300/10 p-8 shadow-[0_0_60px_rgba(250,204,21,0.16)]">
        <p className="eyebrow mb-3 text-yellow-200">Application received</p>
        <h2 className="font-display text-3xl text-yellow-50">Thanks — we’ll review the fit and come back to you.</h2>
        <p className="mt-4 text-sm leading-relaxed text-yellow-50/75">
          We’ll look at the region, your network, and which venture is the cleanest starting point before any next step.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-[2rem] border border-yellow-300/40 bg-yellow-300/10 p-6 md:p-8 shadow-[0_0_70px_rgba(250,204,21,0.14)]">
      <p className="eyebrow mb-3 text-yellow-200">Apply to partner</p>
      <h2 className="font-display text-3xl text-yellow-50">Tell us where you want to play.</h2>
      <p className="mt-3 text-sm leading-relaxed text-yellow-50/70">
        Keep it rough. We need to know the venture, the region, and the people or clubs you can reach.
      </p>

      <div className="mt-8 grid gap-4">
        <label className="grid gap-2 text-sm text-yellow-50/80">
          Venture
          <select
            value={form.venture}
            onChange={(event) => update('venture', event.target.value)}
            className="rounded-2xl border border-yellow-300/30 bg-black/40 px-4 py-3 text-yellow-50 outline-none focus:border-yellow-200"
          >
            {VENTURES.map((venture) => (
              <option key={venture}>{venture}</option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(value) => update('name', value)} required />
          <Field label="Email" type="email" value={form.email} onChange={(value) => update('email', value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Phone / WhatsApp" value={form.phone} onChange={(value) => update('phone', value)} />
          <Field label="Region / area" value={form.region} onChange={(value) => update('region', value)} placeholder="Ballito, Durban North, Pretoria..." />
        </div>

        <label className="grid gap-2 text-sm text-yellow-50/80">
          Current network
          <input
            value={form.network}
            onChange={(event) => update('network', event.target.value)}
            placeholder="Retailers, schools, clubs, wrestling circles, local businesses..."
            className="rounded-2xl border border-yellow-300/30 bg-black/40 px-4 py-3 text-yellow-50 outline-none placeholder:text-yellow-50/35 focus:border-yellow-200"
          />
        </label>

        <label className="grid gap-2 text-sm text-yellow-50/80">
          Why this fits you
          <textarea
            value={form.note}
            onChange={(event) => update('note', event.target.value)}
            required
            rows={5}
            placeholder="Tell us what you can unlock on the ground and what kind of partnership you want."
            className="resize-none rounded-2xl border border-yellow-300/30 bg-black/40 px-4 py-3 text-yellow-50 outline-none placeholder:text-yellow-50/35 focus:border-yellow-200"
          />
        </label>
      </div>

      {status === 'error' && <p className="mt-4 text-sm text-red-200">{error}</p>}

      <button type="submit" disabled={status === 'loading'} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-yellow-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-70">
        {status === 'loading' ? 'Sending...' : 'Send application'}
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
    <label className="grid gap-2 text-sm text-yellow-50/80">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="rounded-2xl border border-yellow-300/30 bg-black/40 px-4 py-3 text-yellow-50 outline-none placeholder:text-yellow-50/35 focus:border-yellow-200"
      />
    </label>
  )
}
