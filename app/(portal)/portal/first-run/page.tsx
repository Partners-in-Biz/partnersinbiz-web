// app/(portal)/portal/first-run/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'

type LifeDomain = { key: string; label: string; priority: number; notes: string }
type Goal = { title: string; domain: string; timeframe: string }

type FirstRunProfile = {
  completed: boolean
  identity: { preferredName: string; pronouns: string; location: string }
  values: string[]
  lifeDomains: LifeDomain[]
  constraints: string[]
  goals: Goal[]
  baseline: { confidence: number | null; energy: number | null; timeCapacityHours: number | null }
  privacy: { consentToStore: boolean; shareWithTeam: boolean; allowAgentPersonalization: boolean }
}

type FirstRunResponse = {
  data?: { firstRun?: FirstRunProfile }
  error?: string
  moduleDisabled?: boolean
}

const EMPTY_FIRST_RUN: FirstRunProfile = {
  completed: false,
  identity: { preferredName: '', pronouns: '', location: '' },
  values: [],
  lifeDomains: [],
  constraints: [],
  goals: [],
  baseline: { confidence: null, energy: null, timeCapacityHours: null },
  privacy: { consentToStore: false, shareWithTeam: false, allowAgentPersonalization: false },
}

function linesToList(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function listToLines(value: string[]) {
  return value.join('\n')
}

function domainsToText(domains: LifeDomain[]) {
  return domains.map((domain) => `${domain.label}${domain.notes ? `: ${domain.notes}` : ''}`).join('\n')
}

function textToDomains(value: string): LifeDomain[] {
  return linesToList(value).map((line, index) => {
    const [labelPart, ...notesParts] = line.split(':')
    const label = (labelPart ?? line).trim()
    return {
      key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `domain-${index + 1}`,
      label,
      priority: Math.min(5, index + 1),
      notes: notesParts.join(':').trim(),
    }
  })
}

function goalsToText(goals: Goal[]) {
  return goals.map((goal) => [goal.title, goal.domain, goal.timeframe].filter(Boolean).join(' | ')).join('\n')
}

function textToGoals(value: string): Goal[] {
  return linesToList(value).map((line) => {
    const [title = '', domain = '', timeframe = ''] = line.split('|').map((part) => part.trim())
    return { title, domain, timeframe }
  }).filter((goal) => goal.title)
}

function numberOrNull(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="pib-label !mb-0" htmlFor={`first-run-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{label}</label>
      {children}
    </div>
  )
}

export default function FirstRunPage() {
  const [profile, setProfile] = useState<FirstRunProfile>(EMPTY_FIRST_RUN)
  const [valuesText, setValuesText] = useState('')
  const [domainsText, setDomainsText] = useState('')
  const [constraintsText, setConstraintsText] = useState('')
  const [goalsText, setGoalsText] = useState('')
  const [loading, setLoading] = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/v1/portal/first-run')
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as FirstRunResponse
        if (res.status === 403 && body.moduleDisabled) {
          setDisabled(true)
          return
        }
        if (!res.ok) throw new Error(body.error ?? 'Failed to load first-run setup')
        const firstRun = body.data?.firstRun ?? EMPTY_FIRST_RUN
        setProfile(firstRun)
        setValuesText(listToLines(firstRun.values))
        setDomainsText(domainsToText(firstRun.lifeDomains))
        setConstraintsText(listToLines(firstRun.constraints))
        setGoalsText(goalsToText(firstRun.goals))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load first-run setup'))
      .finally(() => setLoading(false))
  }, [])

  const payload = useMemo(() => ({
    ...profile,
    values: linesToList(valuesText),
    lifeDomains: textToDomains(domainsText),
    constraints: linesToList(constraintsText),
    goals: textToGoals(goalsText),
  }), [profile, valuesText, domainsText, constraintsText, goalsText])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    const res = await fetch('/api/v1/portal/first-run', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({})) as FirstRunResponse
    if (res.ok) {
      setSaved(true)
      if (body.data?.firstRun) setProfile(body.data.firstRun)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError(body.error ?? 'Failed to save first-run profile')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading first-run setup">
        <div className="h-6 w-44 rounded bg-[var(--color-pib-surface-soft)]" />
        <div className="pib-card h-48" />
      </div>
    )
  }

  if (disabled) {
    return (
      <div role="status" className="pib-card max-w-2xl space-y-3">
        <p className="eyebrow">Feature flag</p>
        <h1 className="pib-page-title">First-run setup</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)]">First-run setup is not enabled for this workspace yet.</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div>
        <p className="eyebrow">Workspace onboarding</p>
        <h1 className="pib-page-title mt-2">First-run setup</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Capture the operating context agents need before they help: identity, values, domains, constraints, goals, and baseline capacity.
        </p>
      </div>

      <section className="pib-card space-y-4" aria-labelledby="first-run-identity">
        <div>
          <p className="eyebrow !text-[10px]">Step 1</p>
          <h2 id="first-run-identity" className="font-display text-2xl text-[var(--color-pib-text)]">Identity and values</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Preferred name">
            <input id="first-run-preferred-name" className="pib-input" value={profile.identity.preferredName} onChange={(e) => setProfile((p) => ({ ...p, identity: { ...p.identity, preferredName: e.target.value } }))} />
          </Field>
          <Field label="Pronouns">
            <input id="first-run-pronouns" className="pib-input" value={profile.identity.pronouns} onChange={(e) => setProfile((p) => ({ ...p, identity: { ...p.identity, pronouns: e.target.value } }))} />
          </Field>
          <Field label="Location">
            <input id="first-run-location" className="pib-input" value={profile.identity.location} onChange={(e) => setProfile((p) => ({ ...p, identity: { ...p.identity, location: e.target.value } }))} />
          </Field>
        </div>
        <Field label="Core values">
          <textarea id="first-run-core-values" className="pib-input min-h-28" value={valuesText} onChange={(e) => setValuesText(e.target.value)} placeholder="One value per line" />
        </Field>
      </section>

      <section className="pib-card space-y-4" aria-labelledby="first-run-context">
        <div>
          <p className="eyebrow !text-[10px]">Step 2</p>
          <h2 id="first-run-context" className="font-display text-2xl text-[var(--color-pib-text)]">Domains, constraints, and goals</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Life domains">
            <textarea id="first-run-life-domains" className="pib-input min-h-36" value={domainsText} onChange={(e) => setDomainsText(e.target.value)} placeholder="Health: training rhythm" />
          </Field>
          <Field label="Current constraints">
            <textarea id="first-run-current-constraints" className="pib-input min-h-36" value={constraintsText} onChange={(e) => setConstraintsText(e.target.value)} placeholder="One constraint per line" />
          </Field>
          <Field label="Goals">
            <textarea id="first-run-goals" className="pib-input min-h-36" value={goalsText} onChange={(e) => setGoalsText(e.target.value)} placeholder="Goal | domain | timeframe" />
          </Field>
        </div>
      </section>

      <section className="pib-card space-y-4" aria-labelledby="first-run-baseline">
        <div>
          <p className="eyebrow !text-[10px]">Step 3</p>
          <h2 id="first-run-baseline" className="font-display text-2xl text-[var(--color-pib-text)]">Baseline and privacy</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Confidence baseline">
            <input id="first-run-confidence-baseline" type="number" min={1} max={10} className="pib-input" value={profile.baseline.confidence ?? ''} onChange={(e) => setProfile((p) => ({ ...p, baseline: { ...p.baseline, confidence: numberOrNull(e.target.value) } }))} />
          </Field>
          <Field label="Energy baseline">
            <input id="first-run-energy-baseline" type="number" min={1} max={10} className="pib-input" value={profile.baseline.energy ?? ''} onChange={(e) => setProfile((p) => ({ ...p, baseline: { ...p.baseline, energy: numberOrNull(e.target.value) } }))} />
          </Field>
          <Field label="Time capacity per week">
            <input id="first-run-time-capacity-per-week" type="number" min={0} max={168} className="pib-input" value={profile.baseline.timeCapacityHours ?? ''} onChange={(e) => setProfile((p) => ({ ...p, baseline: { ...p.baseline, timeCapacityHours: numberOrNull(e.target.value) } }))} />
          </Field>
        </div>
        <div className="space-y-3 rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
          <label className="flex gap-3 text-sm text-[var(--color-pib-text)]">
            <input type="checkbox" checked={profile.privacy.consentToStore} onChange={(e) => setProfile((p) => ({ ...p, privacy: { ...p.privacy, consentToStore: e.target.checked } }))} />
            <span>I consent to Partners in Biz storing this first-run profile for my workspace.</span>
          </label>
          <label className="flex gap-3 text-sm text-[var(--color-pib-text)]">
            <input type="checkbox" checked={profile.privacy.shareWithTeam} onChange={(e) => setProfile((p) => ({ ...p, privacy: { ...p.privacy, shareWithTeam: e.target.checked } }))} />
            <span>Share this profile with workspace admins.</span>
          </label>
          <label className="flex gap-3 text-sm text-[var(--color-pib-text)]">
            <input type="checkbox" checked={profile.privacy.allowAgentPersonalization} onChange={(e) => setProfile((p) => ({ ...p, privacy: { ...p.privacy, allowAgentPersonalization: e.target.checked } }))} />
            <span>Allow agents to use this profile for personalisation inside this workspace.</span>
          </label>
        </div>
      </section>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={saving || !profile.privacy.consentToStore} className="pib-btn-primary w-full justify-center disabled:opacity-60 sm:w-auto">
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save first-run profile'}
      </button>
    </form>
  )
}
