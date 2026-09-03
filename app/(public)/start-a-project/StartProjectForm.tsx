'use client'

import { Icon } from '@/components/studio'

import { useState } from 'react'
import Link from 'next/link'
import { SITE } from '@/lib/seo/site'

type Status = 'idle' | 'loading' | 'success' | 'error'

interface RadioOption {
  value: string
  label: string
  icon: string
  sublabel?: string
}

const PROJECT_TYPES: RadioOption[] = [
  { value: 'marketing-site', label: 'Marketing site', icon: 'public' },
  { value: 'web-app', label: 'Web app', icon: 'dashboard' },
  { value: 'mobile-app', label: 'Mobile app', icon: 'phone_iphone' },
  { value: 'ai-integration', label: 'AI integration', icon: 'bolt' },
  { value: 'growth-systems', label: 'Growth systems', icon: 'trending_up' },
  { value: 'not-sure', label: 'Not sure yet', icon: 'help_outline' },
]

const TIMELINES: RadioOption[] = [
  { value: 'yesterday', label: 'Yesterday', icon: 'bolt' },
  { value: '1-3-months', label: '1–3 months', icon: 'event' },
  { value: '3-6-months', label: '3–6 months', icon: 'event_note' },
  { value: 'exploring', label: 'Just exploring', icon: 'explore' },
]

const BUDGETS: RadioOption[] = [
  { value: 'r20-50k', label: 'R20k–R50k', icon: 'payments', sublabel: '≈ $1.1k–$2.8k USD' },
  { value: 'r50-150k', label: 'R50k–R150k', icon: 'payments', sublabel: '≈ $2.8k–$8.3k USD' },
  { value: 'r150-450k', label: 'R150k–R450k', icon: 'payments', sublabel: '≈ $8.3k–$25k USD' },
  { value: 'r450k+', label: 'R450k+', icon: 'payments', sublabel: '≈ $25k+ USD' },
  { value: 'not-sure', label: 'Not sure', icon: 'help_outline' },
]

interface FormState {
  projectType: string
  timeline: string
  budget: string
  name: string
  email: string
  company: string
  whatsapp: string
  preferWhatsapp: boolean
  details: string
}

const INITIAL: FormState = {
  projectType: '',
  timeline: '',
  budget: '',
  name: '',
  email: '',
  company: '',
  whatsapp: '',
  preferWhatsapp: false,
  details: '',
}

export default function StartProjectForm() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormState>(INITIAL)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const totalSteps = 4

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setData((d) => ({ ...d, [key]: value }))
  }

  function isStepValid(s: number): boolean {
    if (s === 1) return !!data.projectType
    if (s === 2) return !!data.timeline
    if (s === 3) return !!data.budget
    if (s === 4) {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())
      return data.name.trim().length > 0 && emailOk && data.details.trim().length > 0
    }
    return false
  }

  async function handleSubmit() {
    if (!isStepValid(4)) return
    setStatus('loading')
    setErrorMsg('')

    const projectTypeLabel =
      PROJECT_TYPES.find((p) => p.value === data.projectType)?.label ?? data.projectType
    const timelineLabel = TIMELINES.find((t) => t.value === data.timeline)?.label ?? data.timeline
    const budgetLabel = BUDGETS.find((b) => b.value === data.budget)?.label ?? data.budget

    const detailsBlock = [
      data.details.trim(),
      '',
      ' - - - ',
      `Timeline: ${timelineLabel}`,
      `Budget: ${budgetLabel}`,
      data.whatsapp ? `WhatsApp: ${data.whatsapp}${data.preferWhatsapp ? ' (preferred)' : ''}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name.trim(),
          email: data.email.trim(),
          company: data.company.trim(),
          projectType: projectTypeLabel,
          details: detailsBlock,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Submission failed')
      }
      setStatus('success')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    const waLink = `https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`
    return (
      <div className="bento-card p-8 md:p-10">
        <div className="flex items-start gap-4">
          <Icon name="check_circle" />
          <div className="flex-1">
            <h2 className="text-3xl text-[var(--color-pib-text)] mb-2">
              Got it. We&rsquo;ll reply within one business day.
            </h2>
            <p className="text-[var(--color-pib-text-muted)] leading-relaxed">
              You&rsquo;ll get a 3-paragraph summary of what we heard, plus a link to grab a 20-minute intro call.
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[var(--color-pib-line)] space-y-4">
          <p className="text-sm text-[var(--color-pib-text-muted)]">Want to grab a slot now?</p>
          <Link href={SITE.cal.url} className="btn-pib-accent">
            <Icon name="event" />
            Book a 20-min call
          </Link>
          <p className="text-sm text-[var(--color-pib-text-muted)] pt-2">Or message us on WhatsApp:</p>
          <a href={waLink} target="_blank" rel="noreferrer" className="btn-pib-secondary">
            <Icon name="chat" />
            Open WhatsApp
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="bento-card p-6 md:p-8">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <span className="eyebrow">
            Step {step} of {totalSteps}
          </span>
          <span className="text-xs text-[var(--color-pib-text-faint)] font-mono">
            {Math.round((step / totalSteps) * 100)}%
          </span>
        </div>
        <div className="h-1 w-full bg-[var(--color-pib-line)] rounded-md overflow-hidden">
          <div
            className="h-full bg-[var(--color-pib-accent)] transition-all duration-500 ease-out"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="min-h-[360px]">
        {step === 1 && (
          <Step
            title="What are you building?"
            subtitle="Pick the closest fit. We&rsquo;ll figure out the rest together."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PROJECT_TYPES.map((opt) => (
                <RadioCard
                  key={opt.value}
                  option={opt}
                  selected={data.projectType === opt.value}
                  onSelect={() => update('projectType', opt.value)}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step
            title="What's the timeline?"
            subtitle="Honest answers help us slot you in properly."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TIMELINES.map((opt) => (
                <RadioCard
                  key={opt.value}
                  option={opt}
                  selected={data.timeline === opt.value}
                  onSelect={() => update('timeline', opt.value)}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            title="Budget range?"
            subtitle="Rough is fine. We&rsquo;ll send a fixed-scope quote either way."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BUDGETS.map((opt) => (
                <RadioCard
                  key={opt.value}
                  option={opt}
                  selected={data.budget === opt.value}
                  onSelect={() => update('budget', opt.value)}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step title="Tell us about it" subtitle="Last step. You&rsquo;re almost done.">
            <div className="grid grid-cols-1 gap-4">
              <Field
                label="Your name"
                required
                value={data.name}
                onChange={(v) => update('name', v)}
                placeholder="Alex Vance"
              />
              <Field
                label="Email"
                type="email"
                required
                value={data.email}
                onChange={(v) => update('email', v)}
                placeholder="alex@company.com"
              />
              <Field
                label="Company"
                value={data.company}
                onChange={(v) => update('company', v)}
                placeholder="Optional"
              />
              <Field
                label="WhatsApp"
                value={data.whatsapp}
                onChange={(v) => update('whatsapp', v)}
                placeholder="Optional - +27 …"
              />
              <label className="flex items-center gap-3 -mt-1 select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={data.preferWhatsapp}
                  onChange={(e) => update('preferWhatsapp', e.target.checked)}
                  className="w-4 h-4 accent-[var(--color-pib-accent)]"
                />
                <span className="text-sm text-[var(--color-pib-text-muted)]">
                  I prefer WhatsApp
                </span>
              </label>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--color-pib-text)]">
                  What are you building? Any links?{' '}
                  <span className="text-[var(--color-pib-accent)]">*</span>
                </label>
                <textarea
                  value={data.details}
                  onChange={(e) => update('details', e.target.value)}
                  rows={5}
                  aria-label="What are you building? Any links?"
                  placeholder="A few sentences. Links to references, current site, anything that helps."
                  className="w-full bg-[var(--color-pib-bg)] border border-[var(--color-pib-line-strong)] rounded-lg px-4 py-3 text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-faint)] focus:border-[var(--color-pib-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent-soft)] transition resize-y"
                />
              </div>
            </div>
          </Step>
        )}
      </div>

      {/* Error */}
      {status === 'error' && (
        <p className="mt-4 text-sm text-[var(--st-danger)]" role="alert">
          {errorMsg}
        </p>
      )}

      {/* Nav */}
      <div className="mt-8 pt-6 border-t border-[var(--color-pib-line)] flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="btn-pib-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name="arrow_back" />
          Back
        </button>

        {step < totalSteps ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(totalSteps, s + 1))}
            disabled={!isStepValid(step)}
            className="btn-pib-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
            <Icon name="arrow_forward" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isStepValid(4) || status === 'loading'}
            className="btn-pib-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === 'loading' ? 'Sending…' : 'Send it'}
            {status !== 'loading' && (
              <Icon name="send" />
            )}
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-[var(--color-pib-text-faint)]">
        By submitting, you agree to us processing your details to reply to this enquiry. See our{' '}
        <Link href="/privacy-policy" className="pib-link-underline">
          privacy policy
        </Link>
        .
      </p>
    </div>
  )
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-3xl md:text-4xl text-[var(--color-pib-text)] text-balance mb-2">
        {title}
      </h2>
      {subtitle && (
        <p className="text-[var(--color-pib-text-muted)] mb-6 text-pretty">{subtitle}</p>
      )}
      {children}
    </div>
  )
}

function RadioCard({
  option,
  selected,
  onSelect,
}: {
  option: RadioOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex items-start gap-4 p-5 rounded-md border text-left transition-all ${
        selected
          ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
          : 'border-[var(--color-pib-line)] bg-[var(--color-pib-bg)] hover:border-[var(--color-pib-line-strong)] hover:bg-[var(--color-pib-surface-2)]'
      }`}
    >
      <Icon
        name={option.icon}
        className={`shrink-0 ${
          selected ? 'text-[var(--color-pib-accent)]' : 'text-[var(--color-pib-text-muted)]'
        }`}
      />
      <div className="flex-1 min-w-0">
        <span
          className={`block font-medium ${
            selected ? 'text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text)]'
          }`}
        >
          {option.label}
        </span>
        {option.sublabel && (
          <span className="block text-xs text-[var(--color-pib-text-muted)] mt-0.5 font-mono">
            {option.sublabel}
          </span>
        )}
      </div>
      <span
        className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${
          selected
            ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]'
            : 'border-[var(--color-pib-line-strong)] bg-transparent'
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-md bg-black" />}
      </span>
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-[var(--color-pib-text)]">
        {label}
        {required && <span className="text-[var(--color-pib-accent)]"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--color-pib-bg)] border border-[var(--color-pib-line-strong)] rounded-lg px-4 py-3 text-[var(--color-pib-text)] placeholder:text-[var(--color-pib-text-faint)] focus:border-[var(--color-pib-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-pib-accent-soft)] transition"
      />
    </div>
  )
}
