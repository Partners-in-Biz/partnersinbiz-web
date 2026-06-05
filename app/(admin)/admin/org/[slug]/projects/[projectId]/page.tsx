'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ProjectDetailWorkspace } from '@/components/projects/ProjectDetailWorkspace'

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const projectId = params.projectId as string
  const deepLinkedTaskId = searchParams.get('taskId') ?? searchParams.get('task')

  return (
    <ProjectDetailWorkspace
      mode="admin"
      orgSlug={slug}
      projectId={projectId}
      deepLinkedTaskId={deepLinkedTaskId}
      onAdminProjectMoved={(nextSlug) => router.push(`/admin/org/${nextSlug}/projects/${projectId}?moved=1`)}
    />
  )
}
