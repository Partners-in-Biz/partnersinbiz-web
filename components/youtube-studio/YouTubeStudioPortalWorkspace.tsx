'use client'

import { useEffect, useState } from 'react'
import type { YouTubeChannelWorkspace, YouTubePublishingPacket, YouTubeSeries, YouTubeVideoProject } from '@/lib/youtube-studio/types'
import { YouTubeChannelCard, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'

type RequestForm = {
  channelWorkspaceId: string
  title: string
  objective: string
  sourceUrl: string
}

const emptyRequest: RequestForm = {
  channelWorkspaceId: '',
  title: '',
  objective: '',
  sourceUrl: '',
}

function isClientReviewOpen(video: YouTubeVideoProject) {
  return (
    video.status === 'client_review' ||
    video.status === 'changes_requested' ||
    video.clientReview?.status === 'requested'
  )
}

export function YouTubeStudioPortalWorkspace() {
  const [channels, setChannels] = useState<YouTubeChannelWorkspace[]>([])
  const [series, setSeries] = useState<YouTubeSeries[]>([])
  const [videos, setVideos] = useState<YouTubeVideoProject[]>([])
  const [packets, setPackets] = useState<YouTubePublishingPacket[]>([])
  const [request, setRequest] = useState<RequestForm>(emptyRequest)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [moduleDisabled, setModuleDisabled] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/portal/youtube-studio')
      const body = await res.json().catch(() => ({}))
      if (!res.ok && body.moduleDisabled === true) {
        setModuleDisabled(true)
        setChannels([])
        setSeries([])
        setVideos([])
        setPackets([])
        return
      }

      setModuleDisabled(false)
      setChannels(Array.isArray(body.data?.channels) ? body.data.channels : [])
      setSeries(Array.isArray(body.data?.series) ? body.data.series : [])
      setVideos(Array.isArray(body.data?.videos) ? body.data.videos : [])
      setPackets(Array.isArray(body.data?.packets) ? body.data.packets : [])
      if (!res.ok) setNotice(body.error ?? 'Could not load YouTube Studio.')
    } catch {
      setModuleDisabled(false)
      setChannels([])
      setSeries([])
      setVideos([])
      setPackets([])
      setNotice('Could not load YouTube Studio.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function update<K extends keyof RequestForm>(field: K, value: RequestForm[K]) {
    setRequest((prev) => ({ ...prev, [field]: value }))
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!request.channelWorkspaceId || !request.title.trim()) return
    setNotice('')
    const res = await fetch('/api/v1/portal/youtube-studio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not submit video request')
      return
    }
    setRequest(emptyRequest)
    setNotice('Video request sent to the PiB team.')
    await load()
  }

  async function saveDecision(videoId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    setNotice('')
    const res = await fetch('/api/v1/portal/youtube-studio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: videoId, decision, notes: reviewNotes[videoId] ?? '' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save review')
      return
    }
    setNotice('Review saved for the PiB team.')
    await load()
  }

  if (moduleDisabled) {
    return (
      <YouTubeStudioWorkspaceShell
        channels={[]}
        videos={[]}
        series={[]}
        surface="portal"
        eyebrow="Video production"
        title="YouTube Studio"
        description="YouTube production access is controlled by your PiB workspace settings."
        loading={loading}
        className="p-4 sm:p-6 lg:p-8"
      >
        <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
          YouTube Studio is not enabled for this portal.
        </div>
      </YouTubeStudioWorkspaceShell>
    )
  }

  return (
    <YouTubeStudioWorkspaceShell
      channels={channels}
      videos={videos}
      series={series}
      surface="portal"
      eyebrow="Video production"
      title="YouTube Studio"
      description="Request videos, review drafts, approve changes, and see the YouTube work PiB is producing for your account."
      notice={notice}
      loading={loading}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          {channels.map((channel) => (
            <YouTubeChannelCard key={channel.id ?? channel.title} channel={channel} />
          ))}

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Video reviews</h2>
            {videos.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube videos yet.</div>
            ) : (
              videos.map((video) => (
                <YouTubeVideoCard key={video.id ?? video.title} video={video}>
                  {video.id && isClientReviewOpen(video) ? (
                    <div className="w-full space-y-3">
                      <textarea
                        rows={3}
                        value={reviewNotes[video.id] ?? ''}
                        onChange={(event) => setReviewNotes((prev) => ({ ...prev, [video.id!]: event.target.value }))}
                        placeholder="Notes for PiB"
                        className="w-full rounded-xl border border-[var(--color-pib-line)] bg-transparent p-3 text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => saveDecision(video.id!, 'approved')} className="pib-btn-primary text-sm">
                          Approve
                        </button>
                        <button type="button" onClick={() => saveDecision(video.id!, 'changes_requested')} className="pib-btn-ghost text-sm">
                          Request changes
                        </button>
                        <button type="button" onClick={() => saveDecision(video.id!, 'rejected')} className="pib-btn-ghost text-sm">
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </YouTubeVideoCard>
              ))
            )}
            {packets.length > 0 ? (
              <p className="text-xs text-on-surface-variant">
                {packets.length} publishing packet{packets.length === 1 ? '' : 's'} available for selected reviews.
              </p>
            ) : null}
          </div>
        </section>

        <form onSubmit={submitRequest} className="pib-card-section h-fit space-y-4 p-5 lg:sticky lg:top-6">
          <h2 className="font-headline font-bold text-on-surface">Request a video</h2>
          <label className="block text-sm">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
            <select
              value={request.channelWorkspaceId}
              onChange={(event) => update('channelWorkspaceId', event.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              <option value="">Select a channel</option>
              {channels.map((channel) => (
                <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
              ))}
            </select>
          </label>
          <Field label="Video title" value={request.title} onChange={(value) => update('title', value)} required />
          <TextArea label="Objective" value={request.objective} onChange={(value) => update('objective', value)} />
          <Field label="Source URL" value={request.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
          <button type="submit" disabled={!request.channelWorkspaceId || !request.title.trim()} className="pib-btn-primary w-full">
            Send request
          </button>
        </form>
      </div>
    </YouTubeStudioWorkspaceShell>
  )
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <input
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}

function TextArea({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}
