import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { captionClipsFromTranscript } from '@/lib/video-editor/captions'
import { sanitizeEditorTimeline, serializeVideoEditorRecord, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import {
  EDITOR_CAPTION_ANIMATION_PRESETS,
  EDITOR_CAPTION_STYLE_PRESETS,
} from '@/lib/video-editor/types'
import type {
  EditorCaptionAnimationPreset,
  EditorCaptionStylePreset,
  VideoEditorTranscript,
} from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const transcriptId = typeof body.transcriptId === 'string' ? body.transcriptId.trim() : ''
  if (!transcriptId) return apiError('transcriptId is required', 400)
  const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : undefined
  const stylePreset = pickEnum<EditorCaptionStylePreset>(body.stylePreset, EDITOR_CAPTION_STYLE_PRESETS, 'clean')
  const animationPreset = pickEnum<EditorCaptionAnimationPreset>(body.animationPreset, EDITOR_CAPTION_ANIMATION_PRESETS, 'none')

  const transcriptLoaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.transcripts, transcriptId)
  if (!transcriptLoaded || transcriptLoaded.data.deleted === true) return apiError('Transcript not found', 404)
  const transcript = serializeVideoEditorRecord<VideoEditorTranscript>(transcriptLoaded.id, transcriptLoaded.data)
  if (transcript.orgId !== orgId || transcript.projectId !== id) return apiError('Transcript does not belong to this project', 400)
  if (transcript.status !== 'completed') return apiError('Transcript is not completed yet', 400)
  if (!transcript.segments?.length) return apiError('Transcript has no segments', 400)

  const timeline = sanitizeEditorTimeline(loaded.data.timeline)
  const clips = captionClipsFromTranscript(transcript, {
    stylePreset,
    animationPreset,
    idPrefix: `cap-${transcriptId.slice(0, 8)}-${Date.now().toString(36)}`,
  })

  if (trackId) {
    const track = timeline.tracks.find((item) => item.id === trackId && item.kind === 'caption')
    if (!track) return apiError(`Caption track '${trackId}' not found`, 400)
    track.clips = clips
  } else {
    timeline.tracks.unshift({
      id: `track-caption-${Date.now().toString(36)}`,
      kind: 'caption',
      label: `Captions (${transcript.language})`,
      clips,
    })
  }

  const issues = validateEditorTimeline(timeline)
  if (issues.length) return apiError('Generated captions produced an invalid timeline', 500, { details: issues })

  await loaded.ref.set({ timeline, ...updateActorFields(user) }, { merge: true })
  return apiSuccess({ timeline, cueCount: clips.length })
})
