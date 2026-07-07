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
import { resolveCreativeProviderCredential } from '@/lib/creative-canvas/connections/resolve'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { VIDEO_EDITOR_TRANSCRIBE_COST_LABEL, estimateTranscriptionCredits } from '@/lib/video-editor/credits'
import { sanitizeEditorTimeline } from '@/lib/video-editor/sanitize'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import {
  buildTranscriptionManifest,
  dispatchTranscriptionJob,
  transcriptionRuntimeConfigFromEnv,
} from '@/lib/video-editor/transcribe-dispatch'
import type { VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const GET = withAuth('client', async (req: NextRequest, user) => {
  const projectId = req.nextUrl.searchParams.get('projectId')
  if (!projectId) return apiError('projectId is required', 400)
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, projectId)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const snap = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts)
    .where('orgId', '==', orgId)
    .where('projectId', '==', projectId)
    .where('deleted', '==', false)
    .get()
  const transcripts = snap.docs.map((doc) =>
    serializeVideoEditorRecord<VideoEditorTranscript>(doc.id, doc.data() as Record<string, unknown>))
  return apiSuccess({ transcripts })
})

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const projectId = cleanString(body.projectId)
  const clipId = cleanString(body.clipId)
  const language = cleanString(body.language)
  if (!projectId) return apiError('projectId is required', 400)

  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, projectId)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  // Resolve what to transcribe.
  let media: { url: string; mediaKind: 'video' | 'audio' } | null = null
  let source: VideoEditorTranscript['source'] = 'media'
  let durationSeconds = 0
  if (clipId) {
    const timeline = sanitizeEditorTimeline(loaded.data.timeline)
    for (const track of timeline.tracks) {
      const clip = track.clips.find((item) => item.id === clipId)
      if (clip?.media && (clip.media.mediaKind === 'video' || clip.media.mediaKind === 'audio')) {
        media = { url: clip.media.url, mediaKind: clip.media.mediaKind }
        durationSeconds = clip.media.sourceDuration ?? clip.duration
        break
      }
    }
    if (!media) return apiError('Clip not found or has no transcribable media (video/audio required)', 400)
  } else {
    const lastRender = loaded.data.lastRender as Record<string, unknown> | undefined
    const url = cleanString(lastRender?.url)
    if (!url) return apiError('Render the timeline first — whole-timeline transcription uses the last rendered output', 400)
    media = { url, mediaKind: 'video' }
    source = 'timeline_render'
    durationSeconds = typeof lastRender?.durationSeconds === 'number' ? lastRender.durationSeconds : 600
  }

  const credits = estimateTranscriptionCredits(durationSeconds)
  if (credits <= 0) return apiError('Nothing to transcribe — source duration is zero', 400)

  const config = transcriptionRuntimeConfigFromEnv()
  if (!config.submitUrl) return apiError('Transcription runtime is not configured', 503)

  const state = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(state, credits)) {
    return apiError(`Insufficient credits: this transcription needs ${credits} and the organisation is at its limit`, 402)
  }

  // BYOK override: per-org/per-user openai_audio key beats the platform gateway.
  const credential = await resolveCreativeProviderCredential({ provider: 'openai_audio', orgId, uid: user.uid })
  const byok = credential.kind === 'byok' && typeof credential.credentials.apiKey === 'string'
    ? {
        apiKey: credential.credentials.apiKey,
        ...(typeof credential.credentials.baseUrl === 'string' && credential.credentials.baseUrl.trim()
          ? { baseUrl: credential.credentials.baseUrl.trim() }
          : {}),
      }
    : undefined

  const docRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).add({
    orgId,
    projectId,
    ...(clipId ? { clipId } : {}),
    source,
    status: 'queued',
    language: language ?? 'auto',
    media,
    segments: [],
    text: '',
    provider: byok ? 'byok:openai_audio' : 'gateway',
    alignment: 'provider',
    credits: { estimated: credits, charged: 0, refunded: 0 },
    deleted: false,
    ...actorFields(user),
  })

  await recordCanvasCreditUsage(orgId, credits, { runId: docRef.id, model: VIDEO_EDITOR_TRANSCRIBE_COST_LABEL })
  const docHandle = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).doc(docRef.id)
  await docHandle.set({ credits: { estimated: credits, charged: credits, refunded: 0 } }, { merge: true })

  const manifest = buildTranscriptionManifest({
    transcriptId: docRef.id, orgId, projectId, media,
    ...(language ? { language } : {}),
    ...(byok ? { byok } : {}),
  })

  try {
    const dispatched = await dispatchTranscriptionJob(manifest, config)
    await docHandle.set({ status: 'dispatched', providerJobId: dispatched.providerJobId, ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ transcriptId: docRef.id, providerJobId: dispatched.providerJobId, credits }, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription dispatch failed'
    const refund = await refundCanvasCreditUsage(orgId, docRef.id)
    await docHandle.set({
      status: 'failed',
      error: { code: 'dispatch_failed', message: message.slice(0, 2000) },
      credits: { estimated: credits, charged: credits, refunded: refund.amount },
      ...updateActorFields(user),
    }, { merge: true })
    return apiError(`Transcription dispatch failed: ${message}`, 502)
  }
})
