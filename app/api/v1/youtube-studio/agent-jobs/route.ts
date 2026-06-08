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
import { getYouTubeSkillContract, YOUTUBE_PRODUCTION_SKILLS, type YouTubeSkillContract } from '@/lib/youtube-studio/skills'
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

function cleanStringArray(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  return Array.from(new Set(values
    .map(cleanString)
    .filter((entry): entry is string => Boolean(entry))))
}

function isJobStatus(value: string): value is YouTubeAgentJobStatus {
  return JOB_STATUSES.includes(value as YouTubeAgentJobStatus)
}

type ArtifactContext = {
  sourceAssetIds: string[]
  clipCandidateIds: string[]
  productionDraftIds: string[]
  renderJobIds: string[]
  publishingPacketIds: string[]
  analyticsSnapshotIds: string[]
}

type ArtifactValidationScope = {
  orgId: string
  channelWorkspaceId: string
  videoProjectId?: string
}

type ArtifactValidationResult = { ids: string[] } | { error: Response }

function recordString(data: Record<string, unknown>, key: string): string | undefined {
  return cleanString(data[key])
}

async function validateArtifactIds(
  collection: keyof typeof YOUTUBE_COLLECTIONS,
  ids: string[],
  scope: ArtifactValidationScope,
  label: string,
): Promise<ArtifactValidationResult> {
  const validIds: string[] = []

  for (const id of ids) {
    const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS[collection], id)
    if (!loaded || loaded.data.deleted === true) return { error: apiError(`${label} not found`, 404) }
    if (loaded.data.orgId !== scope.orgId) return { error: apiError(`${label} does not belong to organisation`, 400) }
    if (recordString(loaded.data, 'channelWorkspaceId') !== scope.channelWorkspaceId) {
      return { error: apiError(`${label} does not belong to channel workspace`, 400) }
    }

    const artifactVideoProjectId = recordString(loaded.data, 'videoProjectId')
    if (scope.videoProjectId && artifactVideoProjectId && artifactVideoProjectId !== scope.videoProjectId) {
      return { error: apiError(`${label} does not belong to video project`, 400) }
    }

    validIds.push(id)
  }

  return { ids: validIds }
}

async function validateArtifactContext(body: Record<string, unknown>, scope: ArtifactValidationScope): Promise<ArtifactContext | { error: Response }> {
  const sourceAssetIds = cleanStringArray(body.sourceAssetIds)
  const clipCandidateIds = cleanStringArray(body.clipCandidateIds)
  const productionDraftIds = cleanStringArray(body.productionDraftIds).concat(cleanStringArray(body.productionDraftId))
  const renderJobIds = cleanStringArray(body.renderJobIds).concat(cleanStringArray(body.renderJobId))
  const publishingPacketIds = cleanStringArray(body.publishingPacketIds).concat(cleanStringArray(body.publishingPacketId))
  const analyticsSnapshotIds = cleanStringArray(body.analyticsSnapshotIds).concat(cleanStringArray(body.analyticsSnapshotId))

  const validations = [
    ['sourceAssets', Array.from(new Set(sourceAssetIds)), 'Source asset'],
    ['clipCandidates', Array.from(new Set(clipCandidateIds)), 'Clip candidate'],
    ['productionDrafts', Array.from(new Set(productionDraftIds)), 'Production draft'],
    ['renderJobs', Array.from(new Set(renderJobIds)), 'Render job'],
    ['packets', Array.from(new Set(publishingPacketIds)), 'Publishing packet'],
    ['analytics', Array.from(new Set(analyticsSnapshotIds)), 'Analytics snapshot'],
  ] as const
  const results: Partial<ArtifactContext> = {}

  for (const [collection, ids, label] of validations) {
    const validated = await validateArtifactIds(collection, ids, scope, label)
    if ('error' in validated) return { error: validated.error }
    if (collection === 'sourceAssets') results.sourceAssetIds = validated.ids
    if (collection === 'clipCandidates') results.clipCandidateIds = validated.ids
    if (collection === 'productionDrafts') results.productionDraftIds = validated.ids
    if (collection === 'renderJobs') results.renderJobIds = validated.ids
    if (collection === 'packets') results.publishingPacketIds = validated.ids
    if (collection === 'analytics') results.analyticsSnapshotIds = validated.ids
  }

  return {
    sourceAssetIds: results.sourceAssetIds ?? [],
    clipCandidateIds: results.clipCandidateIds ?? [],
    productionDraftIds: results.productionDraftIds ?? [],
    renderJobIds: results.renderJobIds ?? [],
    publishingPacketIds: results.publishingPacketIds ?? [],
    analyticsSnapshotIds: results.analyticsSnapshotIds ?? [],
  }
}

function buildSkillInputPacket(
  contract: YouTubeSkillContract,
  inputSummary: string | undefined,
  channelWorkspaceId: string,
  seriesId: string | undefined,
  videoProjectId: string | undefined,
  artifacts: ArtifactContext,
) {
  return {
    skillKey: contract.key,
    skillLabel: contract.label,
    family: contract.family,
    inputSummary,
    requiredContext: contract.requiredContext,
    outputArtifacts: contract.outputArtifacts,
    guardrails: contract.guardrails,
    policySourceKeys: contract.policySourceKeys,
    references: {
      channelWorkspaceId,
      seriesId,
      videoProjectId,
      sourceAssetIds: artifacts.sourceAssetIds,
      clipCandidateIds: artifacts.clipCandidateIds,
      productionDraftIds: artifacts.productionDraftIds,
      renderJobIds: artifacts.renderJobIds,
      publishingPacketIds: artifacts.publishingPacketIds,
      analyticsSnapshotIds: artifacts.analyticsSnapshotIds,
    },
  }
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

  const artifactContext = await validateArtifactContext(body, { orgId, channelWorkspaceId, videoProjectId })
  if ('error' in artifactContext) return artifactContext.error
  const inputSummary = cleanString(body.inputSummary)
  const linked = cleanObject(body.linked)

  const data = sanitizeYouTubeAgentJobInput({
    ...body,
    orgId,
    channelWorkspaceId,
    seriesId,
    videoProjectId,
    skillKey: contract.key,
    title: cleanString(body.title) ?? contract.label,
    status: 'queued',
    inputSummary,
    inputPacket: buildSkillInputPacket(contract, inputSummary, channelWorkspaceId, seriesId, videoProjectId, artifactContext),
    outputArtifactIds: [],
    reviewRequired: contract.defaultReviewRequired,
    visibility: 'internal',
    linked: {
      ...linked,
      sourceAssetIds: artifactContext.sourceAssetIds,
      clipCandidateIds: artifactContext.clipCandidateIds,
      productionDraftIds: artifactContext.productionDraftIds,
      renderJobIds: artifactContext.renderJobIds,
      publishingPacketIds: artifactContext.publishingPacketIds,
      analyticsSnapshotIds: artifactContext.analyticsSnapshotIds,
    },
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
