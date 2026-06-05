'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ProjectsWorkspace } from '@/components/projects/ProjectsWorkspace'
import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'

export default function ProjectsPage() {
  const searchParams = useSearchParams()
  const orgScope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])

  return <ProjectsWorkspace mode="portal" orgScope={orgScope} />
}
