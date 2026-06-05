'use client'

import { useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ProjectDetailWorkspace } from '@/components/projects/ProjectDetailWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function ProjectDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.projectId as string
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const deepLinkedTaskId = searchParams.get('taskId') ?? searchParams.get('task')

  return (
    <ProjectDetailWorkspace
      mode="portal"
      orgScope={orgScope}
      projectId={projectId}
      deepLinkedTaskId={deepLinkedTaskId}
    />
  )
}
