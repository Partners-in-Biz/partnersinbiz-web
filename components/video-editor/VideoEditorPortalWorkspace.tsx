'use client'

import { useMemo, useState } from 'react'
import { scopedPortalPath } from '@/lib/portal/scoped-routing'
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
            <span className="material-symbols-rounded text-base">arrow_back</span>
            Projects
          </a>
        </div>
        <VideoEditorShell orgId={orgId} projectId={activeProjectId} />
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Studio</p>
          <h1 className="font-headline text-3xl font-bold text-on-surface">Video Editor</h1>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
            Build the actual video cut here: import source media, arrange clips, add text, render an MP4, and register the output back into YouTube Studio and Marketing Studio.
          </p>
        </div>
      </div>
      <VideoEditorProjectList orgId={orgId} onOpen={setActiveProjectId} />
    </main>
  )
}
