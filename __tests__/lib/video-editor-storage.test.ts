const saveMock = jest.fn().mockResolvedValue(undefined)
const addMock = jest.fn().mockResolvedValue({ id: 'upload-1' })

jest.mock('@/lib/firebase/admin', () => ({
  getAdminApp: jest.fn(() => ({})),
  adminDb: { collection: jest.fn(() => ({ add: addMock })) },
}))
jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({
    bucket: jest.fn(() => ({ name: 'pib-bucket', file: jest.fn(() => ({ save: saveMock })) })),
  })),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'ts') },
}))

import { saveVideoEditorUpload } from '@/lib/video-editor/storage'
import type { ApiUser } from '@/lib/api/types'

const user = { uid: 'u1', role: 'admin', email: 'p@x.test' } as ApiUser

describe('saveVideoEditorUpload', () => {
  beforeEach(() => jest.clearAllMocks())

  it('saves the buffer and creates an uploads doc', async () => {
    const result = await saveVideoEditorUpload(Buffer.from('abc'), {
      orgId: 'org-1',
      folder: 'video-editor/org-1/p-1',
      filename: 'voiceover-1.wav',
      mimeType: 'audio/wav',
      user,
    })
    expect(result.id).toBe('upload-1')
    expect(result.storagePath).toBe('video-editor/org-1/p-1/voiceover-1.wav')
    expect(result.url).toContain('firebasestorage.googleapis.com')
    expect(result.url).toContain(encodeURIComponent('video-editor/org-1/p-1/voiceover-1.wav'))
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1', mimeType: 'audio/wav', deleted: false, size: 3,
    }))
  })

  it('strips unsafe filename characters', async () => {
    const result = await saveVideoEditorUpload(Buffer.from('x'), {
      orgId: 'org-1', folder: 'video-editor/org-1/p-1', filename: '../..//evil name!.wav', mimeType: 'audio/wav', user,
    })
    expect(result.storagePath).toBe('video-editor/org-1/p-1/....evilname.wav')
  })
})
