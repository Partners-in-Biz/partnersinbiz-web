'use client'

import { Icon } from '@/components/studio'

import { useMemo, useState } from 'react'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
import { PageHeader } from '@/components/ui/AppFoundation'
import { VideoEditorProjectList } from './VideoEditorProjectList'
import { VideoEditorShell } from './VideoEditorShell'

export function VideoEditorPortalWorkspace({ orgId, projectId }: { orgId?: string; projectId?: string }) {
  const [activeProjectId, setActiveProjectId] = useState(projectId ?? '')
  const backHref = useMemo(() => scopedPortalPath('/portal/video-editor', { orgId }), [orgId])

  if (activeProjectId) {
    return (
      <div>
        <div className="mx-auto max-w-[1600px] px-4 pt-4 sm:px-6 lg:px-8">
          <a className="pib-btn-ghost text-sm" href={backHref} onClick={() => setActiveProjectId('')}>
            <Icon name="arrow_back" />
            Projects
          </a>
        </div>
        <VideoEditorShell orgId={orgId} projectId={activeProjectId} />
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6 lg:p-8" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow="Studio"
        title="Video Editor"
        description="Build the actual video cut here: import source media, arrange clips, add text, render an MP4, and register the output back into YouTube Studio and Marketing Studio."
      />
      <VideoEditorProjectList orgId={orgId} onOpen={setActiveProjectId} />
    </main>
  )
}
