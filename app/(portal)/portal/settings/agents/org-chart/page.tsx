'use client'

/**
 * Portal Agent Org Chart — active organisation auto-selected.
 * Org owners/admins can build a different hierarchy per client org.
 *
 * Uses usePortalOrgScope so URL orgId and the shell workspace switcher stay
 * aligned. Never falls back to the first org in the membership list for the
 * page label when a different active orgId is selected (that produced
 * "Partners in Biz" in the switcher with a UAT org name on this page).
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AgentOrgChartClient from '@/components/agents/org-chart/AgentOrgChartClient'
import { usePortalOrgScope } from '@/lib/portal/usePortalOrgScope'
import { scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'

export default function PortalAgentOrgChartPage() {
  const routeScope = usePortalOrgScope()
  const [orgId, setOrgId] = useState<string>('')
  const [orgName, setOrgName] = useState<string>('')
  const [role, setRole] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const orgEndpoint = useMemo(
    () => (routeScope.orgId ? scopedApiPath('/api/v1/portal/org', routeScope) : ''),
    [routeScope],
  )

  useEffect(() => {
    // Wait until URL or active-org inheritance has resolved a workspace.
    if (!routeScope.orgId || !orgEndpoint) {
      setReady(false)
      return
    }

    let cancelled = false
    setReady(false)
    setBootError(null)
    ;(async () => {
      try {
        const meRes = await fetch(orgEndpoint, { cache: 'no-store' })
        const meBody = await meRes.json().catch(() => ({}))
        if (!meRes.ok) {
          throw new Error(meBody?.error ?? `Failed to load organisation (${meRes.status})`)
        }

        const org = meBody.org ?? meBody.data?.org ?? {}
        const resolvedOrgId = String(org.id || routeScope.orgId || '').trim()
        const resolvedOrgName = String(org.name || resolvedOrgId).trim()
        if (!resolvedOrgId) throw new Error('No active organisation on this session')

        const user = meBody.user ?? meBody.data?.user ?? {}
        let memberRole: string | null =
          (typeof user.memberRole === 'string' && user.memberRole) ||
          (typeof user.role === 'string' && user.role) ||
          (typeof meBody.role === 'string' && meBody.role) ||
          null

        // Fallback: membership endpoint when /portal/org does not expose role.
        if (!memberRole) {
          const memRes = await fetch(
            `/api/v1/portal/org-members/me?orgId=${encodeURIComponent(resolvedOrgId)}`,
            { cache: 'no-store' },
          ).catch(() => null)
          if (memRes && memRes.ok) {
            const memBody = await memRes.json().catch(() => ({}))
            const mem = memBody.data ?? memBody
            if (typeof mem.role === 'string') memberRole = mem.role
          }
        }

        if (cancelled) return
        setOrgId(resolvedOrgId)
        setOrgName(resolvedOrgName)
        setRole(memberRole)
        setReady(true)
      } catch (e) {
        if (!cancelled) {
          setBootError(e instanceof Error ? e.message : 'Failed to resolve active organisation')
          setOrgId('')
          setOrgName('')
          setReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgEndpoint, routeScope.orgId])

  // Owner/admin edit; if role unknown after boot, allow try (API still enforces admin).
  const canEdit = role === 'owner' || role === 'admin' || role === null
  const agentsHref = useMemo(
    () => scopedPortalPath('/portal/settings/agents', routeScope),
    [routeScope],
  )

  if (!routeScope.orgId || !ready) {
    return (
      <div className="p-6 text-sm text-[var(--color-pib-text-muted)]">Loading organisation…</div>
    )
  }

  if (bootError || !orgId) {
    return (
      <div className="space-y-3 p-6">
        <h1 className="text-xl font-semibold text-[var(--color-pib-text)]">Agent org chart</h1>
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {bootError || 'No active organisation'}
        </div>
        <Link href={agentsHref} className="text-sm text-cyan-300 hover:underline">
          Back to Agents
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-pib-text-muted)]">
        <Link href={agentsHref} className="inline-flex items-center gap-1 hover:text-[var(--color-pib-text)]">
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          Agents
        </Link>
        <span aria-hidden>·</span>
        <span>Agent org chart</span>
      </div>

      <AgentOrgChartClient
        mode="portal"
        orgId={orgId}
        orgLabel={orgName}
        canEdit={canEdit}
        apiBase="/api/v1/portal/settings/agents/org-chart"
        agentsListUrl="/api/v1/portal/settings/agents"
        allowRuntimeTab={false}
        allowLiveRuntimeSync={false}
        seedTemplate={orgId === 'pib-platform-owner' ? 'platform' : 'minimal'}
        title="Agent organisation"
        description="Build this organisation’s agent hierarchy. Seats can bind to linked-machine agent profiles. Ask Pip to provision profiles from a structure brief (skill: pib-agent-org-setup)."
      />
    </div>
  )
}
