'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Notice, Panel, Skeleton } from '@/components/studio'
import LlmProviderConnections from '@/components/settings/LlmProviderConnections'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function LlmProvidersSettingsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const [orgId, setOrgId] = useState<string | null>(orgScope.orgId ?? orgScope.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(!orgId)

  useEffect(() => {
    const fromQuery = orgScope.orgId ?? orgScope.id ?? null
    if (fromQuery) {
      setOrgId(fromQuery)
      setError(null)
      setResolving(false)
      return
    }

    let cancelled = false
    setResolving(true)
    setError(null)
    void fetch(scopedApiPath('/api/v1/portal/org', orgScope))
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : 'Could not resolve organisation')
        }
        const id = typeof body?.org?.id === 'string' ? body.org.id : null
        if (!id) throw new Error('No active organisation on this account')
        if (!cancelled) {
          setOrgId(id)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setOrgId(null)
          setError(err instanceof Error ? err.message : 'Could not resolve organisation')
        }
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })

    return () => {
      cancelled = true
    }
  }, [orgScope])

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="LLM providers."
        description="Organisation credentials sync to your shared VPS. Personal credentials sync only to computers owned by your account. A model becomes selectable in Messages only after that exact machine and agent profile passes a live provider check."
      />
      {resolving ? (
        <Panel className="space-y-3">
          <Skeleton height={20} width={220} />
          <Skeleton height={16} className="w-full" />
        </Panel>
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : orgId ? (
        <LlmProviderConnections orgId={orgId} />
      ) : (
        <Notice tone="info">No organisation selected.</Notice>
      )}
    </div>
  )
}
