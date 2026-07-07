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
jest.mock('ai', () => ({ generateText: jest.fn() }))

const translationAdd = jest.fn().mockResolvedValue({ id: 'tr-es-1' })
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn(() => ({ add: translationAdd, doc: jest.fn(() => ({ set: jest.fn() })) })) },
}))

import { generateText } from 'ai'
import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { recordCanvasCreditUsage, refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { POST } from '@/app/api/v1/video-editor/transcripts/[id]/translate/route'

const transcript = {
  id: 'tr-1',
  ref: { set: jest.fn() },
  data: {
    orgId: 'org-1', projectId: 'p-1', status: 'completed', deleted: false, language: 'en',
    text: 'Hello world. Second line.',
    segments: [
      { id: 's1', start: 0, end: 2, text: 'Hello world.', words: [{ text: 'Hello', start: 0, end: 1 }, { text: 'world.', start: 1, end: 2 }] },
      { id: 's2', start: 2.5, end: 4, text: 'Second line.', words: [] },
    ],
  },
}
const context = { params: Promise.resolve({ id: 'tr-1' }) }

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(transcript)
  ;(generateText as jest.Mock).mockResolvedValue({ text: JSON.stringify(['Hola mundo.', 'Segunda línea.']) })
})

describe('POST /transcripts/[id]/translate', () => {
  it('creates a translated transcript with original timings and estimated words', async () => {
    const res = await POST(req({ language: 'es' }), context)
    expect(res.status).toBe(200)
    expect((await res.json()).data.transcriptId).toBe('tr-es-1')
    expect(recordCanvasCreditUsage).toHaveBeenCalledWith('org-1', 1, expect.objectContaining({ model: 'video_editor_translation' }))
    const doc = translationAdd.mock.calls[0][0]
    expect(doc).toMatchObject({ source: 'translation', translationOf: 'tr-1', language: 'es', status: 'completed', alignment: 'estimated' })
    expect(doc.segments[0]).toMatchObject({ id: 's1', start: 0, end: 2, text: 'Hola mundo.' })
    expect(doc.segments[0].words.map((w: { text: string }) => w.text)).toEqual(['Hola', 'mundo.'])
    expect(doc.segments[1]).toMatchObject({ start: 2.5, end: 4, text: 'Segunda línea.' })
  })

  it('refunds when the model returns malformed output', async () => {
    ;(generateText as jest.Mock).mockResolvedValue({ text: 'not json' })
    const res = await POST(req({ language: 'es' }), context)
    expect(res.status).toBe(502)
    expect(refundCanvasCreditUsage).toHaveBeenCalled()
  })

  it('rejects missing language and incomplete transcripts', async () => {
    expect((await POST(req({}), context)).status).toBe(400)
    ;(loadScopedRecord as jest.Mock).mockResolvedValue({ ...transcript, data: { ...transcript.data, status: 'processing' } })
    expect((await POST(req({ language: 'es' }), context)).status).toBe(400)
  })
})
