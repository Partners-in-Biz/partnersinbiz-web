import { NextRequest } from 'next/server'

const createCanvas = jest.fn()
const createCanvasAtId = jest.fn()
const getCanvas = jest.fn()
const validateOrigin = jest.fn()
const claimOrigin = jest.fn()
const completeOrigin = jest.fn()
const releaseOrigin = jest.fn()
const origin = { conversationId: 'conv-1', requestMessageId: 'req-1', responseMessageId: 'res-1', bundleId: 'bundle-1', sequence: 0 }

jest.mock('@/lib/api/auth', () => ({ withAuth: (_role: string, handler: any) => (req: NextRequest) => handler(req, { uid: 'user-1', role: 'admin', orgId: 'org-1', orgIds: ['org-1'] }) }))
jest.mock('@/lib/creative-canvas/store', () => ({ createCreativeCanvas: (...args: unknown[]) => createCanvas(...args), createCreativeCanvasAtId: (...args: unknown[]) => createCanvasAtId(...args), getCreativeCanvas: (...args: unknown[]) => getCanvas(...args), listCreativeCanvases: jest.fn() }))
jest.mock('@/lib/conversations/conversations', () => ({ getConversation: jest.fn(async () => ({ id: 'conv-1' })), messagesCollection: jest.fn(() => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }) })) }))
jest.mock('@/lib/chat-context/originStore', () => ({
  StudioArtifactOriginError: class extends Error { constructor(message: string, public status = 400) { super(message) } },
  validateStudioArtifactOrigin: (...args: unknown[]) => validateOrigin(...args),
  claimStudioArtifactOrigin: (...args: unknown[]) => claimOrigin(...args),
  completeStudioArtifactOrigin: (...args: unknown[]) => completeOrigin(...args),
  releaseStudioArtifactOrigin: (...args: unknown[]) => releaseOrigin(...args),
}))

describe('Creative Canvas conversationOrigin integration', () => {
  beforeEach(() => { jest.clearAllMocks(); validateOrigin.mockResolvedValue(origin); claimOrigin.mockResolvedValue({ claimed: true }); completeOrigin.mockResolvedValue(undefined) })
  const request = () => new NextRequest('http://test/api/v1/creative-canvas?orgId=org-1', { method: 'POST', body: JSON.stringify({ title: 'Draft', conversationOrigin: origin }) })

  it('claims and completes lineage around one Canvas create', async () => {
    createCanvas.mockResolvedValue({ id: 'canvas-1' })
    const { POST } = await import('@/app/api/v1/creative-canvas/route')
    expect((await POST(request())).status).toBe(201)
    expect(claimOrigin).toHaveBeenCalledWith('marketing_studio', 'org-1', origin)
    expect(completeOrigin).toHaveBeenCalledWith('marketing_studio', 'org-1', origin, 'canvas-1', undefined)
  })

  it('replays the completed canonical Canvas without creating another', async () => {
    claimOrigin.mockResolvedValue({ claimed: false, artifactId: 'canvas-1' }); getCanvas.mockResolvedValue({ id: 'canvas-1' })
    const { POST } = await import('@/app/api/v1/creative-canvas/route')
    const body = await (await POST(request())).json()
    expect(body.data).toMatchObject({ canvas: { id: 'canvas-1' }, idempotent: true })
    expect(createCanvas).not.toHaveBeenCalled()
  })

  it('releases a claim after Canvas creation fails so retry is recoverable', async () => {
    createCanvas.mockRejectedValue(new Error('provider failed'))
    const { POST } = await import('@/app/api/v1/creative-canvas/route')
    await expect(POST(request())).rejects.toThrow('provider failed')
    expect(releaseOrigin).toHaveBeenCalledWith('marketing_studio', 'org-1', origin, undefined)
  })

  it('recovers the same Canvas when completion fails and the request is retried', async () => {
    claimOrigin.mockResolvedValueOnce({ claimed: true, artifactId: 'chat-canvas-1' }).mockResolvedValueOnce({ claimed: false, artifactId: 'chat-canvas-1' })
    createCanvasAtId.mockResolvedValue({ id: 'chat-canvas-1' })
    completeOrigin.mockRejectedValueOnce(new Error('ledger unavailable'))
    getCanvas.mockResolvedValue({ id: 'chat-canvas-1' })
    const { POST } = await import('@/app/api/v1/creative-canvas/route')

    await expect(POST(request())).rejects.toThrow('ledger unavailable')
    const replay = await POST(request())
    expect(replay.status).toBe(200)
    expect(createCanvasAtId).toHaveBeenCalledTimes(1)
    expect(createCanvas).not.toHaveBeenCalled()
  })
})
