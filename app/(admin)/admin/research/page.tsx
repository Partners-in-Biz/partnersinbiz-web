'use client'

import { useEffect, useState } from 'react'
import { ResearchListClient } from '@/components/research/ResearchListClient'

type Org = { id: string; name: string; slug?: string }

export default function AdminResearchPage() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((res) => res.json())
      .then((body) => setOrgs(body.data ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="pib-skeleton h-64" />

  return (
    <ResearchListClient
      mode="admin"
      title="Research"
      description="Structured client and internal intelligence: findings, sources, recommendations, comments, and Obsidian exports."
      basePath="/admin/research"
      orgs={orgs}
    />
  )
}
