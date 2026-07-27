'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
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
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-module-accent="cyan">
      <PageHeader
        eyebrow="Settings"
        title="LLM providers"
        description="Organisation credentials sync to your shared VPS. Personal credentials sync to your linked computers, and to the organisation VPS when Team access enables that option. Empty rows here do not mean Hermes has no keys: Auto in Messages still uses Hermes-native credentials on the target machine."
        accent="cyan"
      />
      {resolving ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Resolving organisation…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-200">{error}</p>
      ) : orgId ? (
        <LlmProviderConnections orgId={orgId} />
      ) : (
        <p className="text-sm text-[var(--color-pib-text-muted)]">No organisation selected.</p>
      )}
    </div>
  )
}
