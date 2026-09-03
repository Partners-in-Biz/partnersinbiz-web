'use client'

/**
 * Admin Agent Org Chart - multi-org switcher + full live runtime drawer.
 * Shared surface: components/agents/org-chart/AgentOrgChartClient.tsx
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AgentOrgChartClient from '@/components/agents/org-chart/AgentOrgChartClient'

const PLATFORM_ORG = 'pib-platform-owner'

type SessionInfo = { isSuperAdmin?: boolean }

export default function AdminAgentOrgChartPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [orgId, setOrgId] = useState(() => searchParams.get('orgId')?.trim() || PLATFORM_ORG)
  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string }>>([
    { id: PLATFORM_ORG, name: 'Partners in Biz (platform)' },
  ])

  useEffect(() => {
    const q = searchParams.get('orgId')?.trim()
    if (q && q !== orgId) setOrgId(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((res) => (res.ok ? res.json() : null))
      .then((session: SessionInfo | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(session?.isSuperAdmin))
      })
      .catch(() => {
        if (!cancelled) setIsSuperAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/admin/organizations?limit=200')
        const body = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const rows =
          (body.data?.organizations as Array<{ id?: string; orgId?: string; name?: string }> | undefined) ??
          (body.organizations as Array<{ id?: string; orgId?: string; name?: string }> | undefined) ??
          []
        const opts = rows
          .map((r) => ({
            id: String(r.orgId || r.id || ''),
            name: String(r.name || r.orgId || r.id || 'Org'),
          }))
          .filter((o) => o.id)
        if (opts.length > 0) {
          if (!opts.some((o) => o.id === PLATFORM_ORG)) {
            opts.unshift({ id: PLATFORM_ORG, name: 'Partners in Biz (platform)' })
          }
          setOrgOptions(opts)
        }
      } catch {
        // keep default PLATFORM_ORG option when list fails
        void 0
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onOrgChange = useCallback(
    (next: string) => {
      setOrgId(next)
      const params = new URLSearchParams(searchParams.toString())
      params.set('orgId', next)
      router.replace(`/admin/agents/org-chart?${params.toString()}`)
    },
    [router, searchParams],
  )

  return (
    <AgentOrgChartClient
      mode="admin"
      orgId={orgId}
      orgOptions={orgOptions}
      onOrgChange={onOrgChange}
      canEdit={isSuperAdmin}
      apiBase="/api/v1/admin/agent-org"
      agentsListUrl="/api/v1/admin/agents"
      allowRuntimeTab
      allowLiveRuntimeSync
      seedTemplate={orgId === PLATFORM_ORG ? 'platform' : 'minimal'}
      title="Agent org chart"
      description="Platform admin view. Each organisation has its own chart. Cyan chips = live machine model labels when a seat is bound."
      readOnlyMessage="Only super admins can edit org roles or live runtime profiles from admin. Org owners can edit their chart in Portal → Settings → Agent org chart."
    />
  )
}
