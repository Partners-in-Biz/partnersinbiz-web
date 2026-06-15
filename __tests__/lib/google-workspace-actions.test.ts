const mockBuildGoogleWorkspaceClients = jest.fn()
const mockDriveList = jest.fn()

jest.mock('@/lib/google-workspace/client', () => ({
  buildGoogleWorkspaceClients: mockBuildGoogleWorkspaceClients,
}))

describe('Google Workspace Drive actions', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockDriveList.mockResolvedValue({ data: { files: [], nextPageToken: undefined } })
    mockBuildGoogleWorkspaceClients.mockResolvedValue({
      drive: {
        files: {
          list: mockDriveList,
        },
      },
    })
  })

  it('does not sort full-text Drive searches because Google rejects orderBy with fullText', async () => {
    const { searchDriveFiles } = await import('@/lib/google-workspace/actions')

    await searchDriveFiles({ query: 'partners-in-biz-system', folderId: 'folder-1', pageSize: 5 })

    expect(mockDriveList).toHaveBeenCalledWith(expect.objectContaining({
      q: expect.stringContaining("fullText contains 'partners-in-biz-system'"),
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }))
    expect(mockDriveList.mock.calls[0][0]).not.toHaveProperty('orderBy')
  })

  it('keeps deterministic folder/name ordering for ordinary Drive folder lists', async () => {
    const { listDriveFiles } = await import('@/lib/google-workspace/actions')

    await listDriveFiles({ folderId: 'folder-1', pageSize: 10 })

    expect(mockDriveList).toHaveBeenCalledWith(expect.objectContaining({
      q: "trashed = false and 'folder-1' in parents and mimeType != 'application/vnd.google-apps.folder'",
      pageSize: 10,
      orderBy: 'folder,name',
    }))
  })
})
