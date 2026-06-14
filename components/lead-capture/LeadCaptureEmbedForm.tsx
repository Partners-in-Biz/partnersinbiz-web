'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CaptureField,
  CaptureWidgetTheme,
  WidgetDisplayConfig,
} from '@/lib/lead-capture/types'

interface Props {
  sourceId: string
  theme: CaptureWidgetTheme
  fields: CaptureField[]
  successMessage: string
  successRedirectUrl: string
  submitUrl: string
  turnstileSiteKey?: string
  // Optional multi-step config — when present and `display.mode === 'multi-step'`
  // with at least one step, the form progresses step-by-step using the
  // progressive endpoint. Any other mode is rendered as a normal inline form
  // (overlay modes don't make sense inside an iframe).
  display?: WidgetDisplayConfig
  progressiveUrl?: string
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

function loadTurnstileScript() {
  if (typeof window === 'undefined') return
  if (document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)) return
  const script = document.createElement('script')
  script.src = TURNSTILE_SCRIPT_SRC
  script.async = true
  script.defer = true
  document.head.appendChild(script)
}

interface SubmitResponse {
  ok: boolean
  error?: string
  message?: string
  requiresConfirmation?: boolean
  redirect?: string
  submissionId?: string
  nextStep?: number
  isLast?: boolean
}

export function LeadCaptureEmbedForm(props: Props) {
  const { theme, fields, submitUrl, successMessage, turnstileSiteKey, display, progressiveUrl } = props
  const steps = display?.steps ?? []
  const isMultiStep = display?.mode === 'multi-step' && steps.length > 0 && !!progressiveUrl

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ requiresConfirmation: boolean; message: string } | null>(null)
  const [email, setEmail] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [honeypot, setHoneypot] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    if (turnstileSiteKey) loadTurnstileScript()
  }, [turnstileSiteKey])

  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function readTurnstileToken(): string {
    if (!formRef.current) return ''
    const input = formRef.current.querySelector(
      'input[name="cf-turnstile-response"]',
    ) as HTMLInputElement | null
    return input?.value ?? ''
  }

  const currentStepCfg = isMultiStep ? steps[stepIndex] : null
  const isLastStep = isMultiStep ? stepIndex >= steps.length - 1 : true

  const fieldsForStep = useMemo<CaptureField[]>(() => {
    if (!isMultiStep || !currentStepCfg) {
      return fields.filter((f) => f.key !== 'email')
    }
    const byKey: Record<string, CaptureField> = {}
    fields.forEach((f) => { if (f.key) byKey[f.key] = f })
    return (currentStepCfg.fields || [])
      .filter((k) => k !== 'email')
      .map((k) => byKey[k])
      .filter((f): f is CaptureField => !!f)
  }, [isMultiStep, currentStepCfg, fields])

  const headingText = currentStepCfg?.headingText || theme.headingText || 'Join our newsletter'
  const subheadingText = currentStepCfg?.subheadingText ?? theme.subheadingText ?? ''
  const buttonText = currentStepCfg?.buttonText || theme.buttonText || 'Subscribe'

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    // Step-level required field check
    const missing = fieldsForStep.find((f) => f.required && !(values[f.key] || '').trim())
    if (missing) {
      setError(`${missing.label} is required.`)
      return
    }

    // Email validation on step 0 (or single-screen)
    if (stepIndex === 0 && !email.trim()) {
      setError('Email is required.')
      return
    }
    const stepData: Record<string, string> = {}
    fieldsForStep.forEach((f) => {
      const v = (values[f.key] || '').trim()
      if (v) stepData[f.key] = v
    })

    // Turnstile only on the final step
    let turnstileToken = ''
    if (isLastStep && turnstileSiteKey) {
      turnstileToken = readTurnstileToken()
      if (!turnstileToken) {
        setError('Please complete the CAPTCHA challenge.')
        return
      }
    }

    setSubmitting(true)
    try {
      const referer = typeof document !== 'undefined' ? document.referrer : ''

      // Multi-step progressive flow
      if (isMultiStep && progressiveUrl) {
        const payload: Record<string, unknown> = {
          email: email.trim(),
          step: stepIndex,
          data: { ...stepData, _hp: honeypot },
          referer,
        }
        if (submissionId) payload.submissionId = submissionId
        if (turnstileToken) payload.turnstileToken = turnstileToken
        const res = await fetch(progressiveUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body: SubmitResponse = await res.json().catch(() => ({ ok: false } as SubmitResponse))
        if (!res.ok || body.ok === false) {
          setError(body.error || 'Submission failed. Please try again.')
          setSubmitting(false)
          return
        }
        if (body.submissionId) setSubmissionId(body.submissionId)
        if (body.isLast) {
          setDone({
            requiresConfirmation: !!body.requiresConfirmation,
            message: body.message || successMessage,
          })
          if (body.redirect) {
            setTimeout(() => { window.location.href = body.redirect as string }, 1200)
          }
        } else {
          setStepIndex(typeof body.nextStep === 'number' ? body.nextStep : stepIndex + 1)
        }
        setSubmitting(false)
        return
      }

      // Single-screen submit
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          data: { ...values, _hp: honeypot },
          referer,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      })
      const body: SubmitResponse = await res.json().catch(() => ({ ok: false } as SubmitResponse))
      if (!res.ok || !body.ok) {
        setError(body.error || 'Submission failed. Please try again.')
        setSubmitting(false)
        return
      }
      setDone({
        requiresConfirmation: !!body.requiresConfirmation,
        message: body.message || successMessage,
      })
      if (body.redirect) {
        setTimeout(() => {
          window.location.href = body.redirect as string
        }, 1200)
      }
    } catch (err) {
      console.error('[lead-capture] submit error', err)
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const containerStyle: React.CSSProperties = {
    background: theme.backgroundColor || '#ffffff',
    color: theme.textColor || '#111827',
    padding: 'clamp(16px, 5vw, 24px)',
    borderRadius: `${theme.borderRadius || 12}px`,
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif',
    fontSize: '15px',
    lineHeight: 1.5,
    width: '100%',
    maxWidth: 'min(460px, calc(100vw - 24px))',
    margin: '0 auto',
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    boxSizing: 'border-box',
    overflowX: 'hidden',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    padding: '10px 12px',
    border: '1px solid rgba(0,0,0,0.18)',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#111',
  }

  if (done) {
    return (
      <div style={containerStyle}>
        <h3 style={{ margin: '0 0 8px', fontSize: 20, color: theme.textColor || '#111827', textAlign: 'center' }}>
          {done.requiresConfirmation ? 'Check your inbox' : 'Thanks!'}
        </h3>
        <p style={{ margin: 0, color: theme.textColor || '#475569', opacity: 0.8, textAlign: 'center' }}>
          {done.message}
        </p>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 600, color: theme.textColor || '#111827' }}>
        {headingText}
      </h3>
      {subheadingText ? (
        <p style={{ margin: '0 0 18px', color: theme.textColor || '#475569', opacity: 0.8, fontSize: 14 }}>
          {subheadingText}
        </p>
      ) : null}

      {isMultiStep ? (
        <div style={{ marginBottom: 12, fontSize: 12, color: theme.textColor || '#475569', opacity: 0.7 }}>
          Step {stepIndex + 1} of {steps.length}
        </div>
      ) : null}

      <form ref={formRef} onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }} noValidate>
        {/* Honeypot */}
        <input
          type="text"
          name="_hp"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-9999px',
            width: '1px',
            height: '1px',
            opacity: 0,
          }}
        />

        {stepIndex === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>
        ) : null}

        {fieldsForStep.map((field) => {
          const v = values[field.key] ?? ''
          const lbl = `${field.label}${field.required ? ' *' : ''}`
          if (field.type === 'textarea') {
            return (
              <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</label>
                <textarea
                  required={field.required}
                  value={v}
                  onChange={(e) => setField(field.key, e.target.value)}
                  placeholder={field.placeholder || field.label}
                  rows={4}
                  style={inputStyle}
                />
              </div>
            )
          }
          if (field.type === 'select') {
            return (
              <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</label>
                <select
                  required={field.required}
                  value={v}
                  onChange={(e) => setField(field.key, e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{field.placeholder || field.label}</option>
                  {(field.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            )
          }
          return (
            <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13, fontWeight: 500 }}>{lbl}</label>
              <input
                type={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'}
                required={field.required}
                value={v}
                onChange={(e) => setField(field.key, e.target.value)}
                placeholder={field.placeholder || field.label}
                style={inputStyle}
              />
            </div>
          )
        })}

        {isLastStep && turnstileSiteKey ? (
          <div
            className="cf-turnstile"
            data-sitekey={turnstileSiteKey}
            style={{ marginTop: 4 }}
          />
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          style={{
            marginTop: 6,
            padding: '12px 16px',
            background: theme.primaryColor || '#0f766e',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
        >
          {submitting ? 'Submitting…' : buttonText}
        </button>

        {error ? <div style={{ fontSize: 13, color: '#b91c1c' }}>{error}</div> : null}
      </form>
    </div>
  )
}
