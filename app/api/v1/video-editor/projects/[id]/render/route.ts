import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import {
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
  refundCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'
import { VIDEO_EDITOR_COLLECTIONS, validateTimelineMediaRefs } from '@/lib/video-editor/api'
import { VIDEO_EDITOR_COST_LABEL, estimateEditorRenderCredits } from '@/lib/video-editor/credits'
import {
  buildVideoEditorRenderManifest,
  dispatchVideoEditorRenderJob,
  videoEditorRuntimeConfigFromEnv,
} from '@/lib/video-editor/dispatch'
import { sanitizeEditorTimeline, sanitizeVideoEditorSettingsInput, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import { authorizeMarketingStudioMutation } from '@/lib/chat-context/marketingMutationAccess'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const policyAccess = await authorizeMarketingStudioMutation(user, orgId, 'create')
  if (!policyAccess.ok) return apiError(policyAccess.error, policyAccess.status)

  const timeline = sanitizeEditorTimeline(loaded.data.timeline)
  const settings = sanitizeVideoEditorSettingsInput(loaded.data.settings)
  const issues = validateEditorTimeline(timeline)
  if (issues.length) return apiError('Timeline is invalid', 400, { details: issues })
  const refIssues = await validateTimelineMediaRefs(timeline, orgId)
  if (refIssues.length) return apiError('Timeline references invalid media', 400, { details: refIssues })

  const estimate = estimateEditorRenderCredits(timeline, settings)
  if (estimate.credits <= 0) return apiError('Timeline is empty - nothing to render', 400)

  const config = videoEditorRuntimeConfigFromEnv()
  if (!config.submitUrl) return apiError('Video editor render runtime is not configured', 503)

  const credits = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(credits, estimate.credits)) {
    return apiError(`Insufficient credits: this render needs ${estimate.credits} and the organisation is at its limit`, 402)
  }

  const actorType = user.role === 'ai' ? ('agent' as const) : ('user' as const)
  const jobRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.renderJobs).add({
    orgId,
    projectId: loaded.id,
    status: 'queued',
    timelineSnapshot: timeline,
    settingsSnapshot: settings,
    credits: { estimated: estimate.credits, charged: 0, refunded: 0 },
    provenance: { costLabel: VIDEO_EDITOR_COST_LABEL, dispatchedBy: user.uid, dispatchedByType: actorType },
    deleted: false,
    ...actorFields(user),
  })

  await recordCanvasCreditUsage(orgId, estimate.credits, { runId: jobRef.id, model: VIDEO_EDITOR_COST_LABEL })
  const jobDocRef = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.renderJobs).doc(jobRef.id)
  await jobDocRef.set({ credits: { estimated: estimate.credits, charged: estimate.credits, refunded: 0 } }, { merge: true })

  const manifest = buildVideoEditorRenderManifest({ jobId: jobRef.id, orgId, projectId: loaded.id, timeline, settings })
  try {
    const dispatched = await dispatchVideoEditorRenderJob(manifest, config)
    await jobDocRef.set({ status: 'dispatched', providerJobId: dispatched.providerJobId, ...updateActorFields(user) }, { merge: true })
    await loaded.ref.set({ status: 'rendering', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ jobId: jobRef.id, providerJobId: dispatched.providerJobId, credits: estimate }, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Render dispatch failed'
    const refund = await refundCanvasCreditUsage(orgId, jobRef.id)
    await jobDocRef.set({
      status: 'failed',
      error: { code: 'dispatch_failed', message: message.slice(0, 2000) },
      credits: { estimated: estimate.credits, charged: estimate.credits, refunded: refund.amount },
      ...updateActorFields(user),
    }, { merge: true })
    return apiError(`Render dispatch failed: ${message}`, 502)
  }
})
