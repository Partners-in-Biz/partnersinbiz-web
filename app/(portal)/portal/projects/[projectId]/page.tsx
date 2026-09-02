'use client'

import { useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ProjectDetailWorkspace } from '@/components/projects/ProjectDetailWorkspace'
import { CompanyWorkRecordControls } from '@/components/crm/CompanyWorkRecordControls'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function ProjectDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const projectId = params.projectId as string
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const deepLinkedTaskId = searchParams.get('taskId') ?? searchParams.get('task')

  return (
    <>
      <CompanyWorkRecordControls
        className="mb-4"
        module="projects"
        recordId={projectId}
        orgId={orgScope.orgId}
      />
      <ProjectDetailWorkspace
        mode="portal"
        orgScope={orgScope}
        projectId={projectId}
        deepLinkedTaskId={deepLinkedTaskId}
      />
    </>
  )
}
