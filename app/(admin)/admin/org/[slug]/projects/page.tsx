'use client'

import { useParams } from 'next/navigation'
import { ProjectsWorkspace } from '@/components/projects/ProjectsWorkspace'

export default function ProjectsPage() {
  const params = useParams()
  const slug = params.slug as string

  return <ProjectsWorkspace mode="admin" orgSlug={slug} />
}
