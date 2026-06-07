'use client'

import { useCallback, useEffect, useState } from 'react'
import type { YouTubeChannelWorkspace, YouTubeSeries, YouTubeVideoProject, YouTubeVideoType } from '@/lib/youtube-studio/types'
import { YouTubeChannelCard, YouTubeVideoCard } from '@/components/youtube-studio/YouTubeStudioCards'
import { YouTubeStudioWorkspaceShell } from '@/components/youtube-studio/YouTubeStudioWorkspaceShell'

interface YouTubeStudioAdminWorkspaceProps {
  orgId: string
  orgName: string
}

type FormState = {
  channelTitle: string
  youtubeHandle: string
  contentPillars: string
  audienceNotes: string
  videoChannelId: string
  videoTitle: string
  objective: string
  videoType: YouTubeVideoType
  sourceUrl: string
}

const emptyForm: FormState = {
  channelTitle: '',
  youtubeHandle: '',
  contentPillars: '',
  audienceNotes: '',
  videoChannelId: '',
  videoTitle: '',
  objective: '',
  videoType: 'long_form',
  sourceUrl: '',
}

const videoTypes: YouTubeVideoType[] = [
  'short',
  'long_form',
  'clip_pack',
  'podcast_episode',
  'webinar_cutdown',
  'testimonial',
  'case_study',
  'tutorial',
  'product_demo',
  'ad_creative',
  'community_update',
]

function splitLines(value: string) {
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
}

export function YouTubeStudioAdminWorkspace({ orgId, orgName }: YouTubeStudioAdminWorkspaceProps) {
  const [channels, setChannels] = useState<YouTubeChannelWorkspace[]>([])
  const [series, setSeries] = useState<YouTubeSeries[]>([])
  const [videos, setVideos] = useState<YouTubeVideoProject[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [channelRes, seriesRes, videoRes] = await Promise.all([
        fetch(`/api/v1/youtube-studio/channels?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/series?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/videos?orgId=${encodeURIComponent(orgId)}`),
      ])
      const [channelBody, seriesBody, videoBody] = await Promise.all([
        channelRes.json().catch(() => ({})),
        seriesRes.json().catch(() => ({})),
        videoRes.json().catch(() => ({})),
      ])
      setChannels(Array.isArray(channelBody.data?.channels) ? channelBody.data.channels : [])
      setSeries(Array.isArray(seriesBody.data?.series) ? seriesBody.data.series : [])
      setVideos(Array.isArray(videoBody.data?.videos) ? videoBody.data.videos : [])
      if (!channelRes.ok || !seriesRes.ok || !videoRes.ok) {
        setNotice('Could not load the full YouTube Studio workspace.')
      }
    } catch {
      setChannels([])
      setSeries([])
      setVideos([])
      setNotice('Could not load the YouTube Studio workspace.')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    if (orgId) void load()
  }, [orgId, load])

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function saveChannel(event: React.FormEvent) {
    event.preventDefault()
    if (!form.channelTitle.trim()) return
    setSaving(true)
    setNotice('')
    const res = await fetch('/api/v1/youtube-studio/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        title: form.channelTitle,
        youtubeHandle: form.youtubeHandle,
        contentPillars: splitLines(form.contentPillars),
        audienceNotes: form.audienceNotes,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save YouTube channel workspace')
      return
    }
    setForm((prev) => ({
      ...prev,
      channelTitle: '',
      youtubeHandle: '',
      contentPillars: '',
      audienceNotes: '',
      videoChannelId: body.data?.id ?? prev.videoChannelId,
    }))
    setNotice('YouTube channel workspace saved.')
    await load()
  }

  async function saveVideo(event: React.FormEvent) {
    event.preventDefault()
    if (!form.videoChannelId || !form.videoTitle.trim()) return
    setSaving(true)
    setNotice('')
    const res = await fetch('/api/v1/youtube-studio/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        channelWorkspaceId: form.videoChannelId,
        title: form.videoTitle,
        objective: form.objective,
        videoType: form.videoType,
        source: { intakeType: form.sourceUrl ? 'source_url' : 'manual', sourceUrl: form.sourceUrl },
        visibility: { showInClientPortal: true },
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setNotice(body.error ?? 'Could not save video project')
      return
    }
    setForm((prev) => ({ ...prev, videoTitle: '', objective: '', sourceUrl: '' }))
    setNotice('Video project saved.')
    await load()
  }

  return (
    <YouTubeStudioWorkspaceShell
      channels={channels}
      videos={videos}
      series={series}
      surface="admin"
      eyebrow={`${orgName} / Video production`}
      description="Manage channel setup, series, video requests, production state, client review, and publishing packet readiness."
      notice={notice}
      loading={loading}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          {channels.length === 0 ? (
            <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube channel workspaces yet.</div>
          ) : (
            channels.map((channel) => (
              <YouTubeChannelCard key={channel.id ?? channel.title} channel={channel} />
            ))
          )}

          <div className="space-y-3">
            <h2 className="font-headline text-xl font-semibold text-on-surface">Video pipeline</h2>
            {videos.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No YouTube videos yet.</div>
            ) : (
              videos.map((video) => (
                <YouTubeVideoCard key={video.id ?? video.title} video={video} />
              ))
            )}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <form onSubmit={saveChannel} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Add channel</h2>
            <Field label="Channel title" value={form.channelTitle} onChange={(value) => update('channelTitle', value)} required />
            <Field label="YouTube handle" value={form.youtubeHandle} onChange={(value) => update('youtubeHandle', value)} />
            <TextArea
              label="Content pillars"
              value={form.contentPillars}
              onChange={(value) => update('contentPillars', value)}
              placeholder="One per line or comma-separated"
            />
            <TextArea label="Audience notes" value={form.audienceNotes} onChange={(value) => update('audienceNotes', value)} />
            <button type="submit" disabled={saving || !form.channelTitle.trim()} className="pib-btn-primary w-full">
              {saving ? 'Saving...' : 'Save channel'}
            </button>
          </form>

          <form onSubmit={saveVideo} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Start video</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Channel</span>
              <select
                value={form.videoChannelId}
                onChange={(event) => update('videoChannelId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a channel</option>
                {channels.map((channel) => (
                  <option key={channel.id ?? channel.title} value={channel.id ?? ''}>{channel.title}</option>
                ))}
              </select>
            </label>
            <Field label="Video title" value={form.videoTitle} onChange={(value) => update('videoTitle', value)} required />
            <TextArea label="Objective" value={form.objective} onChange={(value) => update('objective', value)} />
            <Select
              label="Video type"
              value={form.videoType}
              onChange={(value) => update('videoType', value as YouTubeVideoType)}
              options={videoTypes}
            />
            <Field label="Source URL" value={form.sourceUrl} onChange={(value) => update('sourceUrl', value)} />
            <button type="submit" disabled={saving || !form.videoChannelId || !form.videoTitle.trim()} className="pib-btn-primary w-full">
              {saving ? 'Saving...' : 'Create video project'}
            </button>
          </form>
        </aside>
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
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />
    </label>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
        ))}
      </select>
    </label>
  )
}
