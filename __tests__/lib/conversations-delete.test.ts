const mockCollection = jest.fn()
const mockBatch = jest.fn()
const mockGetAdminApp = jest.fn(() => ({}))
const mockStorageDelete = jest.fn()
const mockStorageFile = jest.fn()
const mockStorageBucket = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
    batch: mockBatch,
  },
  getAdminApp: mockGetAdminApp,
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: jest.fn(() => ({
    bucket: mockStorageBucket,
  })),
}))

describe('deleteConversation', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockStorageDelete.mockResolvedValue(undefined)
    mockStorageFile.mockReturnValue({ delete: mockStorageDelete })
    mockStorageBucket.mockReturnValue({ file: mockStorageFile })
  })

  it('deletes conversation attachment metadata and storage blobs when deleting a conversation', async () => {
    const attachmentRef = { path: 'conversation_attachments/att-1' }
    const messageRef = { path: 'conversations/conv-1/messages/msg-1' }
    const conversationDelete = jest.fn().mockResolvedValue(undefined)
    const attachmentGet = jest.fn()
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            ref: attachmentRef,
            data: () => ({
              storagePath: 'conversation-attachments/org-1/conv-1/metadata-file.png',
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ empty: true, docs: [] })
    const messagesGet = jest.fn()
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            ref: messageRef,
            data: () => ({
              attachments: [
                {
                  storagePath: 'conversation-attachments/org-1/conv-1/message-file.pdf',
                },
              ],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ empty: true, docs: [] })
    const batchDelete = jest.fn()
    const batchCommit = jest.fn().mockResolvedValue(undefined)
    mockBatch.mockImplementation(() => ({
      delete: batchDelete,
      commit: batchCommit,
    }))
    mockCollection.mockImplementation((name: string) => {
      if (name === 'conversation_attachments') {
        return {
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ get: attachmentGet })),
          })),
        }
      }
      if (name === 'conversations') {
        return {
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({
              limit: jest.fn(() => ({ get: messagesGet })),
            })),
            delete: conversationDelete,
          })),
        }
      }
      throw new Error(`Unexpected collection ${name}`)
    })

    const { deleteConversation } = await import('@/lib/conversations/conversations')
    await deleteConversation('conv-1')

    expect(mockStorageFile).toHaveBeenCalledWith('conversation-attachments/org-1/conv-1/metadata-file.png')
    expect(mockStorageFile).toHaveBeenCalledWith('conversation-attachments/org-1/conv-1/message-file.pdf')
    expect(mockStorageDelete).toHaveBeenCalledWith({ ignoreNotFound: true })
    expect(batchDelete).toHaveBeenCalledWith(attachmentRef)
    expect(batchDelete).toHaveBeenCalledWith(messageRef)
    expect(conversationDelete).toHaveBeenCalled()
  })
})
