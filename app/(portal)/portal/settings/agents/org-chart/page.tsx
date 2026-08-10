'use client'

/**
 * Portal Agent Org Chart — active organisation auto-selected.
 * Org owners/admins can build a different hierarchy per client org.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AgentOrgChartClient from '@/components/agents/org-chart/AgentOrgChartClient'
import { scopeFromSearchParams, scopedPortalPath } from '@/lib/portal/scoped-routing'

export default function PortalAgentOrgChartPage() {
  const searchParams = useSearchParams()
  const routeScope = scopeFromSearchParams(searchParams)
  const [orgId, setOrgId] = useState<string>('')
  const [orgName, setOrgName] = useState<string>('')
  const [role, setRole] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [orgsRes, meRes] = await Promise.all([
          fetch('/api/v1/portal/orgs'),
          fetch('/api/v1/portal/org').catch(() => null),
        ])
        const orgsBody = await orgsRes.json().catch(() => ({}))
        if (!orgsRes.ok) {
          throw new Error(orgsBody?.error ?? `Failed to load organisations (${orgsRes.status})`)
        }
        const activeOrgId = String(orgsBody.activeOrgId || '')
        const orgs = Array.isArray(orgsBody.orgs) ? orgsBody.orgs : []
        const active = orgs.find((o: { id?: string }) => o?.id === activeOrgId) || orgs[0]
        if (!activeOrgId && !active?.id) throw new Error('No active organisation on this session')

        let memberRole: string | null = null
        if (meRes && meRes.ok) {
          const meBody = await meRes.json().catch(() => ({}))
          const me = meBody.data ?? meBody
          memberRole =
            (typeof me.role === 'string' && me.role) ||
            (typeof me.memberRole === 'string' && me.memberRole) ||
            (typeof me.organization?.role === 'string' && me.organization.role) ||
            null
        }

        // Fallback: membership endpoint when /portal/org does not expose role.
        if (!memberRole) {
          const memRes = await fetch(
            `/api/v1/portal/org-members/me?orgId=${encodeURIComponent(activeOrgId || active.id)}`,
          ).catch(() => null)
          if (memRes && memRes.ok) {
            const memBody = await memRes.json().catch(() => ({}))
            const mem = memBody.data ?? memBody
            if (typeof mem.role === 'string') memberRole = mem.role
          }
        }

        if (cancelled) return
        setOrgId(String(activeOrgId || active.id))
        setOrgName(String(active?.name || activeOrgId || active.id))
        setRole(memberRole)
        setReady(true)
      } catch (e) {
        if (!cancelled) {
          setBootError(e instanceof Error ? e.message : 'Failed to resolve active organisation')
          setReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Owner/admin edit; if role unknown after boot, allow try (API still enforces admin).
  const canEdit = role === 'owner' || role === 'admin' || role === null
  const agentsHref = useMemo(
    () => scopedPortalPath('/portal/settings/agents', routeScope),
    [routeScope],
  )

  if (!ready) {
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
