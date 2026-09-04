'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Notice, Panel, Skeleton } from '@/components/studio'
import { IntegrationsPanel } from '@/components/settings/integrations/IntegrationsPanel'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function IntegrationsSettingsPage() {
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
          setResolving(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not resolve organisation')
          setResolving(false)
        }
      })
    return () => { cancelled = true }
  }, [orgScope])

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader title="Integrations" description="Connect GitHub, Slack, and Linear for bot routine event triggers." />
      {resolving ? (
        <Panel><Skeleton className="h-40 w-full" /></Panel>
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : orgId ? (
        <IntegrationsPanel orgId={orgId} />
      ) : null}
    </div>
  )
}
