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
import { sanitizeYouTubeProductionDraftInput, serializeYouTubeRecord } from '@/lib/youtube-studio/sanitize'
import type { YouTubeClipCandidate, YouTubeGateCheck, YouTubeProductionDraft, YouTubeSourceAsset } from '@/lib/youtube-studio/types'

export const dynamic = 'force-dynamic'

type DraftChecks = YouTubeProductionDraft['checks']
type DraftCheckKey = keyof DraftChecks

const DRAFT_CHECK_KEYS: DraftCheckKey[] = ['claims', 'brand', 'sourceEvidence', 'clientApproval']
const GATE_STATUSES: YouTubeGateCheck['status'][] = ['pass', 'warning', 'block', 'not_applicable']
const ADMIN_DRAFT_STATUSES: Array<Exclude<YouTubeProductionDraft['status'], 'archived'>> = [
  'draft',
  'internal_review',
  'client_review',
  'approved',
  'changes_requested',
  'blocked',
]

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function uniqueIds(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)))
}

function pickGateStatus(value: unknown, fallback: YouTubeGateCheck['status']): YouTubeGateCheck['status'] {
  return GATE_STATUSES.includes(value as YouTubeGateCheck['status']) ? value as YouTubeGateCheck['status'] : fallback
}

function pickAdminDraftStatus(value: unknown, fallback: Exclude<YouTubeProductionDraft['status'], 'archived'>) {
  return ADMIN_DRAFT_STATUSES.includes(value as Exclude<YouTubeProductionDraft['status'], 'archived'>)
    ? value as Exclude<YouTubeProductionDraft['status'], 'archived'>
    : fallback
}

function defaultGateCheck(message: string): YouTubeGateCheck {
  return {
    status: 'warning',
    message,
  }
}

function defaultChecks(): DraftChecks {
  return {
    claims: defaultGateCheck('Claims review required before this draft is client-ready.'),
    brand: defaultGateCheck('Brand review required before this draft is client-ready.'),
    sourceEvidence: defaultGateCheck('Source evidence review required before this draft is client-ready.'),
    clientApproval: defaultGateCheck('Client approval required before production can proceed.'),
  }
}

function cleanGateCheck(value: unknown, fallback: YouTubeGateCheck): YouTubeGateCheck {
  const source = cleanObject(value)

  return {
    status: pickGateStatus(source.status, fallback.status),
    message: cleanString(source.message) ?? fallback.message,
  }
}

function cleanGateChecks(value: unknown, existing?: unknown): DraftChecks {
  const source = cleanObject(value)
  const existingSource = cleanObject(existing)
  const defaults = defaultChecks()

  return Object.fromEntries(DRAFT_CHECK_KEYS.map((key) => {
    const fallback = cleanGateCheck(existingSource[key], defaults[key])
    return [key, cleanGateCheck(source[key], fallback)]
  })) as DraftChecks
}

function hasBlockingChecks(checks: DraftChecks) {
  return DRAFT_CHECK_KEYS.some((key) => checks[key]?.status === 'block')
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

function cleanVisibility(value: unknown, existing: unknown, status: YouTubeProductionDraft['status']) {
  const source = cleanObject(value)
  const previous = cleanObject(existing)

  return {
    showInClientPortal: status === 'client_review'
      ? true
      : typeof source.showInClientPortal === 'boolean'
        ? source.showInClientPortal
        : previous.showInClientPortal === true,
    showScriptInPortal: typeof source.showScriptInPortal === 'boolean'
      ? source.showScriptInPortal
      : previous.showScriptInPortal === true,
    showScenesInPortal: typeof source.showScenesInPortal === 'boolean'
      ? source.showScenesInPortal
      : previous.showScenesInPortal === true,
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

function approvalSnapshotHash(draft: Partial<YouTubeProductionDraft>) {
  const snapshot = {
    channelWorkspaceId: draft.channelWorkspaceId,
    videoProjectId: draft.videoProjectId,
    versionNumber: draft.versionNumber,
    title: draft.title,
    draftType: draft.draftType,
    status: draft.status,
    summary: draft.summary,
    hook: draft.hook,
    outline: draft.outline,
    scriptText: draft.scriptText,
    scenes: draft.scenes,
    checks: Object.fromEntries(DRAFT_CHECK_KEYS.map((key) => [
      key,
      {
        status: draft.checks?.[key]?.status,
        message: draft.checks?.[key]?.message,
      },
    ])),
  }

  return createHash('sha256').update(stableStringify(stripUndefinedDeep(snapshot))).digest('hex')
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

export const GET = withAuth('admin', async (req, user) => {
  const url = new URL(req.url)
  const orgId = url.searchParams.get('orgId')?.trim() ?? ''
  const channelWorkspaceId = url.searchParams.get('channelWorkspaceId')?.trim() ?? ''
  const videoProjectId = url.searchParams.get('videoProjectId')?.trim() ?? ''
  const status = url.searchParams.get('status')?.trim() ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const docs = await listByOrg(YOUTUBE_COLLECTIONS.productionDrafts, orgId)
  const productionDrafts = docs
    .map((doc) => serializeYouTubeRecord<YouTubeProductionDraft>(doc.id, doc.data()))
    .filter((draft) => !channelWorkspaceId || draft.channelWorkspaceId === channelWorkspaceId)
    .filter((draft) => !videoProjectId || draft.videoProjectId === videoProjectId)
    .filter((draft) => !status || draft.status === status)
    .sort((a, b) => a.title.localeCompare(b.title) || b.versionNumber - a.versionNumber)

  return apiSuccess({ productionDrafts })
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const data = sanitizeYouTubeProductionDraftInput({ ...body, orgId })
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

  const sceneSourceAssetIds = data.scenes.flatMap((scene) => scene.sourceAssetIds ?? [])
  const sourceError = await validateSourceAssets(
    uniqueIds(data.sourceAssetIds, sceneSourceAssetIds),
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (sourceError) return sourceError

  const sceneClipCandidateIds = data.scenes.flatMap((scene) => scene.clipCandidateIds ?? [])
  const clipError = await validateClipCandidates(
    uniqueIds(data.clipCandidateIds, sceneClipCandidateIds),
    orgId,
    data.channelWorkspaceId,
    data.videoProjectId,
  )
  if (clipError) return clipError

  const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.productionDrafts).add({
    ...data,
    status: 'draft',
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

  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.productionDrafts, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Production draft not found', 404)

  const orgId = cleanString(loaded.data.orgId) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const channelWorkspaceId = cleanString(loaded.data.channelWorkspaceId) ?? ''
  const videoProjectId = cleanString(loaded.data.videoProjectId) ?? ''
  if (!channelWorkspaceId) return apiError('channelWorkspaceId is required', 400)
  if (!videoProjectId) return apiError('videoProjectId is required', 400)

  const channel = await loadScopedRecord(YOUTUBE_COLLECTIONS.channels, channelWorkspaceId)
  if (!channel || channel.data.deleted === true) return apiError('YouTube channel workspace not found', 404)
  if (channel.data.orgId !== orgId) return apiError('channelWorkspaceId does not belong to organisation', 400)

  const video = await loadScopedRecord(YOUTUBE_COLLECTIONS.videos, videoProjectId)
  if (!video || video.data.deleted === true) return apiError('Video project not found', 404)
  if (video.data.orgId !== orgId) return apiError('videoProjectId does not belong to organisation', 400)
  if (video.data.channelWorkspaceId !== channelWorkspaceId) {
    return apiError('videoProjectId does not belong to channel workspace', 400)
  }

  const existingStatus = pickAdminDraftStatus(loaded.data.status, 'draft')
  const status = 'status' in body ? pickAdminDraftStatus(body.status, existingStatus) : existingStatus
  let checks = cleanGateChecks(body.checks, loaded.data.checks)
  if (status === 'client_review') {
    checks = {
      ...checks,
      clientApproval: reviewCheck(user, 'Production draft sent to portal review.', 'warning'),
    }
  }
  if (status === 'approved') {
    checks = {
      ...checks,
      clientApproval: reviewCheck(user, 'Production draft approved by admin.', 'pass'),
    }
    if (hasBlockingChecks(checks)) {
      return apiError('Production draft has blocking checks and cannot be approved', 409)
    }
  }
  if (status === 'blocked') {
    checks = {
      ...checks,
      clientApproval: reviewCheck(user, 'Production draft blocked by admin.', 'block'),
    }
  }

  const write = stripUndefinedDeep({
    status,
    checks,
    visibility: cleanVisibility(body.visibility, loaded.data.visibility, status),
    approvedBy: status === 'approved' ? user.uid : undefined,
    approvedAt: status === 'approved' ? FieldValue.serverTimestamp() : undefined,
    ...updateActorFields(user),
  })
  await loaded.ref.set(stripUndefinedDeep({
    ...write,
    approvedSnapshotHash: status === 'approved'
      ? approvalSnapshotHash({ ...loaded.data, ...write } as Partial<YouTubeProductionDraft>)
      : undefined,
  }), { merge: true })

  return apiSuccess({ id, updated: true })
})
