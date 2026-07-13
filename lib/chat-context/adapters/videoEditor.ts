import { adminDb } from '@/lib/firebase/admin'
import type { ApiRole } from '@/lib/api/types'
import type { ChatContextAdapter } from '@/lib/chat-context/access'
import type { ChatArtifactSummary, ChatContextReadModel, ContextDisplayState } from '@/lib/chat-context/types'
import { resolveContextReferences } from '@/lib/context-references/registry'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import type { VideoEditorProject, VideoEditorRenderJob, VideoEditorTranscript } from '@/lib/video-editor/types'

const RECENT_VIDEO_EDITOR_CHILD_LIMIT = 20

function failureDetail(kind: 'render' | 'transcript'): string {
  return kind === 'render'
    ? 'The render could not be completed. Try again later.'
    : 'Captions could not be processed. Review the source media and try again.'
}

function renderState(status: VideoEditorRenderJob['status']): ContextDisplayState {
  if (status === 'queued' || status === 'dispatched') return 'waiting'
  if (status === 'rendering') return 'running'
  if (status === 'rendered') return 'complete'
  if (status === 'failed') return 'blocked'
  return 'archived'
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

function exactEditorHref(projectId: string, orgId: string): string {
  return `/portal/video-editor?${new URLSearchParams({ projectId, orgId }).toString()}`
}

export function buildVideoEditorProjectModel(input: {
  project: VideoEditorProject & { id: string }
  jobs: Array<VideoEditorRenderJob & { id: string }>
  transcripts: Array<VideoEditorTranscript & { id: string }>
  role: ApiRole
}): ChatContextReadModel {
  const { project } = input
  const readOnly = project.status === 'archived'
  const href = exactEditorHref(project.id, project.orgId)
  const renderHref = `/api/v1/video-editor/projects/${encodeURIComponent(project.id)}/render`
  const jobs = input.jobs.filter((job) => !job.deleted).sort((a, b) => timestamp(b.updatedAt ?? b.createdAt) - timestamp(a.updatedAt ?? a.createdAt)).slice(0, RECENT_VIDEO_EDITOR_CHILD_LIMIT)
  const transcripts = input.transcripts.filter((transcript) => !transcript.deleted).slice(0, RECENT_VIDEO_EDITOR_CHILD_LIMIT)
  const latestJob = jobs[0]
  const clipCount = project.timeline.tracks.reduce((total, track) => total + track.clips.length, 0)
  const duration = project.timeline.tracks.reduce((maximum, track) => Math.max(maximum, ...track.clips.map((clip) => clip.timelineStart + clip.duration), 0), 0)
  const artifacts: ChatArtifactSummary[] = jobs.map((job) => ({
    id: `video_editor:render:${encodeURIComponent(job.id)}`, studioKind: 'video_editor', resourceType: 'render', resourceId: job.id,
    title: `Render: ${project.title}`, artifactKind: 'video', state: renderState(job.status), statusLabel: titleCase(job.status),
    preview: job.output?.url ? { kind: 'video', url: job.output.url } : { kind: 'none' }, updatedAt: dateString(job.updatedAt) ?? dateString(job.createdAt),
    provenance: { provider: job.providerJobId ? 'video_editor_runtime' : undefined }, href,
    actions: [
      { id: job.status === 'rendered' ? 'review-output' : 'open', label: job.status === 'rendered' ? 'Review output' : 'Open project', href },
      ...(!readOnly && job.status === 'failed' ? [{ id: 'retry-render', label: 'Retry render', href: renderHref, method: 'POST' as const }] : []),
    ],
  }))
  const projectActions: ChatArtifactSummary['actions'] = [{ id: 'open', label: 'Open project', href }]
  if (!readOnly) {
    projectActions.push(
      { id: 'render', label: 'Render', href: renderHref, method: 'POST' },
      { id: 'create-draft', label: 'Create draft', href: '/api/v1/video-editor/projects', method: 'POST', body: { orgId: project.orgId, title: `${project.title} draft` } },
    )
    if (project.videoProjectId) projectActions.push({ id: 'youtube-handoff', label: 'Open in YouTube Studio', href: `/portal/youtube-studio/editor/${encodeURIComponent(project.videoProjectId)}` })
    if (project.canvasId) projectActions.push({ id: 'marketing-handoff', label: 'Open in Marketing Studio', href: `/portal/creative-canvas?${new URLSearchParams({ canvasId: project.canvasId, orgId: project.orgId }).toString()}` })
  }
  artifacts.unshift({
    id: `video_editor:project:${encodeURIComponent(project.id)}`, studioKind: 'video_editor', resourceType: 'project', resourceId: project.id,
    title: project.title, artifactKind: 'video', state: project.status === 'rendering' ? 'running' : project.status === 'rendered' ? 'complete' : project.status === 'archived' ? 'archived' : 'ready',
    statusLabel: titleCase(project.status), preview: project.lastRender?.url ? { kind: 'video', url: project.lastRender.url } : { kind: 'none' },
    updatedAt: dateString(project.updatedAt), href, actions: projectActions,
  })
  const attention = [
    ...jobs.filter((job) => job.status === 'failed').map((job) => ({
      id: `render-failure:${job.id}`, label: 'Render failed', state: 'blocked' as const, detail: failureDetail('render'), href,
      actions: readOnly
        ? [{ id: 'open', label: 'Open project', href }]
        : [{ id: 'retry-render', label: 'Retry render', href: renderHref, method: 'POST' as const }],
    })),
    ...transcripts.filter((transcript) => transcript.status === 'failed').map((transcript) => ({
      id: `transcript-failure:${transcript.id}`, label: 'Caption transcript failed', state: 'blocked' as const, detail: failureDetail('transcript'), href,
      actions: [{ id: 'open', label: 'Open captions', href }],
    })),
  ]
  return {
    context: { kind: 'studio_artifact', id: `video_editor:project:${encodeURIComponent(project.id)}`, orgId: project.orgId, label: project.title, icon: 'video_editor', href },
    pulse: {
      label: titleCase(project.status), headline: latestJob ? `Latest render: ${titleCase(latestJob.status)}` : undefined,
      metrics: [{ id: 'tracks', label: 'Tracks', value: project.timeline.tracks.length }, { id: 'clips', label: 'Clips', value: clipCount }, { id: 'duration', label: 'Duration', value: `${Number(duration.toFixed(2))}s` }],
      next: attention[0] ? { id: attention[0].id, label: attention[0].label, state: attention[0].state, detail: attention[0].detail, href, actions: attention[0].actions } : undefined,
    },
    groups: [
      { id: 'timeline', label: 'Timeline', items: project.timeline.tracks.map((track) => ({ id: track.id, label: track.label || titleCase(track.kind), state: 'ready', detail: `${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}`, href })) },
      ...(jobs.length ? [{ id: 'render-jobs', label: 'Render jobs', items: jobs.map((job) => ({ id: job.id, label: `Render ${job.id}`, state: renderState(job.status), detail: titleCase(job.status), updatedAt: dateString(job.updatedAt ?? job.createdAt), href })) }] : []),
    ], artifacts, attention, activity: [], capabilities: readOnly ? ['view', 'review_output'] : ['view', 'create_draft', 'render', 'review_output', 'handoff'], asOf: new Date().toISOString(),
  }
}

function timestamp(value: unknown): number {
  const parsed = dateString(value)
  return parsed ? Date.parse(parsed) : 0
}

function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  if (value && typeof value === 'object') {
    try { return (value as { toDate?: () => Date }).toDate?.().toISOString() } catch { return undefined }
  }
  return undefined
}

export const videoEditorChatContextAdapter: ChatContextAdapter = {
  async resolve({ id, user }) {
    if (!id.startsWith('video_editor:project:')) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    let projectId: string
    try { projectId = decodeURIComponent(id.slice('video_editor:project:'.length)) } catch { return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' } }
    if (!projectId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const projects = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.projects)
    if (typeof projects.doc !== 'function') return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const projectSnap = await projects.doc(projectId).get()
    const data = projectSnap.exists ? projectSnap.data() as VideoEditorProject | undefined : undefined
    if (!data || data.deleted) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const refs = await resolveContextReferences([{ type: 'studio_artifact', id }], user)
    const ref = refs.find((item) => item.type === 'studio_artifact' && item.id.startsWith('video_editor:project:'))
    if (!ref?.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    if (ref.id !== id || data.orgId !== ref.orgId) return { ok: false, reason: 'not_found', status: 404, error: 'Context unavailable' }
    const [jobSnap, transcriptSnap] = await Promise.all([
      adminDb.collection(VIDEO_EDITOR_COLLECTIONS.renderJobs)
        .where('orgId', '==', ref.orgId).where('projectId', '==', projectId)
        .orderBy('updatedAt', 'desc').limit(RECENT_VIDEO_EDITOR_CHILD_LIMIT).get(),
      adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts)
        .where('orgId', '==', ref.orgId).where('projectId', '==', projectId)
        .orderBy('updatedAt', 'desc').limit(RECENT_VIDEO_EDITOR_CHILD_LIMIT).get(),
    ])
    const jobs = jobSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as VideoEditorRenderJob & { id: string })).filter((job) => !job.deleted && job.orgId === ref.orgId)
    const transcripts = transcriptSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as VideoEditorTranscript & { id: string })).filter((transcript) => !transcript.deleted && transcript.orgId === ref.orgId)
    return { ok: true, model: buildVideoEditorProjectModel({ project: { id: projectId, ...data }, jobs, transcripts, role: user.role }) }
  },
}
