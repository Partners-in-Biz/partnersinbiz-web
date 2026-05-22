'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { ResearchListClient } from '@/components/research/ResearchListClient'

export default function OrgResearchPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((res) => res.json())
      .then((body) => {
        const match = (body.data ?? []).find((candidate: { id: string; name: string; slug?: string }) => candidate.slug === slug)
        if (match) setOrg({ id: match.id, name: match.name })
      })
      .finally(() => setLoading(false))
  }, [slug])

  return (
    <OrgThemedFrame orgId={org?.id ?? null} className="-m-6 min-h-screen p-6">
      {loading ? <div className="pib-skeleton h-64" /> : (
        <ResearchListClient
          mode="admin"
          title="Research"
          description="Working intelligence for this client: evidence, findings, recommendations, comments, and Obsidian export state."
          basePath={`/admin/org/${slug}/research`}
          orgId={org?.id}
          orgName={org?.name}
        />
      )}
    </OrgThemedFrame>
  )
}
