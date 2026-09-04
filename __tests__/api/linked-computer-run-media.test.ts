/**
 * @jest-environment node
 */

const authenticateSignedDeviceRequest = jest.fn()
const storeConversationAttachment = jest.fn()
const getConversation = jest.fn()
const jobGet = jest.fn()
const jobUpdate = jest.fn()

jest.mock('@/lib/linked-computers/http', () => ({
  authenticateSignedDeviceRequest: (...args: unknown[]) => authenticateSignedDeviceRequest(...args),
  lifecycleError: (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    const status = /not found/.test(message) ? 404 : /authentication|signature|credential|tenant/.test(message) ? 403 : 400
    return new Response(JSON.stringify({
      success: false,
      error: status === 403 ? 'Linked computer access denied' : 'Linked computer request invalid',
    }), { status })
  },
  noStoreHeaders: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
}))

jest.mock('@/lib/conversations/attachments-store', () => {
  const actual = jest.requireActual('@/lib/conversations/attachments-store') as typeof import('@/lib/conversations/attachments-store')
  return {
    ...actual,
    storeConversationAttachment: (...args: unknown[]) => storeConversationAttachment(...args),
  }
})

jest.mock('@/lib/conversations/conversations', () => ({
  getConversation: (...args: unknown[]) => getConversation(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: () => jobGet(),
        update: (...args: unknown[]) => jobUpdate(...args),
      }),
    }),
    runTransaction: async (fn: (tx: { get: typeof jobGet; update: typeof jobUpdate }) => Promise<unknown>) =>
      fn({ get: jobGet, update: jobUpdate }),
  },
}))

import { NextRequest } from 'next/server'
import { handleLinkedRunMedia } from '@/app/api/v1/linked-computers/[deviceId]/runs/[jobId]/media/route'

function mediaRequest(body: Record<string, unknown>) {
  return new NextRequest('https://test/api/v1/linked-computers/device-a/runs/job-a/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('signed linked computer run media', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authenticateSignedDeviceRequest.mockResolvedValue({
      deviceId: 'device-a',
      ownerUserId: 'user-a',
      credentialVersion: 1,
    })
    storeConversationAttachment.mockResolvedValue({
      id: 'att-1',
      name: 'chart.png',
      url: '/api/v1/conversations/conv-1/attachments/abc',
      contentType: 'image/png',
      sizeBytes: 4,
      storagePath: 'conversation-attachments/org-1/conv-1/abc.png',
    })
    getConversation.mockResolvedValue({ id: 'conv-1', orgId: 'org-1' })
    jobGet.mockResolvedValue({
      exists: true,
      data: () => ({
        deviceId: 'device-a',
        orgId: 'org-1',
        conversationId: 'conv-1',
        mediaUploadCount: 0,
      }),
    })
  })

  it('rejects an unlisted MIME type', async () => {
    const response = await handleLinkedRunMedia(
      mediaRequest({
        filename: 'payload.svg',
        contentType: 'image/svg+xml',
        bytesBase64: Buffer.from('<svg></svg>').toString('base64'),
      }),
      'device-a',
      'job-a',
    )
    expect(response.status).toBe(400)
    const json = await response.json() as { success: boolean; error: string }
    expect(json.success).toBe(false)
    expect(json.error).toBe('Unsupported file type')
    expect(storeConversationAttachment).not.toHaveBeenCalled()
    expect(authenticateSignedDeviceRequest).toHaveBeenCalled()
  })

  it('stores a PNG and returns the conversation attachment URL', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const response = await handleLinkedRunMedia(
      mediaRequest({
        filename: 'chart.png',
        contentType: 'image/png',
        bytesBase64: pngBytes.toString('base64'),
      }),
      'device-a',
      'job-a',
    )
    expect(response.status).toBe(200)
    const json = await response.json() as { success: boolean; data: { url: string } }
    expect(json).toEqual({
      success: true,
      data: { url: '/api/v1/conversations/conv-1/attachments/abc' },
    })
    expect(storeConversationAttachment).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      conversationId: 'conv-1',
      filename: 'chart.png',
      contentType: 'image/png',
      actor: { createdBy: 'user-a', createdByType: 'system' },
    }))
    const stored = storeConversationAttachment.mock.calls[0][0] as { bytes: Buffer }
    expect(Buffer.isBuffer(stored.bytes)).toBe(true)
    expect(stored.bytes.equals(pngBytes)).toBe(true)
    expect(jobUpdate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mediaUploadCount: 1,
    }))
    expect(authenticateSignedDeviceRequest).toHaveBeenCalled()
  })
})
