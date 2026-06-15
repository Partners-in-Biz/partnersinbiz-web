'use client'

import { useParams } from 'next/navigation'
import { AdminResearchGovernanceWorkspace } from '@/components/research/AdminResearchGovernanceWorkspace'

export default function OrgResearchPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  return <AdminResearchGovernanceWorkspace orgSlug={slug} />
}
