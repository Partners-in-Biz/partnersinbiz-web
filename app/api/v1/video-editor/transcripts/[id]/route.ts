import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { fitSegmentsForFirestore, sanitizeTranscriptReportPatch, transcriptPlainText } from '@/lib/video-editor/transcripts'
import type { VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const TERMINAL_STATUSES = new Set(['completed', 'failed'])

async function loadTranscript(id: string) {
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.transcripts, id)
  if (!loaded || loaded.data.deleted === true) return null
  return loaded
}

export const GET = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadTranscript(id)
  if (!loaded) return apiError('Transcript not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  return apiSuccess({ transcript: serializeVideoEditorRecord<VideoEditorTranscript>(loaded.id, loaded.data) })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadTranscript(id)
  if (!loaded) return apiError('Transcript not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const patch = sanitizeTranscriptReportPatch(body)
  if (!patch.status) return apiError('A valid status (processing | completed | failed) with required fields is needed', 400)

  const currentStatus = String(loaded.data.status ?? '')
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return apiSuccess({ id, status: currentStatus, alreadyTerminal: true })
  }

  if (patch.status === 'processing') {
    await loaded.ref.set({ status: 'processing', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ id, status: 'processing' })
  }

  if (patch.status === 'completed') {
    const fitted = fitSegmentsForFirestore(patch.segments ?? [])
    await loaded.ref.set({
      status: 'completed',
      segments: fitted.segments,
      wordsTruncated: fitted.wordsTruncated,
      text: transcriptPlainText(fitted.segments),
      ...(patch.language ? { language: patch.language } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
      ...updateActorFields(user),
    }, { merge: true })
    return apiSuccess({ id, status: 'completed', segmentCount: fitted.segments.length })
  }

  const refund = await refundCanvasCreditUsage(orgId, id)
  const existingCredits = (loaded.data.credits as Record<string, unknown> | undefined) ?? {}
  await loaded.ref.set({
    status: 'failed',
    ...(patch.error ? { error: patch.error } : {}),
    credits: { ...existingCredits, refunded: refund.amount },
    ...updateActorFields(user),
  }, { merge: true })
  return apiSuccess({ id, status: 'failed', refunded: refund.amount })
})

export const DELETE = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadTranscript(id)
  if (!loaded) return apiError('Transcript not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  await loaded.ref.set({ deleted: true, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ id, deleted: true })
})
