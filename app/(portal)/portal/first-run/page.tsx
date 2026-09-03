// app/(portal)/portal/first-run/page.tsx
//
// Growth-onboarding wizard - the PRIMARY first-run experience for the client
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
import { useRouter, useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import {
  Avatar,
  Button,
  ButtonLink,
  Field,
  Icon,
  Input,
  Notice,
  Panel,
  Status,
  Steps,
  Title,
} from '@/components/studio'
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
const STEP_LIST = STEP_ORDER.map((key) => STEP_LABELS[key])

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

  const [orgName, setOrgName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgError, setOrgError] = useState('')
  const [canEditOrg, setCanEditOrg] = useState(true)

  const [socialConnected, setSocialConnected] = useState(false)
  const [domainVerified, setDomainVerified] = useState(false)

  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactAdded, setContactAdded] = useState(false)
  const [contactError, setContactError] = useState('')

  const [analyticsInstalled, setAnalyticsInstalled] = useState(false)

  const [finishing, setFinishing] = useState(false)
  const [loaded, setLoaded] = useState(false)

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

  const isLast = stepIndex === STEP_ORDER.length - 1

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        eyebrow="Workspace setup"
        title="Let's get your workspace growing."
        description="Five quick steps to a live, connected workspace. Skip anything you want to handle later."
      />

      <Steps steps={STEP_LIST} current={stepIndex} />

      <Panel className="space-y-5">
        <div aria-busy={!loaded} className="contents">
        {step === 'org' && (
          <div className="space-y-4">
            <div>
              <p className="sc-tiny">Step 1</p>
              <Title as="h2">Name your workspace</Title>
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                Set the workspace name and upload a logo for your branding.
              </p>
            </div>
            <Field id="growth-org-name" label="Workspace name" help={!canEditOrg ? 'Only workspace owners and admins can rename the workspace.' : undefined}>
              <Input
                id="growth-org-name"
                aria-label="Workspace name"
                value={orgName}
                disabled={!canEditOrg}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Inc."
              />
            </Field>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <Avatar src={logoUrl} alt={orgName || 'Workspace logo'} size="lg" />
              ) : (
                <div className="grid h-16 w-16 place-items-center overflow-hidden border border-[var(--sc-line)] bg-[var(--sc-surface)]" style={{ borderRadius: '4px' }}>
                  <Icon name="image" />
                </div>
              )}
              <label className="st-btn st-btn--secondary st-btn--sm cursor-pointer">
                {logoUploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  aria-label={logoUrl ? 'Replace logo' : 'Upload logo'}
                  disabled={logoUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleLogoUpload(file)
                  }}
                />
              </label>
            </div>
            {orgError ? <Notice tone="danger">{orgError}</Notice> : null}
          </div>
        )}

        {step === 'social' && (
          <div className="space-y-4">
            <div>
              <p className="sc-tiny">Step 2</p>
              <Title as="h2">Connect a social account</Title>
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                Link a platform so you can schedule and publish content from the portal.
              </p>
            </div>
            <SignalRow
              done={socialConnected}
              doneLabel="A social account is connected."
              todoLabel="No social accounts connected yet."
            />
            <ButtonLink href={scopedHref('/portal/integrations')} size="sm">
              {socialConnected ? 'Manage connections' : 'Connect a platform'}
            </ButtonLink>
          </div>
        )}

        {step === 'domain' && (
          <div className="space-y-4">
            <div>
              <p className="sc-tiny">Step 3</p>
              <Title as="h2">Verify your domain</Title>
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                Run the portal on your own white-label domain.
              </p>
            </div>
            <SignalRow
              done={domainVerified}
              doneLabel="Your domain is verified."
              todoLabel="Domain not verified yet."
            />
            <ButtonLink href={scopedHref('/portal/settings/domain')} size="sm">
              {domainVerified ? 'Manage domain' : 'Set up domain'}
            </ButtonLink>
          </div>
        )}

        {step === 'contact' && (
          <div className="space-y-4">
            <div>
              <p className="sc-tiny">Step 4</p>
              <Title as="h2">Add your first contact</Title>
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                Start building your audience right inside the CRM.
              </p>
            </div>
            {contactAdded ? (
              <SignalRow done doneLabel="Contact added to your CRM." todoLabel="" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="growth-contact-name" label="Name">
                  <Input
                    id="growth-contact-name"
                    aria-label="Name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Jane Doe"
                  />
                </Field>
                <Field id="growth-contact-email" label="Email">
                  <Input
                    id="growth-contact-email"
                    aria-label="Email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="jane@acme.com"
                  />
                </Field>
              </div>
            )}
            {contactError ? <Notice tone="danger">{contactError}</Notice> : null}
            {!contactAdded ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={addContact}
                  disabled={contactSaving || !contactName.trim() || !contactEmail.trim()}
                  loading={contactSaving}
                  size="sm"
                >
                  Add contact
                </Button>
                <ButtonLink href={scopedHref('/portal/contacts/new')} variant="ghost" size="sm">
                  Use the full contact form
                </ButtonLink>
              </div>
            ) : null}
          </div>
        )}

        {step === 'analytics' && (
          <div className="space-y-4">
            <div>
              <p className="sc-tiny">Step 5</p>
              <Title as="h2">Install analytics</Title>
              <p className="sc-body mt-1 text-[var(--sc-ink-soft)]">
                Connect a property so KPIs and revenue flow into your dashboard.
              </p>
            </div>
            <SignalRow
              done={analyticsInstalled}
              doneLabel="An analytics connection is live."
              todoLabel="No analytics connections yet."
            />
            <ButtonLink href={scopedHref('/portal/properties')} size="sm">
              {analyticsInstalled ? 'Manage properties' : 'Set up a property'}
            </ButtonLink>
          </div>
        )}
        </div>
      </Panel>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
        >
          Back
        </Button>
        <div className="flex items-center gap-3">
          {!isLast ? (
            <Button type="button" variant="ghost" size="sm" onClick={skip}>
              Skip for now
            </Button>
          ) : null}
          {isLast ? (
            <Button type="button" onClick={finish} disabled={finishing} loading={finishing} size="sm">
              Finish setup
            </Button>
          ) : (
            <Button
              type="button"
              onClick={goNext}
              disabled={orgSaving || contactSaving}
              loading={orgSaving || contactSaving}
              size="sm"
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function SignalRow({ done, doneLabel, todoLabel }: { done: boolean; doneLabel: string; todoLabel: string }) {
  if (done) {
    return (
      <div className="flex items-center gap-2 border border-[var(--sc-line)] bg-[var(--sc-surface)] px-3 py-2.5" style={{ borderRadius: '6px' }}>
        <Status tone="success">{doneLabel}</Status>
      </div>
    )
  }
  if (!todoLabel) return null
  return (
    <div className="flex items-center gap-2 border border-[var(--sc-line)] bg-[var(--sc-surface)] px-3 py-2.5 sc-body text-[var(--sc-ink-soft)]" style={{ borderRadius: '6px' }}>
      <Icon name="radio_button_unchecked" />
      {todoLabel}
    </div>
  )
}
