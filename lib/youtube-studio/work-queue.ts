// lib/youtube-studio/work-queue.ts
//
// Pure classification of YouTube Studio records into the four client cockpit
// groups. Client-centric semantics:
//   needs_input     — a client decision is required (or a client block stands)
//   in_production   — PiB is actively working; nothing for the client to do
//   ready_to_review — approved deliverables to look at, no blocking decision
//   scheduled_live  — scheduled or published videos
// Internal-only states (draft packets, rendering jobs, archived videos) are
// intentionally excluded — they surface in the details tabs instead.

import type {
  YouTubeProductionDraft,
  YouTubePublishingPacket,
  YouTubeRenderJob,
  YouTubeVideoProject,
} from '@/lib/youtube-studio/types'

export type WorkQueueGroupKey = 'needs_input' | 'in_production' | 'ready_to_review' | 'scheduled_live'

export interface WorkQueueGroupMeta {
  key: WorkQueueGroupKey
  label: string
  emptyHint: string
}

export const WORK_QUEUE_GROUPS: WorkQueueGroupMeta[] = [
  { key: 'needs_input', label: 'Needs your input', emptyHint: 'Nothing is waiting on you right now.' },
  { key: 'in_production', label: 'In production', emptyHint: 'PiB is not producing a video right now.' },
  { key: 'ready_to_review', label: 'Ready to review', emptyHint: 'Approved drafts, renders, and packets ready for a final look appear here.' },
  { key: 'scheduled_live', label: 'Scheduled & live', emptyHint: 'Scheduled and published videos land here.' },
]

export type WorkQueueItemKind = 'video' | 'packet' | 'production_draft' | 'render_job'

export interface WorkQueueItem {
  key: string
  kind: WorkQueueItemKind
  group: WorkQueueGroupKey
  id: string
  title: string
  channelWorkspaceId?: string
  video?: YouTubeVideoProject
  packet?: YouTubePublishingPacket
  draft?: YouTubeProductionDraft
  renderJob?: YouTubeRenderJob
}

export type WorkQueueGroups = Record<WorkQueueGroupKey, WorkQueueItem[]>

export interface WorkQueueInput {
  videos: YouTubeVideoProject[]
  packets: YouTubePublishingPacket[]
  productionDrafts: YouTubeProductionDraft[]
  renderJobs: YouTubeRenderJob[]
}

function videoGroup(video: YouTubeVideoProject): WorkQueueGroupKey | null {
  if (video.status === 'client_review' || video.status === 'blocked' || video.clientReview?.status === 'requested') {
    return 'needs_input'
  }
  switch (video.status) {
    case 'intake':
    case 'briefing':
    case 'production':
    case 'internal_review':
    case 'changes_requested':
      return 'in_production'
    case 'publish_ready':
      return 'ready_to_review'
    case 'scheduled':
    case 'live':
      return 'scheduled_live'
    default:
      return null
  }
}

function packetGroup(packet: YouTubePublishingPacket): WorkQueueGroupKey | null {
  if (packet.status === 'client_review') return 'needs_input'
  if (packet.status === 'approved') return 'ready_to_review'
  return null
}

function draftGroup(draft: YouTubeProductionDraft): WorkQueueGroupKey | null {
  return draft.status === 'client_review' ? 'needs_input' : null
}

function renderJobGroup(job: YouTubeRenderJob): WorkQueueGroupKey | null {
  if (job.status === 'qa_review') return 'needs_input'
  if (job.status === 'approved' && (job.output?.previewUrl || job.output?.downloadUrl)) return 'ready_to_review'
  return null
}

function packetTitle(packet: YouTubePublishingPacket): string {
  return packet.titleOptions?.find((option) => option.selected)?.text
    ?? packet.titleOptions?.[0]?.text
    ?? 'Publishing packet'
}

export function buildWorkQueue(input: WorkQueueInput): WorkQueueGroups {
  const groups: WorkQueueGroups = {
    needs_input: [],
    in_production: [],
    ready_to_review: [],
    scheduled_live: [],
  }

  for (const video of input.videos) {
    if (!video.id) continue
    const group = videoGroup(video)
    if (!group) continue
    groups[group].push({
      key: `video:${video.id}`,
      kind: 'video',
      group,
      id: video.id,
      title: video.title,
      channelWorkspaceId: video.channelWorkspaceId,
      video,
    })
  }
  for (const packet of input.packets) {
    if (!packet.id) continue
    const group = packetGroup(packet)
    if (!group) continue
    groups[group].push({
      key: `packet:${packet.id}`,
      kind: 'packet',
      group,
      id: packet.id,
      title: packetTitle(packet),
      channelWorkspaceId: packet.channelWorkspaceId,
      packet,
    })
  }
  for (const draft of input.productionDrafts) {
    if (!draft.id) continue
    const group = draftGroup(draft)
    if (!group) continue
    groups[group].push({
      key: `production_draft:${draft.id}`,
      kind: 'production_draft',
      group,
      id: draft.id,
      title: draft.title,
      channelWorkspaceId: draft.channelWorkspaceId,
      draft,
    })
  }
  for (const job of input.renderJobs) {
    if (!job.id) continue
    const group = renderJobGroup(job)
    if (!group) continue
    groups[group].push({
      key: `render_job:${job.id}`,
      kind: 'render_job',
      group,
      id: job.id,
      title: job.title,
      channelWorkspaceId: job.channelWorkspaceId,
      renderJob: job,
    })
  }

  const kindOrder: Record<WorkQueueItemKind, number> = { video: 0, packet: 1, production_draft: 2, render_job: 3 }
  for (const key of Object.keys(groups) as WorkQueueGroupKey[]) {
    groups[key].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.title.localeCompare(b.title))
  }
  return groups
}

export function workQueuePendingCount(groups: WorkQueueGroups): number {
  return groups.needs_input.length
}

export function filterWorkQueueByChannel(groups: WorkQueueGroups, channelWorkspaceId: string | null): WorkQueueGroups {
  if (!channelWorkspaceId) return groups
  const filtered = {} as WorkQueueGroups
  for (const key of Object.keys(groups) as WorkQueueGroupKey[]) {
    filtered[key] = groups[key].filter((item) => !item.channelWorkspaceId || item.channelWorkspaceId === channelWorkspaceId)
  }
  return filtered
}
