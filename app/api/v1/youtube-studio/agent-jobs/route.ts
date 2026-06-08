import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { getYouTubeSkillContract, YOUTUBE_PRODUCTION_SKILLS } from '@/lib/youtube-studio/skills'
import { sanitizeYouTubeAgentJobInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeAgentJob, YouTubeAgentJobStatus } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

const JOB_STATUSES: YouTubeAgentJobStatus[] = [
  'queued',
  'running',
  'waiting_for_review',
  'completed',
  'failed',
  'cancelled',
]

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isJobStatus(value: string): value is YouTubeAgentJobStatus {
  return JOB_STATUSES.includes(value as YouTubeAgentJobStatus)
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const seriesId = url.searchParams.get('seriesId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.agentJobs, orgId)
  const jobs = docs
    .map((doc) => serializeYouTubeRecord<YouTubeAgentJob>(doc.id, doc.data()))
    .filter((job) => !channelWorkspaceId || job.channelWorkspaceId === channelWorkspaceId)
    .filter((job) => !seriesId || job.seriesId === seriesId)
    .filter((job) => !videoProjectId || job.videoProjectId === videoProjectId)
    .filter((job) => !status || (isJobStatus(status) && job.status === status))
    .sort((a, b) => a.title.localeCompare(b.title))

  return apiSuccess({ jobs, skills: YOUTUBE_PRODUCTION_SKILLS })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const contract = getYouTubeSkillContract(cleanString(body.skillKey) ?? '')
  if (!contract) return apiError('Unknown YouTube production skill', 400)

  const videoProjectId = cleanString(body.videoProjectId)
  let channelWorkspaceId = cleanString(body.channelWorkspaceId)
  const seriesId = cleanString(body.seriesId)

  if (!channelWorkspaceId && !videoProjectId) {
    return apiError('channelWorkspaceId or videoProjectId is required', 400)
  }

  if (videoProjectId) {
    const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
    if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
    if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)

    const videoChannelWorkspaceId = cleanString(video.data.channelWorkspaceId)
    if (!videoChannelWorkspaceId) return apiError('Video project is missing a channel workspace', 400)
    if (channelWorkspaceId && channelWorkspaceId !== videoChannelWorkspaceId) {
      return apiError('channelWorkspaceId does not match video project', 400)
    }
    channelWorkspaceId = videoChannelWorkspaceId
  }

  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  if (seriesId) {
    const series = await loadScopedRecord(YOUTUBE_COLLECTIONS.series, seriesId)
    if (!series || series.data.deleted === true) return apiError('YouTube series not found', 404)
    if (series.data.orgId !== orgId) return apiError('seriesId does not belong to organisation', 400)
    if (series.data.channelWorkspaceId !== channelWorkspaceId) {
      return apiError('seriesId does not belong to channel workspace', 400)
    }
  }

  const data = sanitizeYouTubeAgentJobInput({
    ...body,
    orgId,
    channelWorkspaceId,
    seriesId,
    videoProjectId,
    skillKey: contract.key,
    title: cleanString(body.title) ?? contract.label,
    status: 'queued',
    outputArtifactIds: [],
    reviewRequired: contract.defaultReviewRequired,
    visibility: 'internal',
    deleted: false,
  })

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.agentJobs).add({
    ...data,
    status: 'queued',
    outputArtifactIds: [],
    reviewRequired: contract.defaultReviewRequired,
    visibility: 'internal',
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})
