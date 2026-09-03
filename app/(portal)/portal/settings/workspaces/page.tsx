// app/(portal)/portal/settings/workspaces/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { Icon } from '@/components/studio'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'
import { PageHeader } from '@/components/ui/AppFoundation'

interface OrgItem {
  id: string
  name: string
  logoUrl: string
}

export default function WorkspacesPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const settingsPath = useCallback((path: string) => scopedPortalPath(path, orgScope), [orgScope])
  const [orgs, setOrgs] = useState<OrgItem[]>([])
  const [activeOrgId, setActiveOrgId] = useState('')
  const [switching, setSwitching] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const loadWorkspaces = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetch('/api/v1/portal/orgs')
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : `Failed to load workspaces (${response.status})`)
        }
        return body
      })
      .then((body) => {
        const nextOrgs = Array.isArray(body?.orgs) ? body.orgs : []
        const requestedOrgId = typeof orgScope.orgId === 'string' ? orgScope.orgId : ''
        const requestedOrg = requestedOrgId ? nextOrgs.find((org: OrgItem) => org.id === requestedOrgId) : null
        setOrgs(nextOrgs)
        setActiveOrgId(requestedOrg ? requestedOrg.id : typeof body?.activeOrgId === 'string' ? body.activeOrgId : '')
      })
      .catch((err) => {
        setOrgs([])
        setActiveOrgId('')
        setLoadError(err instanceof Error ? err.message : 'Workspace list could not load.')
      })
      .finally(() => setLoading(false))
  }, [orgScope.orgId])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const activeOrg = useMemo(() => orgs.find((org) => org.id === activeOrgId), [activeOrgId, orgs])
  const switchReadyCount = orgs.filter((org) => org.id !== activeOrgId).length

  function orgInitial(org: OrgItem): string {
    return org.name[0]?.toUpperCase() ?? 'W'
  }

  function workspaceCountLabel(): string {
    return `${orgs.length} company workspace${orgs.length === 1 ? '' : 's'}`
  }

  function activeWorkspaceLabel(): string {
    return activeOrg ? `${activeOrg.name} active` : 'No active workspace'
  }

  async function handleSwitch(orgId: string) {
    if (orgId === activeOrgId || switching) return
    setSwitchError(null)
    setSwitching(orgId)
    try {
      const response = await fetch('/api/v1/portal/active-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(typeof body?.error === 'string' ? body.error : `Failed to switch workspace (${response.status})`)
      }
      setActiveOrgId(orgId)
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : 'Workspace switch failed.')
    } finally {
      setSwitching('')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4" data-module-accent="cyan" role="status" aria-label="Loading workspaces">
        <p className="eyebrow">CRM settings</p>
        <div className="h-8 w-56 rounded bg-white/10" />
        <div className="grid gap-3 md:grid-cols-3">
          <div className="h-24 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
          <div className="h-24 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
          <div className="h-24 rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03]" />
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader
          accent="cyan"
          eyebrow="CRM settings"
          title="Workspace control"
          description="See and switch the company context that drives CRM contacts, deals, reports, and employee access."
        />
        <section className="rounded-lg border border-[var(--sc-line)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-5" role="alert">
          <p className="eyebrow !text-[10px] text-[var(--st-warning)]">Workspace source</p>
          <h2 className="mt-2 text-xl text-[var(--color-pib-text)]">Workspaces could not load</h2>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{loadError}</p>
          <button type="button" onClick={loadWorkspaces} className="btn-pib-secondary mt-4 text-sm">
            <Icon name="refresh" />
            Retry loading workspaces
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        accent="cyan"
        eyebrow="CRM settings"
        title="Workspace control"
        description="Choose the company context that drives CRM contacts, deals, reports, and employee access."
        actions={(
          <Link href="/portal/personal/marketing" className="btn-pib-secondary btn-pib-sm w-fit text-sm">
                    <Icon name="person" />
                    Personal marketing
                  </Link>
        )}
      />

      <section role="region" aria-label="Workspace command center" className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow !text-[10px]">Executive context</p>
            <h2 className="mt-2 text-2xl text-[var(--color-pib-text)]">Workspace command center</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Keep every employee working in the right company before CRM activity, reporting, and setup changes move.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={settingsPath('/portal/settings/team')} className="btn-pib-secondary text-xs">
              <Icon name="groups" />
              Review team access
            </Link>
            <Link href={settingsPath('/portal/settings/crm-setup')} className="btn-pib-secondary text-xs">
              <Icon name="rule_settings" />
              Review CRM setup
            </Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">Company reach</p>
            <p className="mt-3 text-2xl text-[var(--color-pib-text)]">{workspaceCountLabel()}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Available to this account.</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">Active context</p>
            <p className="mt-3 text-2xl text-[var(--color-pib-text)]">{activeWorkspaceLabel()}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Used by CRM lists, reports, and settings.</p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <p className="eyebrow !text-[10px]">Handoffs</p>
            <p className="mt-3 text-2xl text-[var(--color-pib-text)]">{switchReadyCount} switch-ready</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Other company contexts ready to open.</p>
          </div>
        </div>
      </section>

      {switchError && (
        <div role="status" aria-label="Workspace switch failed" className="rounded-lg border border-[var(--sc-line)] bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] p-4">
          <p className="text-sm font-medium text-[var(--st-warning)]">{switchError}</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            The active workspace stayed unchanged so team activity does not move into the wrong CRM context.
          </p>
        </div>
      )}

      <section className="space-y-3" aria-label="Company workspaces">
        {orgs.map((org) => (
          <div
            key={org.id}
            className={[
              'rounded-lg border px-5 py-4 transition-colors',
              org.id === activeOrgId
                ? 'border-[var(--color-pib-accent)]/50 bg-[var(--color-pib-accent-soft)]/20'
                : 'border-[var(--color-pib-line)] bg-white/[0.03] hover:border-[var(--color-pib-accent)]/40',
            ].join(' ')}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="text-sm">
                  {orgInitial(org)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--color-pib-text)]">{org.name}</p>
                  <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                    {org.id === activeOrgId ? 'Current CRM company context' : 'Available company workspace'}
                  </p>
                </div>
              </div>
              {org.id === activeOrgId ? (
                <span className="pib-pill pib-pill-success w-fit inline-flex items-center gap-1">
                  <Icon name="check_circle" />
                  Active workspace
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSwitch(org.id)}
                  disabled={!!switching}
                  className="btn-pib-secondary w-fit text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Switch to ${org.name} workspace`}
                >
                  <Icon name={switching === org.id ? 'hourglass_empty' : 'sync_alt'} />
                  {switching === org.id ? 'Switching...' : 'Switch workspace'}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
