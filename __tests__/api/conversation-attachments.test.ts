import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

const mockCollection = jest.fn()
const mockGetConversation = jest.fn()
const mockSave = jest.fn()
const mockFile = jest.fn()
const mockBucket = jest.fn()

let mockUser: MockUser = { uid: 'client-1', role: 'client' }

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
  getAdminApp: jest.fn(() => ({})),
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) =>
    handler(req, mockUser, ctx),
}))

jest.mock('@/lib/api/actor', () => ({
  actorFrom: (user: MockUser) => ({ createdBy: user.uid, createdByRole: user.role }),
}))

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: mockGetConversation,
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({
    bucket: mockBucket,
  })),
}))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'client-1', role: 'client' }
  mockSave.mockResolvedValue(undefined)
  mockFile.mockReturnValue({ save: mockSave })
  mockBucket.mockReturnValue({ name: 'bucket.test', file: mockFile })
  mockCollection.mockImplementation((name: string) => {
    if (name !== 'conversation_attachments') throw new Error(`Unexpected collection: ${name}`)
    return {
      add: jest.fn().mockResolvedValue({ id: 'attachment-doc-1' }),
    }
  })
  mockGetConversation.mockResolvedValue({
    id: 'conv-1',
    orgId: 'org-1',
    participantUids: ['client-1'],
  })
})

async function uploadReq() {
  const form = new FormData()
  form.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'screenshot.png')
  return new NextRequest('http://localhost/api/v1/conversations/conv-1/attachments', {
    method: 'POST',
    body: form,
  })
}

async function readJson(res: Response) {
  return JSON.parse(await res.text())
}

describe('conversation attachment uploads', () => {
  it('stores participant image uploads in conversation-scoped Firebase Storage', async () => {
    const { POST } = await import('@/app/api/v1/conversations/[convId]/attachments/route')

    const res = await POST(await uploadReq(), { params: Promise.resolve({ convId: 'conv-1' }) })

    expect(res.status).toBe(201)
    expect(mockFile).toHaveBeenCalledWith(expect.stringMatching(/^conversation-attachments\/org-1\/conv-1\/[a-f0-9]+\.png$/))
    expect(mockSave).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      metadata: expect.objectContaining({
        contentType: 'image/png',
      }),
    }))
    const body = await readJson(res)
    expect(body.data).toEqual(expect.objectContaining({
      id: 'attachment-doc-1',
      name: 'screenshot.png',
      contentType: 'image/png',
      url: expect.stringContaining('https://firebasestorage.googleapis.com/v0/b/bucket.test/o/conversation-attachments%2Forg-1%2Fconv-1%2F'),
    }))
  })
})
