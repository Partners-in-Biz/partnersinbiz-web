'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import LlmProviderConnections from '@/components/settings/LlmProviderConnections'

export default function LlmProvidersSettingsPage() {
  const searchParams = useSearchParams()
  const [orgId, setOrgId] = useState<string | null>(searchParams.get('orgId'))

  useEffect(() => {
    const fromQuery = searchParams.get('orgId')
    if (fromQuery) {
      setOrgId(fromQuery)
      return
    }
    void fetch('/api/v1/portal/settings/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const id = body?.data?.orgId || body?.orgId || body?.data?.activeOrgId
        if (typeof id === 'string' && id) setOrgId(id)
      })
      .catch(() => undefined)
  }, [searchParams])

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader
        eyebrow="Settings"
        title="LLM providers"
        description="Organisation credentials sync to your shared VPS. Personal credentials stay on each user’s linked computer — never pushed to the org VPS. Connected org providers appear in the Messages model selector when running on that VPS."
        accent="cyan"
      />
      {!orgId ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Resolving organisation…</p>
      ) : (
        <LlmProviderConnections orgId={orgId} />
      )}
    </div>
  )
}
