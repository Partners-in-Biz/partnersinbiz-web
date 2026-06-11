'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useOrg } from '@/lib/contexts/OrgContext'

interface OrgChoice {
  id: string
  name: string
  slug?: string
  websiteUrl?: string
}

function NewSprintForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedOrgId, orgs: contextOrgs } = useOrg()

  const [orgs, setOrgs] = useState<OrgChoice[]>([])
  const [clientId, setClientId] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [autopilotMode, setAutopilotMode] = useState<'off' | 'safe' | 'full'>('safe')
  const [pagespeedEnabled, setPagespeedEnabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolve list of organisations from context (or fetch as fallback). The
  // `clientId` here is the Firestore organization id — same pattern the rest
  // of the SEO module uses (`orgId` and `clientId` are both the org doc id).
  useEffect(() => {
    if (contextOrgs.length > 0) {
      setOrgs(
        contextOrgs.map((o) => ({
          id: o.id,
          name: o.name,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          slug: (o as any).slug,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          websiteUrl: (o as any).websiteUrl,
        })),
      )
      return
    }
    void (async () => {
      try {
        const res = await fetch('/api/v1/organizations')
        const json = await res.json()
        if (json.success ?? json.data) setOrgs(json.data ?? [])
      } catch {
        // ignore
      }
    })()
  }, [contextOrgs])

  // Pre-fill from URL query params and/or workspace context. Priority:
  //   1. ?orgId / ?clientId from URL  → set explicitly
  //   2. selectedOrgId from OrgContext (workspace mode)
  //   3. nothing — user picks from dropdown
  useEffect(() => {
    const qOrgId = searchParams?.get('orgId') ?? searchParams?.get('clientId') ?? ''
    const qSiteName = searchParams?.get('siteName') ?? ''
    const qSiteUrl = searchParams?.get('siteUrl') ?? ''

    if (qOrgId) {
      setClientId(qOrgId)
    } else if (selectedOrgId) {
      setClientId(selectedOrgId)
    }

    if (qSiteName) setSiteName(qSiteName)
    if (qSiteUrl) setSiteUrl(qSiteUrl)
  }, [searchParams, selectedOrgId])

  // When the selected client changes, auto-fill siteName from the org if not
  // already set.
  useEffect(() => {
    if (!clientId) return
    const org = orgs.find((o) => o.id === clientId)
    if (!org) return
    if (!siteName) setSiteName(org.name)
    if (!siteUrl && org.websiteUrl) setSiteUrl(org.websiteUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, orgs])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!clientId || !siteUrl || !siteName) {
      setError('All fields required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/v1/seo/sprints', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `sprint-${Date.now()}` },
        body: JSON.stringify({
          // We send orgId AND clientId as the same value — Pip skill / API both honour either
          orgId: clientId,
          clientId,
          siteUrl,
          siteName,
          autopilotMode,
          pagespeedEnabled,
        }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error ?? 'Failed to create sprint')
        setSubmitting(false)
        return
      }
      router.push(`/portal/seo/sprints/${json.data.id}/settings?welcome=1`)
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  const selectedOrg = orgs.find((o) => o.id === clientId)
  const modeOptions = [
    ['off', 'edit_note', 'Off', 'Pip drafts only. You approve everything.'],
    ['safe', 'shield', 'Safe', 'Default mode. Pip runs low-risk drafts and queues publishing work.'],
    ['full', 'rocket_launch', 'Full', 'Pip can publish blog posts and repurpose approved content.'],
  ] as const

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex flex-col gap-2">
        <p className="pib-label">Growth setup</p>
        <h1 className="pib-page-title">New SEO Sprint</h1>
        <p className="pib-page-sub max-w-2xl">
          Creates a 90-day sprint seeded from the Outrank-90 template (42 tasks + 15 directories).
        </p>
      </header>

      <form onSubmit={submit} className="pib-card-section">
        <div className="pib-card-section-header">
          <h2 className="text-sm font-semibold text-[var(--color-pib-text)]">Sprint details</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Map the sprint to a client workspace and canonical site URL.</p>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="pib-label">Client</span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="pib-select"
              required
            >
              <option value="">Pick client</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {selectedOrg && (
              <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">
                Pre-filled from workspace context.
              </p>
            )}
          </label>

          <label className="block">
            <span className="pib-label">Site URL</span>
            <input
              type="url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="pib-input"
              required
            />
          </label>

          <label className="block">
            <span className="pib-label">Site name</span>
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="Example Co."
              className="pib-input"
              required
            />
          </label>
        </div>

        <fieldset className="border-t border-[var(--color-pib-line)] p-4">
          <legend className="sr-only">Autopilot mode</legend>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">Autopilot mode</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Choose the execution boundary for the new sprint.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {modeOptions.map(([val, icon, label, desc]) => {
              const selected = autopilotMode === val
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAutopilotMode(val)}
                  aria-pressed={selected}
                  className={[
                    'rounded-2xl border p-4 text-left transition',
                    selected
                      ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                      : 'border-[var(--color-pib-line)] bg-white/[0.02] hover:border-[var(--color-pib-line-strong)]',
                  ].join(' ')}
                >
                  <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">{icon}</span>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--color-pib-text)]">{label}</span>
                    {selected && <span className="pib-pill pib-pill-accent !px-2 !py-0.5">Active</span>}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{desc}</p>
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="flex flex-col gap-4 border-t border-[var(--color-pib-line)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-pib-text)]">PageSpeed Insights</h3>
            <p className="text-xs text-[var(--color-pib-text-muted)]">Enable Core Web Vitals checks for this sprint.</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-full border border-[var(--color-pib-line)] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-pib-text-muted)]">
            <input
              type="checkbox"
              checked={pagespeedEnabled}
              onChange={(e) => setPagespeedEnabled(e.target.checked)}
              className="sr-only"
            />
            <span className={pagespeedEnabled ? 'pib-pill pib-pill-info' : 'pib-pill'}>{pagespeedEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>

        {error && <p className="mx-4 mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        <div className="flex flex-col gap-3 border-t border-[var(--color-pib-line)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--color-pib-text-muted)]">
            After creating, connect Google Search Console and Bing Webmaster Tools from sprint settings.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="pib-btn-primary justify-center text-sm disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">{submitting ? 'autorenew' : 'add'}</span>
            {submitting ? 'Creating…' : 'Create sprint'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function NewSprintPage() {
  // useSearchParams must be inside a Suspense boundary
  return (
    <Suspense fallback={<div className="text-sm text-[var(--color-pib-text-muted)]">Loading…</div>}>
      <NewSprintForm />
    </Suspense>
  )
}
