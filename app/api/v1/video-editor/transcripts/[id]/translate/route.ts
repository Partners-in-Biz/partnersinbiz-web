import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { adminDb } from '@/lib/firebase/admin'
import { DRAFT_MODEL } from '@/lib/ai/client'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { actorFields, ensureOrgAccess, loadScopedRecord } from '@/lib/youtube-studio/api'
import {
  getCanvasCredits,
  hasSufficientCredits,
  recordCanvasCreditUsage,
  refundCanvasCreditUsage,
} from '@/lib/creative-canvas/credits'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { distributeWordsAcrossSpan } from '@/lib/video-editor/captions'
import { VIDEO_EDITOR_TRANSLATE_COST_LABEL, estimateTranslationCredits } from '@/lib/video-editor/credits'
import { serializeVideoEditorRecord } from '@/lib/video-editor/sanitize'
import { transcriptPlainText } from '@/lib/video-editor/transcripts'
import type { TranscriptSegment, VideoEditorTranscript } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

function parseTranslations(raw: string, expected: number): string[] | null {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as unknown
    if (!Array.isArray(parsed) || parsed.length !== expected) return null
    const items = parsed.map((item) => (typeof item === 'string' ? item.trim() : ''))
    return items.every(Boolean) ? items : null
  } catch {
    return null
  }
}

export const POST = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.transcripts, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Transcript not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim().toLowerCase() : ''
  if (!language) return apiError('language is required (e.g. "es", "af", "de")', 400)

  const transcript = serializeVideoEditorRecord<VideoEditorTranscript>(loaded.id, loaded.data)
  if (transcript.status !== 'completed' || !transcript.segments?.length) {
    return apiError('Only completed transcripts with segments can be translated', 400)
  }

  const credits = estimateTranslationCredits(transcript.text.length || transcriptPlainText(transcript.segments).length)
  const state = await getCanvasCredits(orgId)
  if (!hasSufficientCredits(state, credits)) {
    return apiError(`Insufficient credits: this translation needs ${credits} and the organisation is at its limit`, 402)
  }

  const runId = `translate-${id}-${language}-${Date.now().toString(36)}`
  await recordCanvasCreditUsage(orgId, credits, { runId, model: VIDEO_EDITOR_TRANSLATE_COST_LABEL })

  try {
    const numbered = transcript.segments.map((segment, index) => `${index + 1}. ${segment.text}`).join('\n')
    const { text } = await generateText({
      model: DRAFT_MODEL,
      prompt: [
        `Translate each numbered subtitle line into ${language}.`,
        'Keep meaning and register; keep lines short enough to work as on-screen captions.',
        `Respond with ONLY a JSON array of ${transcript.segments.length} strings, one per line, same order. No commentary.`,
        '',
        numbered,
      ].join('\n'),
    })
    const translations = parseTranslations(text, transcript.segments.length)
    if (!translations) throw new Error('Model returned malformed translation output')

    const segments: TranscriptSegment[] = transcript.segments.map((segment, index) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: translations[index],
      words: distributeWordsAcrossSpan(translations[index], segment.start, segment.end),
    }))

    const docRef = await adminDb.collection(VIDEO_EDITOR_COLLECTIONS.transcripts).add({
      orgId,
      projectId: transcript.projectId,
      ...(transcript.clipId ? { clipId: transcript.clipId } : {}),
      source: 'translation',
      translationOf: id,
      status: 'completed',
      language,
      segments,
      text: transcriptPlainText(segments),
      provider: 'gateway',
      model: DRAFT_MODEL,
      alignment: 'estimated',
      ...(transcript.durationSeconds !== undefined ? { durationSeconds: transcript.durationSeconds } : {}),
      credits: { estimated: credits, charged: credits, refunded: 0 },
      deleted: false,
      ...actorFields(user),
    })
    return apiSuccess({ transcriptId: docRef.id, language, segmentCount: segments.length, credits })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed'
    await refundCanvasCreditUsage(orgId, runId)
    return apiError(`Translation failed: ${message}`, 502)
  }
})
