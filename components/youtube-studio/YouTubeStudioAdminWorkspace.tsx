'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  YouTubeAgentJob,
  YouTubeChannelWorkspace,
  YouTubeProductionSkillKey,
  YouTubeSeries,
  YouTubeVideoProject,
  YouTubeVideoType,
} from '@/lib/youtube-studio/types'
import { YOUTUBE_PRODUCTION_SKILLS } from '@/lib/youtube-studio/skills'
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
  jobVideoId: string
  jobSkillKey: YouTubeProductionSkillKey
  jobInputSummary: string
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
  jobVideoId: '',
  jobSkillKey: 'youtube-video-brief',
  jobInputSummary: '',
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
  const [jobs, setJobs] = useState<YouTubeAgentJob[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [queueingJob, setQueueingJob] = useState(false)
  const [loadNotice, setLoadNotice] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const loadRequestIdRef = useRef(0)
  const activeOrgIdRef = useRef(orgId)
  const previousOrgIdRef = useRef(orgId)
  activeOrgIdRef.current = orgId
  const notice = loadNotice || actionNotice

  const load = useCallback(async () => {
    if (orgId !== activeOrgIdRef.current) return
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const isCurrentRequest = () => requestId === loadRequestIdRef.current && orgId === activeOrgIdRef.current
    setLoading(true)
    try {
      const [channelRes, seriesRes, videoRes, jobRes] = await Promise.all([
        fetch(`/api/v1/youtube-studio/channels?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/series?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/videos?orgId=${encodeURIComponent(orgId)}`),
        fetch(`/api/v1/youtube-studio/agent-jobs?orgId=${encodeURIComponent(orgId)}`),
      ])
      const [channelBody, seriesBody, videoBody, jobBody] = await Promise.all([
        channelRes.json().catch(() => ({})),
        seriesRes.json().catch(() => ({})),
        videoRes.json().catch(() => ({})),
        jobRes.json().catch(() => ({})),
      ])
      if (!isCurrentRequest()) return
      setChannels(Array.isArray(channelBody.data?.channels) ? channelBody.data.channels : [])
      setSeries(Array.isArray(seriesBody.data?.series) ? seriesBody.data.series : [])
      setVideos(Array.isArray(videoBody.data?.videos) ? videoBody.data.videos : [])
      setJobs(Array.isArray(jobBody.data?.jobs) ? jobBody.data.jobs : [])
      if (!channelRes.ok || !seriesRes.ok || !videoRes.ok || !jobRes.ok) {
        setLoadNotice('Could not load the full YouTube Studio workspace.')
      } else {
        setLoadNotice('')
      }
    } catch {
      if (!isCurrentRequest()) return
      setChannels([])
      setSeries([])
      setVideos([])
      setJobs([])
      setLoadNotice('Could not load the YouTube Studio workspace.')
    } finally {
      if (isCurrentRequest()) {
        setLoading(false)
      }
    }
  }, [orgId])

  useEffect(() => {
    if (previousOrgIdRef.current === orgId) return
    previousOrgIdRef.current = orgId
    setForm(emptyForm)
    setSaving(false)
    setQueueingJob(false)
    setLoadNotice('')
    setActionNotice('')
  }, [orgId])

  useEffect(() => {
    if (orgId) void load()
    return () => {
      loadRequestIdRef.current += 1
    }
  }, [orgId, load])

  function update<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function saveChannel(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !form.channelTitle.trim()) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setSaving(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          title: form.channelTitle,
          youtubeHandle: form.youtubeHandle,
          contentPillars: splitLines(form.contentPillars),
          audienceNotes: form.audienceNotes,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save YouTube channel workspace')
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
      setActionNotice('YouTube channel workspace saved.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save YouTube channel workspace')
      }
    } finally {
      if (isCurrentMutation()) {
        setSaving(false)
      }
    }
  }

  async function saveVideo(event: React.FormEvent) {
    event.preventDefault()
    if (saving || !form.videoChannelId || !form.videoTitle.trim()) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setSaving(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          channelWorkspaceId: form.videoChannelId,
          title: form.videoTitle,
          objective: form.objective,
          videoType: form.videoType,
          source: { intakeType: form.sourceUrl ? 'source_url' : 'manual', sourceUrl: form.sourceUrl },
          visibility: { showInClientPortal: true },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not save video project')
        return
      }
      setForm((prev) => ({
        ...prev,
        videoTitle: '',
        objective: '',
        sourceUrl: '',
        jobVideoId: body.data?.id ?? prev.jobVideoId,
      }))
      setActionNotice('Video project saved.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not save video project')
      }
    } finally {
      if (isCurrentMutation()) {
        setSaving(false)
      }
    }
  }

  async function queueAgentJob(event: React.FormEvent) {
    event.preventDefault()
    if (queueingJob || !form.jobVideoId) return
    const mutationOrgId = orgId
    const isCurrentMutation = () => mutationOrgId === activeOrgIdRef.current
    setQueueingJob(true)
    setActionNotice('')
    setLoadNotice('')
    try {
      const res = await fetch('/api/v1/youtube-studio/agent-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: mutationOrgId,
          videoProjectId: form.jobVideoId,
          skillKey: form.jobSkillKey,
          inputSummary: form.jobInputSummary,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!isCurrentMutation()) return
      if (!res.ok) {
        setActionNotice(body.error ?? 'Could not queue Hermes job')
        return
      }
      setForm((prev) => ({ ...prev, jobInputSummary: '' }))
      setActionNotice('Hermes job packet queued.')
      await load()
    } catch {
      if (isCurrentMutation()) {
        setActionNotice('Could not queue Hermes job')
      }
    } finally {
      if (isCurrentMutation()) {
        setQueueingJob(false)
      }
    }
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

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-headline text-xl font-semibold text-on-surface">Hermes production jobs</h2>
              <span className="rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                {jobs.length} job packet{jobs.length === 1 ? '' : 's'}
              </span>
            </div>
            {jobs.length === 0 ? (
              <div className="pib-card-section p-5 text-sm text-on-surface-variant">No Hermes production jobs queued yet.</div>
            ) : (
              <div className="grid gap-3">
                {jobs.map((job) => (
                  <article key={job.id ?? `${job.skillKey}-${job.title}`} className="pib-card-section space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-on-surface">{job.title}</h3>
                        <p className="mt-1 text-sm text-on-surface-variant">{skillLabel(job.skillKey)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-3 py-1 text-xs font-label uppercase tracking-widest text-on-surface-variant">
                        {formatToken(job.status)}
                      </span>
                    </div>
                    {job.inputSummary ? (
                      <p className="break-words text-sm text-on-surface-variant">{job.inputSummary}</p>
                    ) : null}
                    {job.blockedReason ? (
                      <p className="break-words text-sm font-medium text-error">{job.blockedReason}</p>
                    ) : null}
                  </article>
                ))}
              </div>
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

          <form onSubmit={queueAgentJob} className="pib-card-section space-y-4 p-5">
            <h2 className="font-headline font-bold text-on-surface">Queue Hermes job</h2>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Video</span>
              <select
                value={form.jobVideoId}
                onChange={(event) => update('jobVideoId', event.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <option value="">Select a video</option>
                {videos.map((video) => (
                  <option key={video.id ?? video.title} value={video.id ?? ''}>{video.title}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Skill</span>
              <select
                value={form.jobSkillKey}
                onChange={(event) => update('jobSkillKey', event.target.value as YouTubeProductionSkillKey)}
                className="mt-1 w-full rounded-lg border border-[var(--color-outline-variant)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                {YOUTUBE_PRODUCTION_SKILLS.map((skill) => (
                  <option key={skill.key} value={skill.key}>{skill.label}</option>
                ))}
              </select>
            </label>
            <TextArea
              label="Input summary"
              value={form.jobInputSummary}
              onChange={(value) => update('jobInputSummary', value)}
            />
            <button type="submit" disabled={queueingJob || !form.jobVideoId} className="pib-btn-primary w-full">
              {queueingJob ? 'Queueing...' : 'Queue job packet'}
            </button>
          </form>
        </aside>
      </div>
    </YouTubeStudioWorkspaceShell>
  )
}

function skillLabel(key: YouTubeProductionSkillKey) {
  return YOUTUBE_PRODUCTION_SKILLS.find((skill) => skill.key === key)?.label ?? formatToken(key)
}

function formatToken(value: string) {
  return value.replace(/[-_]/g, ' ')
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
