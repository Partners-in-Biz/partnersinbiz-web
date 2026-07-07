import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'u1', role: 'admin', email: 'p@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  actorFields: jest.fn(() => ({ createdBy: 'u1', createdByType: 'user' })),
  updateActorFields: jest.fn(() => ({ updatedBy: 'u1', updatedByType: 'user' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/creative-canvas/credits', () => ({
  getCanvasCredits: jest.fn().mockResolvedValue({ orgId: 'org-1', used: 0, limit: null, updatedAt: null }),
  hasSufficientCredits: jest.fn().mockReturnValue(true),
  recordCanvasCreditUsage: jest.fn().mockResolvedValue({}),
  refundCanvasCreditUsage: jest.fn().mockResolvedValue({ amount: 1, adjusted: true }),
}))
jest.mock('@/lib/creative-canvas/connections/resolve', () => ({
  resolveCreativeProviderCredential: jest.fn().mockResolvedValue({ kind: 'connection_required' }),
}))
jest.mock('@/lib/video-editor/storage', () => ({
  saveVideoEditorUpload: jest.fn().mockResolvedValue({ id: 'up-1', url: 'https://storage.example/v.wav', storagePath: 'p', sizeBytes: 10 }),
}))
jest.mock('@/lib/video-editor/tts', () => {
  const actual = jest.requireActual('@/lib/video-editor/tts')
  return {
    ...actual,
    synthesizeSpeechOpenAiCompat: jest.fn().mockResolvedValue({
      audio: Buffer.from('wav'), mimeType: 'audio/wav', durationSeconds: 2, words: null,
    }),
    synthesizeSpeechElevenLabs: jest.fn(),
    listElevenLabsVoices: jest.fn().mockResolvedValue([]),
  }
})

const ttsJobSet = jest.fn().mockResolvedValue(undefined)
const ttsJobAdd = jest.fn().mockResolvedValue({ id: 'tts-1' })
const transcriptAdd = jest.fn().mockResolvedValue({ id: 'tr-tts-1' })
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => ({
      add: name === 'video_editor_transcripts' ? transcriptAdd : ttsJobAdd,
      doc: jest.fn(() => ({ set: ttsJobSet })),
    })),
  },
}))

import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { recordCanvasCreditUsage, refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { synthesizeSpeechOpenAiCompat } from '@/lib/video-editor/tts'
import { POST } from '@/app/api/v1/video-editor/projects/[id]/tts/route'
import { GET as getVoices } from '@/app/api/v1/video-editor/tts/voices/route'

const projectSet = jest.fn().mockResolvedValue(undefined)
const project = {
  id: 'p-1',
  ref: { set: projectSet },
  data: { orgId: 'org-1', deleted: false, timeline: { version: 1, tracks: [] } },
}
const context = { params: Promise.resolve({ id: 'p-1' }) }

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(project)
  process.env.AI_GATEWAY_API_KEY = 'gk'
})

describe('GET /api/v1/video-editor/tts/voices', () => {
  it('returns the gateway voices without BYOK', async () => {
    const res = await getVoices(new NextRequest('http://localhost/x?orgId=org-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.voices.some((v: { id: string }) => v.id === 'alloy')).toBe(true)
  })
})

describe('POST /projects/[id]/tts', () => {
  it('synthesizes sections, places clips, and creates ONE shared transcript', async () => {
    const res = await POST(req({ sections: [{ text: 'Hello world' }, { text: 'Second section' }], voice: 'alloy' }), context)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(synthesizeSpeechOpenAiCompat).toHaveBeenCalledTimes(2)
    expect(recordCanvasCreditUsage).toHaveBeenCalledWith('org-1', 1, { runId: 'tts-1', model: 'video_editor_tts' })

    const audioTrack = body.data.timeline.tracks.find((t: { kind: string }) => t.kind === 'audio')
    expect(audioTrack.clips).toHaveLength(2)
    expect(audioTrack.clips[0]).toMatchObject({ timelineStart: 0, duration: 2 })
    expect(audioTrack.clips[1].timelineStart).toBeCloseTo(2.35, 3) // 2s + 0.35s gap

    expect(transcriptAdd).toHaveBeenCalledTimes(1)
    const transcriptDoc = transcriptAdd.mock.calls[0][0]
    expect(transcriptDoc).toMatchObject({ source: 'tts', status: 'completed', alignment: 'estimated' })
    expect(transcriptDoc.segments).toHaveLength(2)
    expect(transcriptDoc.segments[0].words.length).toBeGreaterThan(0)
    expect(body.data.transcriptId).toBe('tr-tts-1')
    expect(projectSet).toHaveBeenCalled()
  })

  it('refunds when synthesis fails mid-run', async () => {
    ;(synthesizeSpeechOpenAiCompat as jest.Mock).mockRejectedValueOnce(new Error('provider down'))
    const res = await POST(req({ sections: [{ text: 'Hello' }], voice: 'alloy' }), context)
    expect(res.status).toBe(502)
    expect(refundCanvasCreditUsage).toHaveBeenCalledWith('org-1', 'tts-1')
  })

  it('rejects empty sections', async () => {
    const res = await POST(req({ sections: [], voice: 'alloy' }), context)
    expect(res.status).toBe(400)
  })

  it('503s without a gateway key and without BYOK', async () => {
    delete process.env.AI_GATEWAY_API_KEY
    const res = await POST(req({ sections: [{ text: 'Hi' }], voice: 'alloy' }), context)
    expect(res.status).toBe(503)
  })
})
