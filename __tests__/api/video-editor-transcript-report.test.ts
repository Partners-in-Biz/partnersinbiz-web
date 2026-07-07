import { NextRequest } from 'next/server'

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, context?: unknown) => handler(req, { uid: 'agent-1', role: 'ai', email: 'a@x.test' }, context),
}))
jest.mock('@/lib/youtube-studio/api', () => ({
  updateActorFields: jest.fn(() => ({ updatedBy: 'agent-1', updatedByType: 'agent' })),
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  loadScopedRecord: jest.fn(),
}))
jest.mock('@/lib/creative-canvas/credits', () => ({
  refundCanvasCreditUsage: jest.fn().mockResolvedValue({ amount: 1, adjusted: true }),
}))
jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: jest.fn() } }))

import { loadScopedRecord } from '@/lib/youtube-studio/api'
import { refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { GET, PUT, DELETE } from '@/app/api/v1/video-editor/transcripts/[id]/route'

const setMock = jest.fn().mockResolvedValue(undefined)
const baseDoc = {
  id: 'tr-1',
  ref: { set: setMock },
  data: {
    orgId: 'org-1', projectId: 'p-1', status: 'dispatched', deleted: false,
    credits: { estimated: 1, charged: 1, refunded: 0 }, segments: [], text: '',
  },
}
const context = { params: Promise.resolve({ id: 'tr-1' }) }

function putReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/v1/video-editor/transcripts/tr-1', {
    method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadScopedRecord as jest.Mock).mockResolvedValue(baseDoc)
})

describe('transcript [id] route', () => {
  it('GET returns the transcript', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), context)
    expect(res.status).toBe(200)
    expect((await res.json()).data.transcript.id).toBe('tr-1')
  })

  it('PUT completed stores segments, text and duration', async () => {
    const res = await PUT(putReq({
      status: 'completed',
      language: 'en',
      durationSeconds: 42,
      segments: [{ id: 's1', start: 0, end: 2, text: 'Hello world', words: [{ text: 'Hello', start: 0, end: 1 }, { text: 'world', start: 1, end: 2 }] }],
    }), context)
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', text: 'Hello world', language: 'en', durationSeconds: 42, wordsTruncated: false,
    }), { merge: true })
  })

  it('PUT failed refunds the charge', async () => {
    const res = await PUT(putReq({ status: 'failed', error: { code: 'whisper_error', message: 'boom' } }), context)
    expect(res.status).toBe(200)
    expect(refundCanvasCreditUsage).toHaveBeenCalledWith('org-1', 'tr-1')
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), { merge: true })
  })

  it('PUT is a no-op on terminal transcripts', async () => {
    ;(loadScopedRecord as jest.Mock).mockResolvedValue({ ...baseDoc, data: { ...baseDoc.data, status: 'completed' } })
    const res = await PUT(putReq({ status: 'failed' }), context)
    expect((await res.json()).data.alreadyTerminal).toBe(true)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('PUT rejects an invalid report', async () => {
    const res = await PUT(putReq({ status: 'completed', segments: [] }), context)
    expect(res.status).toBe(400)
  })

  it('DELETE soft-deletes', async () => {
    const res = await DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), context)
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }), { merge: true })
  })
})
