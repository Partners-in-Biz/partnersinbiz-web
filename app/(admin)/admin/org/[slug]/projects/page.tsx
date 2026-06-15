'use client'

import { useParams } from 'next/navigation'
import { AdminProjectsGovernanceWorkspace } from '@/components/projects/AdminProjectsGovernanceWorkspace'

export default function ProjectsPage() {
  const params = useParams()
  const slug = params.slug as string

  return <AdminProjectsGovernanceWorkspace orgSlug={slug} />
}
