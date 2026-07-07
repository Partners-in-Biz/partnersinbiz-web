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
import { distributeWordsAcrossSpan } from '@/lib/video-editor/captions'
import { VIDEO_EDITOR_TTS_COST_LABEL, estimateTtsCredits } from '@/lib/video-editor/credits'
import { sanitizeEditorTimeline, validateEditorTimeline } from '@/lib/video-editor/sanitize'
import { saveVideoEditorUpload } from '@/lib/video-editor/storage'
import {
  DEFAULT_TTS_BYOK_MODEL,
  DEFAULT_TTS_GATEWAY_BASE_URL,
  DEFAULT_TTS_MODEL,
  synthesizeSpeechElevenLabs,
  synthesizeSpeechOpenAiCompat,
} from '@/lib/video-editor/tts'
import { transcriptPlainText } from '@/lib/video-editor/transcripts'
import type { EditorClip, TranscriptSegment } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const SECTION_GAP_SECONDS = 0.35
const MAX_SECTIONS = 40
const MAX_SECTION_CHARS = 4000

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Video editor project not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const rawSections = Array.isArray(body.sections) ? body.sections : []
  const sections = rawSections
    .map((entry) => (entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).text ?? '').trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_SECTIONS)
    .map((text) => text.slice(0, MAX_SECTION_CHARS))
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : ''
  const providerChoice = body.provider === 'elevenlabs' ? 'elevenlabs' : 'gateway'
  const trackId = typeof body.trackId === 'string' && body.trackId.trim() ? body.trackId.trim() : undefined
  const startAtSeconds = typeof body.startAtSeconds === 'number' && Number.isFinite(body.startAtSeconds)
    ? Math.max(0, body.startAtSeconds)
    : 0
  if (!sections.length) return apiError('At least one non-empty section is required', 400)
  if (!voice) return apiError('voice is required', 400)

  // Provider resolution: BYOK beats platform gateway; ElevenLabs is BYOK-only.
  const elevenCred = providerChoice === 'elevenlabs'
    ? await resolveCreativeProviderCredential({ provider: 'elevenlabs', orgId, uid: user.uid })
    : null
  if (providerChoice === 'elevenlabs' && (elevenCred?.kind !== 'byok' || typeof elevenCred.credentials.apiKey !== 'string')) {
    return apiError('ElevenLabs requires a connected API key for this organisation', 400)
  }
  const elevenApiKey = elevenCred?.kind === 'byok' && typeof elevenCred.credentials.apiKey === 'string'
    ? elevenCred.credentials.apiKey
    : null
  const openAiCred = providerChoice === 'gateway'
    ? await resolveCreativeProviderCredential({ provider: 'openai_audio', orgId, uid: user.uid })
    : null
  const byokOpenAi = openAiCred?.kind === 'byok' && typeof openAiCred.credentials.apiKey === 'string'
    ? {
        apiKey: openAiCred.credentials.apiKey,
        baseUrl: typeof openAiCred.credentials.baseUrl === 'string' && openAiCred.credentials.baseUrl.trim()
          ? openAiCred.credentials.baseUrl.trim()
          : 'https://api.openai.com/v1',
      }
    : null
  const gatewayKey = (process.env.AI_GATEWAY_API_KEY ?? '').trim()
  if (providerChoice === 'gateway' && !byokOpenAi && !gatewayKey) {
    return apiError('TTS is not configured (set AI_GATEWAY_API_KEY or connect an OpenAI-compatible key)', 503)
  }

  const totalChars = sections.reduce((sum, text) => sum + text.length, 0)
  const credits = estimateTtsCredits(totalChars)
  const state = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(state, credits)) {
    return apiError(`Insufficient credits: this voiceover needs ${credits} and the organisation is at its limit`, 402)
  }

  const providerLabel = providerChoice === 'elevenlabs' ? 'byok:elevenlabs' : (byokOpenAi ? 'byok:openai_audio' : 'gateway')
  const jobRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.ttsJobs).add({
    orgId, projectId: id, status: 'processing', voice, provider: providerLabel,
    sectionCount: sections.length, totalChars,
    credits: { estimated: credits, charged: 0, refunded: 0 },
    deleted: false,
    ...actorFields(user),
  })
  await recordCanvasCreditUsage(orgId, credits, { runId: jobRef.id, model: VIDEO_EDITOR_TTS_COST_LABEL })
  const jobDoc = adminDb.collection(VIDEO_EDITOR_COLLECTIONS.ttsJobs).doc(jobRef.id)
  await jobDoc.set({ credits: { estimated: credits, charged: credits, refunded: 0 } }, { merge: true })

  try {
    const clips: EditorClip[] = []
    const segments: TranscriptSegment[] = []
    let alignment: 'provider' | 'estimated' = 'provider'
    let cursor = startAtSeconds

    for (let index = 0; index < sections.length; index += 1) {
      const text = sections[index]
      const synthesized = providerChoice === 'elevenlabs'
        ? await synthesizeSpeechElevenLabs({ text, voiceId: voice, apiKey: String(elevenApiKey) })
        : await synthesizeSpeechOpenAiCompat({
            text,
            voice,
            baseUrl: byokOpenAi ? byokOpenAi.baseUrl : DEFAULT_TTS_GATEWAY_BASE_URL,
            apiKey: byokOpenAi ? byokOpenAi.apiKey : gatewayKey,
            model: (process.env.VIDEO_EDITOR_TTS_MODEL ?? '').trim() || (byokOpenAi ? DEFAULT_TTS_BYOK_MODEL : DEFAULT_TTS_MODEL),
          })
      const duration = Math.max(synthesized.durationSeconds, 0.2)
      const extension = synthesized.mimeType === 'audio/wav' ? 'wav' : 'mp3'
      const uploaded = await saveVideoEditorUpload(synthesized.audio, {
        orgId,
        folder: `video-editor/${orgId}/${id}`,
        filename: `tts-${jobRef.id}-${index + 1}.${extension}`,
        mimeType: synthesized.mimeType,
        user,
        relatedTo: { type: 'video_editor_project', id },
      })
      clips.push({
        id: `tts-${jobRef.id}-${index + 1}`,
        timelineStart: round3(cursor),
        duration: round3(duration),
        volume: 1,
        media: { type: 'upload', fileId: uploaded.id, url: uploaded.url, mediaKind: 'audio', sourceDuration: duration },
      })
      const words = synthesized.words?.length
        ? synthesized.words.map((word) => ({ text: word.text, start: round3(cursor + word.start), end: round3(cursor + word.end) }))
        : distributeWordsAcrossSpan(text, cursor, cursor + duration)
      if (!synthesized.words?.length) alignment = 'estimated'
      segments.push({ id: `tts-s${index + 1}`, start: round3(cursor), end: round3(cursor + duration), text, words })
      cursor += duration + SECTION_GAP_SECONDS
    }

    // Place clips on the requested or a new "Voiceover" audio track.
    const timeline = sanitizeEditorTimeline(loaded.data.timeline)
    let track = trackId ? timeline.tracks.find((item) => item.id === trackId && item.kind === 'audio') : undefined
    if (trackId && !track) return apiError(`Audio track '${trackId}' not found`, 400)
    if (!track) {
      track = { id: `track-audio-vo-${Date.now().toString(36)}`, kind: 'audio', label: 'Voiceover', clips: [] }
      timeline.tracks.push(track)
    }
    track.clips.push(...clips)
    const issues = validateEditorTimeline(timeline)
    if (issues.length) return apiError('Voiceover clips would overlap existing audio — pick a different start time or track', 400, { details: issues })

    // THE shared transcript: captions generated from this can never desync from the voiceover.
    const transcriptRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).add({
      orgId, projectId: id, source: 'tts', status: 'completed',
      language: 'auto', segments, text: transcriptPlainText(segments),
      provider: providerLabel, alignment,
      durationSeconds: round3(cursor - SECTION_GAP_SECONDS - startAtSeconds),
      credits: { estimated: 0, charged: 0, refunded: 0 },
      deleted: false,
      ...actorFields(user),
    })

    await loaded.ref.set({ timeline, ...updateActorFields(user) }, { merge: true })
    await jobDoc.set({ status: 'completed', transcriptId: transcriptRef.id, trackId: track.id, ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ jobId: jobRef.id, transcriptId: transcriptRef.id, trackId: track.id, timeline, alignment, credits })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS generation failed'
    const refund = await refundCanvasCreditUsage(orgId, jobRef.id)
    await jobDoc.set({
      status: 'failed',
      error: { code: 'tts_failed', message: message.slice(0, 2000) },
      credits: { estimated: credits, charged: credits, refunded: refund.amount },
      ...updateActorFields(user),
    }, { merge: true })
    return apiError(`TTS generation failed: ${message}`, 502)
  }
})
