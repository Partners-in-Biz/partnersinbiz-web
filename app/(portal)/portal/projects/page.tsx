'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProjectsWorkspace } from '@/components/projects/ProjectsWorkspace'
import { SharedWithUsSection } from '@/components/crm/SharedWithUsSection'
import { scopeFromSearchParams, scopedPortalPath } from '@/lib/portal/scoped-routing'

/**
 * Projects portfolio page.
 * Legacy notification links (`?task=` / `?taskId=` without a project path) are resolved
 * to `/portal/projects/{projectId}?taskId=...` when the standalone task has a projectId.
 */
export default function ProjectsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const deepTaskId = searchParams.get('taskId') ?? searchParams.get('task')
  const [resolvingTask, setResolvingTask] = useState(Boolean(deepTaskId))

  useEffect(() => {
    if (!deepTaskId) {
      setResolvingTask(false)
      return
    }

    let cancelled = false
    setResolvingTask(true)

    void (async () => {
      try {
        const res = await fetch(`/api/v1/tasks/${encodeURIComponent(deepTaskId)}`)
        if (!res.ok) return
        const body = await res.json() as { data?: { projectId?: string | null } }
        const projectId = typeof body.data?.projectId === 'string' ? body.data.projectId.trim() : ''
        if (!projectId || cancelled) return
        const target = scopedPortalPath(
          `/portal/projects/${encodeURIComponent(projectId)}?taskId=${encodeURIComponent(deepTaskId)}`,
          orgScope,
        )
        router.replace(target)
      } catch {
        // Keep the portfolio view if lookup fails.
      } finally {
        if (!cancelled) setResolvingTask(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [deepTaskId, orgScope, router])

  if (resolvingTask && deepTaskId) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-8 text-sm text-[var(--color-pib-text-muted)]">
        Opening task…
      </div>
    )
  }

  return (
    <>
      <SharedWithUsSection
        module="projects"
        orgId={orgScope.orgId ?? undefined}
        companyId={orgScope.sourceCompanyId}
        hrefForRecord={(record) => scopedPortalPath(`/portal/projects/${record.id}`, orgScope)}
      />
      <ProjectsWorkspace mode="portal" orgScope={orgScope} />
    </>
  )
}
