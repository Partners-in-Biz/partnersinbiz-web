// app/(portal)/portal/first-run/page.tsx
//
// Growth-onboarding wizard — the PRIMARY first-run experience for the client
// portal. A stepped flow that gets a workspace from empty to live:
//   1) Org name + logo   2) Connect social   3) Verify domain
//   4) Add first contact 5) Install analytics
//
// Completion is persisted on the organisation via
// PATCH /api/v1/portal/growth-onboarding { growthOnboardingCompleted: true }.
//
// NOTE: the previous life-OS first-run profile flow lives behind the
// /api/v1/portal/first-run API (collection life_os_profiles) and is untouched.
// That API is gated by the LIFE_OS_ENABLED feature flag and is still callable;
// this page simply no longer renders that form as the default first-run screen.
'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { scopeFromSearchParams, scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'

type StepKey = 'org' | 'social' | 'domain' | 'contact' | 'analytics'

const STEP_ORDER: StepKey[] = ['org', 'social', 'domain', 'contact', 'analytics']
const STEP_LABELS: Record<StepKey, string> = {
  org: 'Workspace',
  social: 'Social',
  domain: 'Domain',
  contact: 'Contact',
  analytics: 'Analytics',
}

function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data?: unknown }).data
  }
  return body
}

export default function FirstRunGrowthWizard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const scopedHref = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])
  const scopedApi = useCallback((path: string) => scopedApiPath(path, orgScope), [orgScope])

  const [stepIndex, setStepIndex] = useState(0)
  const step = STEP_ORDER[stepIndex]

  // Step 1 — org name + logo
  const [orgName, setOrgName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgError, setOrgError] = useState('')
  const [canEditOrg, setCanEditOrg] = useState(true)

  // Step 2 — social connected?
  const [socialConnected, setSocialConnected] = useState(false)

  // Step 3 — domain verified?
  const [domainVerified, setDomainVerified] = useState(false)

  // Step 4 — add a contact
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactAdded, setContactAdded] = useState(false)
  const [contactError, setContactError] = useState('')

  // Step 5 — analytics installed?
  const [analyticsInstalled, setAnalyticsInstalled] = useState(false)

  const [finishing, setFinishing] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Load existing org name + logo and signal states.
  useEffect(() => {
    fetch(scopedApi('/api/v1/portal/settings/organization'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.organization?.name) setOrgName(d.organization.name)
        if (d?.permissions && d.permissions.canEdit === false) setCanEditOrg(false)
      })
      .catch(() => {})

    fetch(scopedApi('/api/v1/portal/brand-profile'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const data = unwrap(d) as { brandProfile?: { logoUrl?: string } } | null
        if (data?.brandProfile?.logoUrl) setLogoUrl(data.brandProfile.logoUrl)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [scopedApi])

  // Poll the real signal-state for steps 2, 3, 5 so they auto-tick.
  useEffect(() => {
    let cancelled = false
    async function refreshSignals() {
      const [accounts, domain, dashboard] = await Promise.all([
        fetch(scopedApi('/api/v1/social/accounts?limit=1')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(scopedApi('/api/v1/org/domain')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(scopedApi('/api/v1/portal/dashboard')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (cancelled) return

      const accountsData = unwrap(accounts)
      setSocialConnected(Array.isArray(accountsData) && accountsData.length > 0)

      const domainData = unwrap(domain) as { domain?: { verified?: boolean } } | null
      setDomainVerified(domainData?.domain?.verified === true)

      const dashboardData = unwrap(dashboard) as { connections?: unknown[] } | null
      setAnalyticsInstalled(Array.isArray(dashboardData?.connections) && dashboardData!.connections.length > 0)
    }
    refreshSignals()
    return () => {
      cancelled = true
    }
  }, [scopedApi, stepIndex])

  async function handleLogoUpload(file: File) {
    setLogoUploading(true)
    setOrgError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('folder', 'brands/logos')
      const res = await fetch(scopedApi('/api/v1/portal/brand-profile/upload'), { method: 'POST', body: form })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setOrgError(body?.error ?? 'Logo upload failed')
        return
      }
      const url = (unwrap(body) as { url?: string } | null)?.url
      if (!url) {
        setOrgError('Logo upload returned no URL')
        return
      }
      setLogoUrl(url)
      // Persist logo onto the brand profile immediately.
      await fetch(scopedApi('/api/v1/portal/brand-profile'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandProfile: { logoUrl: url } }),
      }).catch(() => {})
    } catch {
      setOrgError('Logo upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  async function saveOrgName(): Promise<boolean> {
    if (!canEditOrg) return true
    const name = orgName.trim()
    if (!name) return true
    setOrgSaving(true)
    setOrgError('')
    try {
      const res = await fetch(scopedApi('/api/v1/portal/settings/organization'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setOrgError(body?.error ?? 'Could not save workspace name')
        return false
      }
      return true
    } catch {
      setOrgError('Could not save workspace name')
      return false
    } finally {
      setOrgSaving(false)
    }
  }

  async function addContact(): Promise<boolean> {
    const name = contactName.trim()
    const email = contactEmail.trim()
    if (!name || !email) {
      setContactError('Name and email are required')
      return false
    }
    setContactSaving(true)
    setContactError('')
    try {
      const res = await fetch(scopedApi('/api/v1/crm/contacts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, source: 'manual' }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setContactError(body?.error ?? 'Could not add contact')
        return false
      }
      setContactAdded(true)
      return true
    } catch {
      setContactError('Could not add contact')
      return false
    } finally {
      setContactSaving(false)
    }
  }

  async function goNext() {
    if (step === 'org') {
      const ok = await saveOrgName()
      if (!ok) return
    }
    if (step === 'contact' && !contactAdded) {
      // Only block if the user actually typed something; otherwise "Next" acts as skip.
      if (contactName.trim() || contactEmail.trim()) {
        const ok = await addContact()
        if (!ok) return
      }
    }
    if (stepIndex < STEP_ORDER.length - 1) {
      setStepIndex((i) => i + 1)
    }
  }

  function skip() {
    if (stepIndex < STEP_ORDER.length - 1) setStepIndex((i) => i + 1)
  }

  async function finish() {
    setFinishing(true)
    try {
      await fetch(scopedApi('/api/v1/portal/growth-onboarding'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ growthOnboardingCompleted: true }),
      }).catch(() => {})
      router.push(scopedHref('/portal/dashboard'))
    } finally {
      setFinishing(false)
    }
  }

  const progress = ((stepIndex + 1) / STEP_ORDER.length) * 100
  const isLast = stepIndex === STEP_ORDER.length - 1

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="eyebrow">Workspace setup</p>
        <h1 className="pib-page-title mt-2">Let&apos;s get your workspace growing</h1>
        <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
          Five quick steps to a live, connected workspace. Skip anything you want to handle later.
        </p>
      </div>

      {/* Progress bar + step pills */}
      <div className="space-y-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-pib-line)]">
          <div
            className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {STEP_ORDER.map((key, i) => (
            <span
              key={key}
              className={[
                'rounded-full px-3 py-1 text-[11px] font-label uppercase tracking-wide border',
                i === stepIndex
                  ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]'
                  : i < stepIndex
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)]',
              ].join(' ')}
            >
              {i + 1}. {STEP_LABELS[key]}
            </span>
          ))}
        </div>
      </div>

      <div className="pib-card space-y-5" aria-busy={!loaded}>
        {/* STEP 1 — org name + logo */}
        {step === 'org' && (
          <div className="space-y-4">
            <div>
              <p className="eyebrow !text-[10px]">Step 1</p>
              <h2 className="font-display text-2xl text-[var(--color-pib-text)]">Name your workspace</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                Set the workspace name and upload a logo for your branding.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="pib-label !mb-0" htmlFor="growth-org-name">Workspace name</label>
              <input
                id="growth-org-name"
                className="pib-input"
                value={orgName}
                disabled={!canEditOrg}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Inc."
              />
              {!canEditOrg && (
                <p className="text-xs text-[var(--color-pib-text-muted)]">
                  Only workspace owners and admins can rename the workspace.
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Workspace logo" className="h-full w-full object-contain" />
                ) : (
                  <span className="material-symbols-outlined text-[24px] text-[var(--color-pib-text-muted)]">image</span>
                )}
              </div>
              <label className="pib-btn-secondary cursor-pointer text-sm font-label">
                {logoUploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={logoUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleLogoUpload(file)
                  }}
                />
              </label>
            </div>
            {orgError && <p className="text-sm text-red-400">{orgError}</p>}
          </div>
        )}

        {/* STEP 2 — connect social */}
        {step === 'social' && (
          <div className="space-y-4">
            <div>
              <p className="eyebrow !text-[10px]">Step 2</p>
              <h2 className="font-display text-2xl text-[var(--color-pib-text)]">Connect a social account</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                Link a platform so you can schedule and publish content from the portal.
              </p>
            </div>
            <SignalRow
              done={socialConnected}
              doneLabel="A social account is connected."
              todoLabel="No social accounts connected yet."
            />
            <Link href={scopedHref('/portal/integrations')} className="pib-btn-primary inline-flex text-sm font-label">
              {socialConnected ? 'Manage connections' : 'Connect a platform'}
            </Link>
          </div>
        )}

        {/* STEP 3 — verify domain */}
        {step === 'domain' && (
          <div className="space-y-4">
            <div>
              <p className="eyebrow !text-[10px]">Step 3</p>
              <h2 className="font-display text-2xl text-[var(--color-pib-text)]">Verify your domain</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                Run the portal on your own white-label domain.
              </p>
            </div>
            <SignalRow
              done={domainVerified}
              doneLabel="Your domain is verified."
              todoLabel="Domain not verified yet."
            />
            <Link href={scopedHref('/portal/settings/domain')} className="pib-btn-primary inline-flex text-sm font-label">
              {domainVerified ? 'Manage domain' : 'Set up domain'}
            </Link>
          </div>
        )}

        {/* STEP 4 — add a contact */}
        {step === 'contact' && (
          <div className="space-y-4">
            <div>
              <p className="eyebrow !text-[10px]">Step 4</p>
              <h2 className="font-display text-2xl text-[var(--color-pib-text)]">Add your first contact</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                Start building your audience right inside the CRM.
              </p>
            </div>
            {contactAdded ? (
              <SignalRow done doneLabel="Contact added to your CRM." todoLabel="" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="pib-label !mb-0" htmlFor="growth-contact-name">Name</label>
                  <input
                    id="growth-contact-name"
                    className="pib-input"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Jane Doe"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="pib-label !mb-0" htmlFor="growth-contact-email">Email</label>
                  <input
                    id="growth-contact-email"
                    type="email"
                    className="pib-input"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="jane@acme.com"
                  />
                </div>
              </div>
            )}
            {contactError && <p className="text-sm text-red-400">{contactError}</p>}
            {!contactAdded && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={addContact}
                  disabled={contactSaving || !contactName.trim() || !contactEmail.trim()}
                  className="pib-btn-primary text-sm font-label disabled:opacity-50"
                >
                  {contactSaving ? 'Adding…' : 'Add contact'}
                </button>
                <Link href={scopedHref('/portal/contacts/new')} className="text-sm text-[var(--color-pib-accent)] hover:underline">
                  Use the full contact form →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* STEP 5 — install analytics */}
        {step === 'analytics' && (
          <div className="space-y-4">
            <div>
              <p className="eyebrow !text-[10px]">Step 5</p>
              <h2 className="font-display text-2xl text-[var(--color-pib-text)]">Install analytics</h2>
              <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                Connect a property so KPIs and revenue flow into your dashboard.
              </p>
            </div>
            <SignalRow
              done={analyticsInstalled}
              doneLabel="An analytics connection is live."
              todoLabel="No analytics connections yet."
            />
            <Link href={scopedHref('/portal/properties')} className="pib-btn-primary inline-flex text-sm font-label">
              {analyticsInstalled ? 'Manage properties' : 'Set up a property'}
            </Link>
          </div>
        )}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
          className="pib-btn-secondary text-sm font-label disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          {!isLast && (
            <button type="button" onClick={skip} className="text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
              Skip for now
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              onClick={finish}
              disabled={finishing}
              className="pib-btn-primary text-sm font-label disabled:opacity-60"
            >
              {finishing ? 'Finishing…' : 'Finish setup'}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={orgSaving || contactSaving}
              className="pib-btn-primary text-sm font-label disabled:opacity-60"
            >
              {orgSaving || contactSaving ? 'Saving…' : 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SignalRow({ done, doneLabel, todoLabel }: { done: boolean; doneLabel: string; todoLabel: string }) {
  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-200">
        <span className="material-symbols-outlined text-[20px] text-emerald-300">check_circle</span>
        {doneLabel}
      </div>
    )
  }
  if (!todoLabel) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-3 py-2.5 text-sm text-[var(--color-pib-text-muted)]">
      <span className="material-symbols-outlined text-[20px]">radio_button_unchecked</span>
      {todoLabel}
    </div>
  )
}
