import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, updateActorFields } from '@/lib/youtube-studio/api'
import { buildBeatAnalysisManifest, dispatchBeatAnalysis } from '@/lib/video-editor/beats'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function orgIdFrom(req: NextRequest): string {
  return new URL(req.url).searchParams.get('orgId')?.trim() ?? ''
}

async function loadUpload(id: string, orgId: string) {
  const ref = adminDb.collection('uploads').doc(id)
  const snap = await ref.get()
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : undefined
  if (!data || data.deleted === true || data.orgId !== orgId) return null
  return { ref, data }
}

function cleanBeats(value: unknown): number[] {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
    .slice(0, 5000)
}

export const GET = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = orgIdFrom(req)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const upload = await loadUpload(id, orgId)
  if (!upload) return apiError('Upload not found', 404)
  return apiSuccess({
    beats: cleanBeats(upload.data.beatMarkers),
    bpm: typeof upload.data.beatBpm === 'number' && Number.isFinite(upload.data.beatBpm) ? upload.data.beatBpm : 0,
    status: typeof upload.data.beatAnalysis === 'string' ? upload.data.beatAnalysis : 'none',
  })
})

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = orgIdFrom(req)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const upload = await loadUpload(id, orgId)
  if (!upload) return apiError('Upload not found', 404)
  const mediaUrl = typeof upload.data.url === 'string' ? upload.data.url : ''
  if (!/^https:\/\//.test(mediaUrl)) return apiError('Upload has no analyzable URL', 400)
  await upload.ref.set({ beatAnalysis: 'analyzing', ...updateActorFields(user) }, { merge: true })
  try {
    const manifest = buildBeatAnalysisManifest({ uploadId: id, orgId, mediaUrl })
    const dispatched = await dispatchBeatAnalysis(manifest)
    return apiSuccess({ providerJobId: dispatched.providerJobId }, 202)
  } catch (error) {
    await upload.ref.set({ beatAnalysis: 'failed', ...updateActorFields(user) }, { merge: true })
    return apiError(`Beat analysis dispatch failed: ${error instanceof Error ? error.message : 'unknown'}`, 502)
  }
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const orgId = orgIdFrom(req)
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied
  const upload = await loadUpload(id, orgId)
  if (!upload) return apiError('Upload not found', 404)
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.status === 'failed') {
    await upload.ref.set({ beatAnalysis: 'failed', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ status: 'failed' })
  }
  if (body.status !== 'analyzed') {
    return apiError('A valid beat analysis status (analyzed | failed) is required', 400)
  }
  if (!Array.isArray(body.beats)) {
    return apiError('beats must be an array', 400)
  }
  const beats = cleanBeats(body.beats)
  const bpm = typeof body.bpm === 'number' && Number.isFinite(body.bpm) && body.bpm >= 0 ? body.bpm : 0
  await upload.ref.set({
    beatMarkers: beats,
    beatBpm: bpm,
    beatAnalysis: 'analyzed',
    ...updateActorFields(user),
  }, { merge: true })
  return apiSuccess({ status: 'analyzed', beats: beats.length, bpm })
})
