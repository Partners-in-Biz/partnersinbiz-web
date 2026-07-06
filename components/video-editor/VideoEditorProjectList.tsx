'use client'

import { useEffect, useMemo, useState } from 'react'
import { scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'
import type { VideoEditorProject } from '@/lib/video-editor/types'

export function VideoEditorProjectList({
  orgId,
  channelWorkspaceId,
  compact = false,
  onOpen,
}: {
  orgId?: string
  channelWorkspaceId?: string
  compact?: boolean
  onOpen?: (projectId: string) => void
}) {
  const [projects, setProjects] = useState<Array<VideoEditorProject & { id: string }>>([])
  const [title, setTitle] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const apiPath = useMemo(() => scopedApiPath('/api/v1/video-editor/projects', { orgId }), [orgId])

  async function load() {
    if (!orgId) {
      setLoading(false)
      setProjects([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(apiPath)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load editor projects')
      setProjects((body.data?.projects ?? body.projects ?? []) as Array<VideoEditorProject & { id: string }>)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load editor projects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath])

  async function createProject() {
    if (!orgId || !title.trim()) return
    setNotice('')
    const res = await fetch('/api/v1/video-editor/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, title: title.trim(), channelWorkspaceId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not create editor project')
      return
    }
    const id = body.data?.id as string
    setTitle('')
    await load()
    if (id) {
      if (onOpen) onOpen(id)
      else window.location.href = scopedPortalPath(`/portal/video-editor?projectId=${encodeURIComponent(id)}`, { orgId })
    }
  }

  return (
    <section className={compact ? 'space-y-3' : 'pib-card-section space-y-4 p-5'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-headline text-xl font-semibold text-on-surface">Video Editor projects</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Create the editable cut here, add source media from Marketing Studio or YouTube assets, render an MP4, then send it back into YouTube review or the canvas library.
          </p>
        </div>
      </div>
      {notice ? <p className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-on-surface-variant">{notice}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New edit title"
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
        />
        <button type="button" className="pib-btn-primary justify-center" disabled={!orgId || !title.trim()} onClick={() => void createProject()}>
          Create edit
        </button>
      </div>
      {loading ? <div className="pib-skeleton h-24" /> : null}
      <div className="grid gap-3">
        {!loading && projects.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-pib-line)] p-4 text-sm text-on-surface-variant">
            No editable video projects yet.
          </div>
        ) : null}
        {projects.map((project) => {
          const href = scopedPortalPath(`/portal/video-editor?projectId=${encodeURIComponent(project.id)}`, { orgId })
          return (
            <article key={project.id} className="rounded-lg border border-[var(--color-pib-line)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words font-semibold text-on-surface">{project.title}</h3>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    {project.status} / {project.settings?.width ?? 1920}x{project.settings?.height ?? 1080} / {project.timeline?.tracks?.length ?? 0} tracks
                  </p>
                </div>
                {onOpen ? (
                  <button type="button" className="pib-btn-primary text-sm" onClick={() => onOpen(project.id)}>Open editor</button>
                ) : (
                  <a className="pib-btn-primary text-sm" href={href}>Open editor</a>
                )}
              </div>
              {project.lastRender?.url ? <a className="mt-3 inline-block text-sm text-[var(--color-pib-primary)]" href={project.lastRender.url} target="_blank" rel="noreferrer">Latest render</a> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
