'use client'

import { useEffect, useMemo, useState } from 'react'
import { scopedApiPath, scopedPortalPath } from '@/lib/portal/scoped-routing'
import type { VideoEditorProject } from '@/lib/video-editor/types'

const EMPTY_CHANNEL_OPTIONS: Array<{ id?: string; title?: string; youtubeHandle?: string }> = []

export function VideoEditorProjectList({
  orgId,
  channelWorkspaceId,
  channelOptions = EMPTY_CHANNEL_OPTIONS,
  compact = false,
  onOpen,
}: {
  orgId?: string
  channelWorkspaceId?: string
  channelOptions?: Array<{ id?: string; title?: string; youtubeHandle?: string }>
  compact?: boolean
  onOpen?: (projectId: string) => void
}) {
  const [projects, setProjects] = useState<Array<VideoEditorProject & { id: string }>>([])
  const [title, setTitle] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedChannelWorkspaceId, setSelectedChannelWorkspaceId] = useState(channelWorkspaceId ?? '')
  const apiPath = useMemo(() => scopedApiPath('/api/v1/video-editor/projects', { orgId }), [orgId])
  const channelChoices = useMemo(
    () => channelOptions.filter((channel) => typeof channel.id === 'string' && channel.id.trim()),
    [channelOptions],
  )
  const effectiveChannelWorkspaceId = channelChoices.length > 0
    ? selectedChannelWorkspaceId
    : channelWorkspaceId
  const selectedChannel = channelChoices.find((channel) => channel.id === effectiveChannelWorkspaceId)
  const visibleProjects = channelChoices.length > 0
    ? projects.filter((project) => project.channelWorkspaceId === effectiveChannelWorkspaceId)
    : projects

  useEffect(() => {
    if (channelWorkspaceId) {
      setSelectedChannelWorkspaceId(channelWorkspaceId)
      return
    }
    if (!channelChoices.length) {
      setSelectedChannelWorkspaceId('')
      return
    }
    if (!channelChoices.some((channel) => channel.id === selectedChannelWorkspaceId)) {
      setSelectedChannelWorkspaceId(channelChoices[0]?.id ?? '')
    }
  }, [channelWorkspaceId, channelChoices, selectedChannelWorkspaceId])

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
      body: JSON.stringify({ orgId, title: title.trim(), channelWorkspaceId: effectiveChannelWorkspaceId }),
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
    <section className={compact ? 'space-y-3' : 'pib-card-section space-y-3 p-4'} data-module-accent="cyan">
      <div className="min-w-0">
        <h2 className="text-sm text-[var(--color-pib-text)]">Video Editor projects</h2>
        <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
          {channelChoices.length > 0
            ? 'Create channel-linked edits here, render an MP4, then send the output back into YouTube review.'
            : 'Create the editable cut here, add source media from Marketing Studio or YouTube assets, render an MP4, then send it back into YouTube review or the canvas library.'}
        </p>
      </div>
      {notice ? <p className="rounded-lg border border-[var(--color-pib-line)] p-3 text-sm text-[var(--color-pib-text-muted)]">{notice}</p> : null}
      {channelChoices.length > 0 ? (
        <label className="grid gap-2 text-sm text-[var(--color-pib-text-muted)]">
          <span className="font-label uppercase tracking-widest">YouTube channel</span>
          <select
            value={effectiveChannelWorkspaceId ?? ''}
            onChange={(event) => setSelectedChannelWorkspaceId(event.target.value)}
            className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] px-3 py-2 text-[var(--color-pib-text)]"
           aria-label="Input">
            {channelChoices.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.title || channel.youtubeHandle || 'YouTube channel'}
                {channel.youtubeHandle ? ` (${channel.youtubeHandle})` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {selectedChannel ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          New renders from this section will register back to {selectedChannel.title || selectedChannel.youtubeHandle || 'this YouTube channel'}.
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New edit title"
          className="min-w-0 flex-1 rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm"
         aria-label="New edit title"/>
        <button type="button" className="btn-pib-primary btn-pib-sm justify-center font-label" disabled={!orgId || !title.trim() || (channelChoices.length > 0 && !effectiveChannelWorkspaceId)} onClick={() => void createProject()}>
          Create edit
        </button>
      </div>
      {loading ? <div className="pib-skeleton h-24" /> : null}
      <div className="grid gap-3">
        {!loading && visibleProjects.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-pib-line)] p-4 text-sm text-[var(--color-pib-text-muted)]">
            {channelChoices.length > 0 ? 'No editable video projects for this channel yet.' : 'No editable video projects yet.'}
          </div>
        ) : null}
        {visibleProjects.map((project) => {
          const href = scopedPortalPath(`/portal/video-editor?projectId=${encodeURIComponent(project.id)}`, { orgId })
          return (
            <article key={project.id} className="rounded-lg border border-[var(--color-pib-line)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-[var(--color-pib-text)]">{project.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                    {project.status} / {project.settings?.width ?? 1920}x{project.settings?.height ?? 1080} / {project.timeline?.tracks?.length ?? 0} tracks
                  </p>
                </div>
                {onOpen ? (
                  <button type="button" className="btn-pib-primary btn-pib-sm font-label" onClick={() => onOpen(project.id)}>Open editor</button>
                ) : (
                  <a className="btn-pib-primary btn-pib-sm font-label" href={href}>Open editor</a>
                )}
              </div>
              {project.lastRender?.url ? <a className="mt-3 inline-block text-sm text-[var(--sc-ink-soft)]" href={project.lastRender.url} target="_blank" rel="noreferrer">Latest render</a> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
