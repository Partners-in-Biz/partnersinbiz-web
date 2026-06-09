import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  actorFields,
  ensureOrgAccess,
  listByOrg,
  loadScopedRecord,
  updateActorFields,
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
    outputPersistence: contract.outputPersistence,
    mutationPolicy: contract.mutationPolicy,
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

type LoadedJob = {
  id: string
  ref: { set: (patch: Record<string, unknown>, options?: { merge: boolean }) => Promise<unknown> }
  data: Record<string, unknown>
}

type HermesWorkerResponse = {
  runId: string
  raw: Record<string, unknown>
}

const TERMINAL_CALLBACK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'error'])

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function getHermesWorkerConfig(): { runsUrl: string; apiKey?: string } | null {
  const configuredUrl = cleanString(process.env.YOUTUBE_STUDIO_HERMES_WORKER_URL)
    ?? cleanString(process.env.HERMES_RUNS_URL)
    ?? cleanString(process.env.HERMES_API_BASE_URL)
  if (!configuredUrl) return null

  const runsUrl = configuredUrl.endsWith('/v1/runs') ? configuredUrl : joinUrl(configuredUrl, '/v1/runs')
  return {
    runsUrl,
    apiKey: cleanString(process.env.YOUTUBE_STUDIO_HERMES_WORKER_KEY) ?? cleanString(process.env.HERMES_API_KEY),
  }
}

function extractRunId(payload: Record<string, unknown>): string | undefined {
  return cleanString(payload.runId) ?? cleanString(payload.run_id) ?? cleanString(payload.id)
}

function appendStatusHistory(job: Record<string, unknown>, entry: Record<string, unknown>) {
  const current = Array.isArray(job.statusHistory) ? job.statusHistory : []
  return current.concat({ ...entry, at: FieldValue.serverTimestamp() }).slice(-50)
}

function linkedPublishingPacketIds(job: Record<string, unknown>): string[] {
  const linked = cleanObject(job.linked)
  const packetIds = cleanStringArray(linked.publishingPacketIds)
  const inputPacket = cleanObject(job.inputPacket)
  const references = cleanObject(inputPacket.references)
  return Array.from(new Set(packetIds.concat(cleanStringArray(references.publishingPacketIds))))
}

async function addLifecycleComment(job: LoadedJob, body: string, userId: string) {
  await adminDb.collection('comments').add({
    orgId: job.data.orgId,
    resourceType: 'youtube_agent_job',
    resourceId: job.id,
    body,
    visibility: 'internal',
    createdBy: userId,
    createdByType: 'user',
    updatedBy: userId,
    updatedByType: 'user',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => null)
}

async function loadJobForAction(orgId: string, jobId: string): Promise<LoadedJob | { error: Response }> {
  const loaded = await loadScopedRecord(YOUTUBE_COLLECTIONS.agentJobs, jobId)
  if (!loaded || loaded.data.deleted === true) return { error: apiError('YouTube agent job not found', 404) }
  if (loaded.data.orgId !== orgId) return { error: apiError('YouTube agent job does not belong to organisation', 400) }
  return loaded as LoadedJob
}

function buildHermesPrompt(job: LoadedJob): string {
  const packet = cleanObject(job.data.inputPacket)
  return [
    `[YouTube Studio job ${job.id}] ${cleanString(job.data.title) ?? 'Execute YouTube production skill'}`,
    '',
    'Execute the attached YouTube Studio skill packet. Return only reviewable outputs and artifact payloads.',
    'Governance: do not publish, schedule, change visibility, approve, reject, or otherwise mutate YouTube publish state. Proposed publish-state changes must be returned as recommendations for human review.',
    'Persistence: return artifacts/comments only. All outputs will be saved with actor metadata for human review, not silently applied.',
    '',
    JSON.stringify({
      jobId: job.id,
      orgId: job.data.orgId,
      channelWorkspaceId: job.data.channelWorkspaceId,
      videoProjectId: job.data.videoProjectId,
      skillKey: job.data.skillKey,
      inputPacket: packet,
    }),
  ].join('\n')
}

async function dispatchHermesRun(job: LoadedJob): Promise<HermesWorkerResponse | { error: Response }> {
  const cfg = getHermesWorkerConfig()
  if (!cfg) return { error: apiError('Hermes worker dispatch is not configured', 503) }

  const res = await fetch(cfg.runsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      input: buildHermesPrompt(job),
      metadata: {
        source: 'youtube-studio',
        orgId: job.data.orgId,
        jobId: job.id,
        skillKey: job.data.skillKey,
        channelWorkspaceId: job.data.channelWorkspaceId,
        videoProjectId: job.data.videoProjectId,
      },
    }),
  })

  const text = await res.text()
  let payload: Record<string, unknown> = {}
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      payload = { raw: text }
    }
  }
  if (!res.ok) return { error: apiError(`Hermes worker dispatch failed with ${res.status}`, 502) }

  const runId = extractRunId(payload)
  if (!runId) return { error: apiError('Hermes worker did not return a run id', 502) }
  return { runId, raw: payload }
}

async function stopHermesRun(runId: string) {
  const cfg = getHermesWorkerConfig()
  if (!cfg) return
  await fetch(joinUrl(cfg.runsUrl, `${encodeURIComponent(runId)}/stop`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
  }).catch(() => null)
}

function cleanOutputArtifact(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const artifact = cleanObject(entry)
    const type = cleanString(artifact.type) ?? cleanString(artifact.kind)
    if (!type) return []
    return [{
      type,
      label: cleanString(artifact.label) ?? type,
      content: artifact.content ?? artifact.markdown ?? artifact.text ?? artifact.data ?? '',
      sourceUrl: cleanString(artifact.sourceUrl),
      storagePath: cleanString(artifact.storagePath),
    }]
  })
}

function normalizeReviewableOutput(raw: unknown) {
  const output = typeof raw === 'string' ? { summary: raw } : cleanObject(raw)
  const summary = cleanString(output.summary) ?? cleanString(output.message) ?? cleanString(output.text)
  const hasPublishMutationProposal = Boolean(output.publishState || output.publishPatch || output.releasePlanPatch || output.publishingPacketPatch)
  return {
    ...output,
    summary,
    publishStateMutationBlocked: hasPublishMutationProposal,
    governance: {
      publishStateMutationBlocked: hasPublishMutationProposal,
      reason: hasPublishMutationProposal
        ? 'Skill output proposed publish-state changes. They were captured for review and not applied to linked packets, release plans, schedules, approvals, or visibility.'
        : 'Skill output captured as reviewable output only.',
    },
  }
}

async function ingestReviewableArtifacts(job: LoadedJob, output: Record<string, unknown>, userId: string): Promise<string[]> {
  const artifacts = cleanOutputArtifact(output.artifacts)
  const ids: string[] = []
  for (const artifact of artifacts) {
    const ref = await adminDb.collection(YOUTUBE_COLLECTIONS.agentArtifacts).add({
      orgId: job.data.orgId,
      channelWorkspaceId: job.data.channelWorkspaceId,
      videoProjectId: job.data.videoProjectId,
      jobId: job.id,
      skillKey: job.data.skillKey,
      reviewState: 'pending',
      visibility: 'internal',
      linked: { publishingPacketIds: linkedPublishingPacketIds(job) },
      ...artifact,
      createdBy: userId,
      createdByType: 'user',
      updatedBy: userId,
      updatedByType: 'user',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    })
    ids.push(ref.id)
  }
  return ids
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

export const PUT = withAuth('admin', async (req: NextRequest, user) => {
  const body = cleanObject(await req.json().catch(() => ({})))
  const orgId = cleanString(body.orgId) ?? ''
  const jobId = cleanString(body.jobId) ?? cleanString(body.id) ?? ''
  const action = cleanString(body.action) ?? ''
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  if (!jobId) return apiError('jobId is required', 400)

  const loaded = await loadJobForAction(orgId, jobId)
  if ('error' in loaded) return loaded.error
  const job = loaded

  if (action === 'dispatch' || action === 'retry') {
    const dispatch = await dispatchHermesRun(job)
    if ('error' in dispatch) return dispatch.error
    const retryCount = action === 'retry' ? Number(job.data.retryCount ?? 0) + 1 : Number(job.data.retryCount ?? 0)
    const patch = {
      status: 'running',
      hermesRunId: dispatch.runId,
      agentConversationId: dispatch.runId,
      hermesDispatchResponse: dispatch.raw,
      agentHeartbeatAt: FieldValue.serverTimestamp(),
      lifecycleState: 'dispatched',
      statusHistory: appendStatusHistory(job.data, { status: 'running', action, runId: dispatch.runId, actorId: user.uid }),
      retryCount,
      ...(action === 'retry' ? { outputArtifactIds: [], reviewableOutput: null, blockedReason: null } : {}),
      ...updateActorFields(user),
    }
    await job.ref.set(patch, { merge: true })
    await addLifecycleComment(job, `Hermes run dispatched (${dispatch.runId}) for YouTube packet job.`, user.uid)
    return apiSuccess({ id: job.id, status: 'running', runId: dispatch.runId })
  }

  if (action === 'callback') {
    const callbackRunId = cleanString(body.runId) ?? cleanString(body.run_id)
    const existingRunId = cleanString(job.data.hermesRunId) ?? cleanString(job.data.agentConversationId)
    if (existingRunId && callbackRunId && existingRunId !== callbackRunId) {
      return apiError('Callback runId does not match active Hermes run', 409)
    }

    const rawStatus = (cleanString(body.status) ?? 'running').toLowerCase()
    const normalizedStatus = rawStatus === 'canceled' || rawStatus === 'cancelled'
      ? 'cancelled'
      : rawStatus === 'error'
        ? 'failed'
        : rawStatus
    if (!isJobStatus(normalizedStatus)) return apiError('Unsupported Hermes callback status', 400)

    if (normalizedStatus === 'completed') {
      const reviewableOutput = normalizeReviewableOutput(body.output ?? body.result ?? body.summary)
      const artifactIds = await ingestReviewableArtifacts(job, reviewableOutput, user.uid)
      const nextStatus: YouTubeAgentJobStatus = job.data.reviewRequired === false ? 'completed' : 'waiting_for_review'
      const patch = {
        status: nextStatus,
        outputArtifactIds: artifactIds,
        reviewableOutput,
        agentHeartbeatAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
        lifecycleState: nextStatus === 'completed' ? 'completed' : 'awaiting_review',
        statusHistory: appendStatusHistory(job.data, { status: nextStatus, action: 'callback', runId: callbackRunId, actorId: user.uid }),
        ...updateActorFields(user),
      }
      await job.ref.set(patch, { merge: true })
      await addLifecycleComment(job, `Hermes run ${callbackRunId ?? existingRunId ?? ''} completed; output captured for review.`, user.uid)
      return apiSuccess({ id: job.id, status: nextStatus, outputArtifactIds: artifactIds })
    }

    if (normalizedStatus === 'failed' || normalizedStatus === 'cancelled') {
      const blockedReason = cleanString(body.error) ?? cleanString(body.reason) ?? cleanString(body.message)
      const patch = {
        status: normalizedStatus,
        blockedReason,
        agentHeartbeatAt: FieldValue.serverTimestamp(),
        lifecycleState: normalizedStatus,
        statusHistory: appendStatusHistory(job.data, { status: normalizedStatus, action: 'callback', runId: callbackRunId, actorId: user.uid, blockedReason }),
        ...updateActorFields(user),
      }
      await job.ref.set(patch, { merge: true })
      await addLifecycleComment(job, `Hermes run ${callbackRunId ?? existingRunId ?? ''} ${normalizedStatus}${blockedReason ? `: ${blockedReason}` : ''}.`, user.uid)
      return apiSuccess({ id: job.id, status: normalizedStatus })
    }

    const patch = {
      status: normalizedStatus,
      agentHeartbeatAt: FieldValue.serverTimestamp(),
      lifecycleState: body.heartbeat === true || !TERMINAL_CALLBACK_STATUSES.has(rawStatus) ? 'heartbeat' : normalizedStatus,
      statusMessage: cleanString(body.message),
      statusHistory: appendStatusHistory(job.data, { status: normalizedStatus, action: 'heartbeat', runId: callbackRunId, actorId: user.uid }),
      ...updateActorFields(user),
    }
    await job.ref.set(patch, { merge: true })
    return apiSuccess({ id: job.id, status: normalizedStatus })
  }

  if (action === 'cancel') {
    const runId = cleanString(job.data.hermesRunId) ?? cleanString(job.data.agentConversationId)
    if (runId) await stopHermesRun(runId)
    const reason = cleanString(body.reason) ?? 'Cancelled by operator'
    const patch = {
      status: 'cancelled',
      blockedReason: reason,
      cancelledAt: FieldValue.serverTimestamp(),
      lifecycleState: 'cancelled',
      statusHistory: appendStatusHistory(job.data, { status: 'cancelled', action: 'cancel', runId, actorId: user.uid, blockedReason: reason }),
      ...updateActorFields(user),
    }
    await job.ref.set(patch, { merge: true })
    await addLifecycleComment(job, `Hermes run ${runId ?? ''} cancelled: ${reason}.`, user.uid)
    return apiSuccess({ id: job.id, status: 'cancelled' })
  }

  return apiError('Unsupported YouTube agent job lifecycle action', 400)
})
