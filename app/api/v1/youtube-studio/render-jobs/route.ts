import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  stripUndefinedDeep,
  updateActorFields,
  YOUTUBE_COLLECTIONS,
} from '@/lib/youtube-studio/api'
import { sanitizeYouTubeRenderJobInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type {
  YouTubeClipCandidate,
  YouTubeGateCheck,
  YouTubeProductionDraft,
  YouTubeRenderJob,
  YouTubeSourceAsset,
} from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function uniqueIds(...groups: Array<Array<string | undefined>>): string[] {
  return Array.from(new Set(groups.flat().filter((id): id is string => Boolean(id))))
}

type RenderChecks = YouTubeRenderJob['checks']
type RenderCheckKey = keyof RenderChecks

const RENDER_CHECK_KEYS: RenderCheckKey[] = ['sourceRights', 'brand', 'captions', 'renderQuality', 'clientApproval']
const GATE_STATUSES: YouTubeGateCheck['status'][] = ['pass', 'warning', 'block', 'not_applicable']
const ADMIN_RENDER_STATUSES: YouTubeRenderJob['status'][] = [
  'planning',
  'ready_for_edit',
  'rendering',
  'rendered',
  'qa_review',
  'approved',
  'blocked',
  'cancelled',
]

function pickGateStatus(value: unknown, fallback: YouTubeGateCheck['status']): YouTubeGateCheck['status'] {
  return GATE_STATUSES.includes(value as YouTubeGateCheck['status']) ? value as YouTubeGateCheck['status'] : fallback
}

function pickAdminRenderStatus(value: unknown, fallback: YouTubeRenderJob['status']) {
  return ADMIN_RENDER_STATUSES.includes(value as YouTubeRenderJob['status'])
    ? value as YouTubeRenderJob['status']
    : fallback
}

function defaultGateCheck(message: string): YouTubeGateCheck {
  return {
    status: 'warning',
    message,
  }
}

function defaultChecks(): RenderChecks {
  return {
    sourceRights: defaultGateCheck('Source rights review required before this render can be client-ready.'),
    brand: defaultGateCheck('Brand review required before this render can be client-ready.'),
    captions: defaultGateCheck('Caption review required before this render can be client-ready.'),
    renderQuality: defaultGateCheck('Render quality review required before this render can be client-ready.'),
    clientApproval: defaultGateCheck('Client approval required before publishing or release planning.'),
  }
}

function cleanGateCheck(value: unknown, fallback: YouTubeGateCheck): YouTubeGateCheck {
  const source = cleanObject(value)

  return {
    status: pickGateStatus(source.status, fallback.status),
    message: cleanString(source.message) ?? fallback.message,
  }
}

function cleanGateChecks(value: unknown, existing?: unknown): RenderChecks {
  const source = cleanObject(value)
  const existingSource = cleanObject(existing)
  const defaults = defaultChecks()

  return Object.fromEntries(RENDER_CHECK_KEYS.map((key) => {
    const fallback = cleanGateCheck(existingSource[key], defaults[key])
    return [key, cleanGateCheck(source[key], fallback)]
  })) as RenderChecks
}

function hasBlockingChecks(checks: RenderChecks) {
  return RENDER_CHECK_KEYS.some((key) => checks[key]?.status === 'block')
}

function reviewCheck(user: Parameters<typeof updateActorFields>[0], message: string, status: YouTubeGateCheck['status']): YouTubeGateCheck {
  return {
    status,
    message,
    checkedBy: user.uid,
    checkedByType: user.role === 'ai' ? 'agent' : 'user',
    checkedAt: FieldValue.serverTimestamp(),
  }
}

function cleanRenderOutput(value: unknown): YouTubeRenderJob['output'] {
  const source = cleanObject(value)
  if (!Object.keys(source).length) return undefined

  return stripUndefinedDeep({
    previewUrl: cleanString(source.previewUrl),
    downloadUrl: cleanString(source.downloadUrl),
    storagePath: cleanString(source.storagePath),
    youtubeVideoId: cleanString(source.youtubeVideoId),
    durationSeconds: cleanNonNegativeNumber(source.durationSeconds),
    renderPreset: cleanString(source.renderPreset),
  })
}

function cleanVisibility(value: unknown, existing: unknown, status: YouTubeRenderJob['status']) {
  const source = cleanObject(value)
  const previous = cleanObject(existing)

  return {
    showInClientPortal: status === 'qa_review'
      ? true
      : typeof source.showInClientPortal === 'boolean'
        ? source.showInClientPortal
        : previous.showInClientPortal === true,
    showTimelineInPortal: typeof source.showTimelineInPortal === 'boolean'
      ? source.showTimelineInPortal
      : previous.showTimelineInPortal === true,
    showOutputsInPortal: status === 'qa_review'
      ? true
      : typeof source.showOutputsInPortal === 'boolean'
        ? source.showOutputsInPortal
        : previous.showOutputsInPortal === true,
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function approvalSnapshotHash(job: Partial<YouTubeRenderJob>) {
  const snapshot = {
    channelWorkspaceId: job.channelWorkspaceId,
    videoProjectId: job.videoProjectId,
    productionDraftId: job.productionDraftId,
    versionNumber: job.versionNumber,
    title: job.title,
    renderType: job.renderType,
    targetFormat: job.targetFormat,
    status: job.status,
    editBrief: job.editBrief,
    timeline: job.timeline,
    output: {
      previewUrl: job.output?.previewUrl,
      downloadUrl: job.output?.downloadUrl,
      durationSeconds: job.output?.durationSeconds,
    },
    checks: Object.fromEntries(RENDER_CHECK_KEYS.map((key) => [
      key,
      {
        status: job.checks?.[key]?.status,
        message: job.checks?.[key]?.message,
      },
    ])),
  }

  return createHash('sha256').update(stableStringify(stripUndefinedDeep(snapshot))).digest('hex')
}

function valueFromPatch(body: Record<string, unknown>, existing: Record<string, unknown>, key: string): unknown {
  return hasOwn(body, key) ? body[key] : existing[key]
}

async function validateSourceAssets(
  sourceAssetIds: string[],
  orgId: string,
  channelWorkspaceId: string,
  videoProjectId: string,
) {
  for (const sourceAssetId of sourceAssetIds) {
    const sourceRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.sourceAssets, sourceAssetId)
    if (!sourceRecord || sourceRecord.data.deleted === true) return apiError('sourceAssetIds includes an unknown source asset', 404)
    const sourceAsset = serializeYouTubeRecord<YouTubeSourceAsset>(sourceRecord.id, sourceRecord.data)
    if (sourceAsset.orgId !== orgId) return apiError('sourceAssetIds includes an asset from another organisation', 400)
    if (sourceAsset.channelWorkspaceId !== channelWorkspaceId) {
      return apiError('sourceAssetIds includes an asset from another channel workspace', 400)
    }
    if (sourceAsset.videoProjectId && sourceAsset.videoProjectId !== videoProjectId) {
      return apiError('sourceAssetIds includes an asset from another video project', 400)
    }
  }

  return null
}

async function validateClipCandidates(
  clipCandidateIds: string[],
  orgId: string,
  channelWorkspaceId: string,
  videoProjectId: string,
) {
  for (const clipCandidateId of clipCandidateIds) {
    const clipRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.clipCandidates, clipCandidateId)
    if (!clipRecord || clipRecord.data.deleted === true) return apiError('clipCandidateIds includes an unknown clip candidate', 404)
    const clip = serializeYouTubeRecord<YouTubeClipCandidate>(clipRecord.id, clipRecord.data)
    if (clip.orgId !== orgId) return apiError('clipCandidateIds includes a clip from another organisation', 400)
    if (clip.channelWorkspaceId !== channelWorkspaceId) {
      return apiError('clipCandidateIds includes a clip from another channel workspace', 400)
    }
    if (clip.videoProjectId && clip.videoProjectId !== videoProjectId) {
      return apiError('clipCandidateIds includes a clip from another video project', 400)
    }
  }

  return null
}

async function validateProductionDraft(
  productionDraftId: string | undefined,
  orgId: string,
  channelWorkspaceId: string,
  videoProjectId: string,
) {
  if (!productionDraftId) return null

  const draftRecord = await loadScopedRecord(YOUTUBE_COLLECTIONS.productionDrafts, productionDraftId)
  if (!draftRecord || draftRecord.data.deleted === true) return apiError('Production draft not found', 404)
  const draft = serializeYouTubeRecord<YouTubeProductionDraft>(draftRecord.id, draftRecord.data)
  if (draft.orgId !== orgId) return apiError('productionDraftId does not belong to organisation', 400)
  if (draft.channelWorkspaceId !== channelWorkspaceId) {
    return apiError('productionDraftId does not belong to channel workspace', 400)
  }
  if (draft.videoProjectId !== videoProjectId) return apiError('productionDraftId does not belong to video project', 400)
  if (draft.status !== 'approved') return apiError('Production draft must be approved before creating a render job', 409)

  return null
}

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.renderJobs, orgId)
  const renderJobs = docs
    .map((doc) => serializeYouTubeRecord<YouTubeRenderJob>(doc.id, doc.data()))
    .filter((job) => !channelWorkspaceId || job.channelWorkspaceId === channelWorkspaceId)
    .filter((job) => !videoProjectId || job.videoProjectId === videoProjectId)
    .filter((job) => !status || job.status === status)
    .sort((a, b) => a.title.localeCompare(b.title) || b.versionNumber - a.versionNumber)

  return apiSuccess({ renderJobs })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeRenderJobInput({ ...body, orgId })
  if (!data.channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!data.videoProjectId) return apiError('videoProjectId is required', 400)
  if (!data.title) return apiError('title is required', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, data.channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, data.videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.data.channelWorkspaceId !== data.channelWorkspaceId) {
    return apiError('videoProjectId does not belong to channel workspace', 400)
  }

  const draftError = await validateProductionDraft(
    data.productionDraftId,
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (draftError) return draftError

  const timelineSourceAssetIds = data.timeline.map((scene) => scene.sourceAssetId)
  const sourceError = await validateSourceAssets(
    uniqueIds(data.sourceAssetIds, timelineSourceAssetIds),
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (sourceError) return sourceError

  const timelineClipCandidateIds = data.timeline.map((scene) => scene.clipCandidateId)
  const clipError = await validateClipCandidates(
    uniqueIds(data.clipCandidateIds, timelineClipCandidateIds),
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (clipError) return clipError

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.renderJobs).add({
    ...data,
    status: 'planning',
    versionNumber: data.versionNumber || 1,
    deleted: false,
    ...actorFields(user),
  })

  return apiSuccess({ id: ref.id }, 201)
})

export const PUT = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const id = cleanString(body.id) ?? ''
  if (!id) return apiError('id is required', 400)

  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.renderJobs, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Render job not found', 404)

  const orgId = cleanString(loaded.data.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const channelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''
  const videoProjectId = cleanString(loaded.data.videoProjectId) ?? ''
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!videoProjectId) return apiError('videoProjectId is required', 400)
  if (hasOwn(body, 'channelWorkspaceId') && cleanString(body.channelWorkspaceId) !== channelWorkspaceId) {
    return apiError('channelWorkspaceId cannot be changed for an existing render job', 400)
  }
  if (hasOwn(body, 'videoProjectId') && cleanString(body.videoProjectId) !== videoProjectId) {
    return apiError('videoProjectId cannot be changed for an existing render job', 400)
  }

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.data.channelWorkspaceId !== channelWorkspaceId) {
    return apiError('videoProjectId does not belong to channel workspace', 400)
  }

  const existingStatus = pickAdminRenderStatus(loaded.data.status, 'planning')
  const status = hasOwn(body, 'status') ? pickAdminRenderStatus(body.status, existingStatus) : existingStatus
  let checks = cleanGateChecks(body.checks, loaded.data.checks)
  if (status === 'qa_review') {
    checks = {
      ...checks,
      clientApproval: reviewCheck(user, 'Render job sent to portal review.', 'warning'),
    }
  }
  if (status === 'approved') {
    checks = {
      ...checks,
      clientApproval: reviewCheck(user, 'Render job approved by admin.', 'pass'),
    }
    if (hasBlockingChecks(checks)) {
      return apiError('Render job has blocking checks and cannot be approved', 409)
    }
  }
  if (status === 'blocked') {
    checks = {
      ...checks,
      clientApproval: reviewCheck(user, 'Render job blocked by admin.', 'block'),
    }
  }

  const write = stripUndefinedDeep({
    status,
    output: cleanRenderOutput(valueFromPatch(body, loaded.data, 'output')),
    checks,
    visibility: cleanVisibility(body.visibility, loaded.data.visibility, status),
    clientNotes: hasOwn(body, 'clientNotes') ? cleanString(body.clientNotes) : undefined,
    internalNotes: hasOwn(body, 'internalNotes') ? cleanString(body.internalNotes) : undefined,
    executionJobId: hasOwn(body, 'executionJobId') ? cleanString(body.executionJobId) : undefined,
    approvedBy: status === 'approved' ? user.uid : undefined,
    approvedAt: status === 'approved' ? FieldValue.serverTimestamp() : undefined,
    ...updateActorFields(user),
  })
  await loaded.ref.set(stripUndefinedDeep({
    ...write,
    approvedSnapshotHash: status === 'approved'
      ? approvalSnapshotHash({ ...loaded.data, ...write } as Partial<YouTubeRenderJob>)
      : undefined,
  }), { merge: true })

  return apiSuccess({ id, updated: true })
})
