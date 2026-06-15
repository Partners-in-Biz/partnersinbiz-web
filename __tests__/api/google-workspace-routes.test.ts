import { NextRequest } from 'next/server'

type MockUser = {
  uid: string
  role: 'admin' | 'client' | 'ai'
  orgId?: string
  orgIds?: string[]
  allowedOrgIds?: string[]
}
type MockHandler = (req: NextRequest, user: MockUser, ctx?: unknown) => Promise<Response>

let mockUser: MockUser = { uid: 'admin-1', role: 'admin' }
const mockListDriveFiles = jest.fn()
const mockSearchDriveFiles = jest.fn()
const mockUploadDriveFile = jest.fn()
const mockDownloadDriveFile = jest.fn()
const mockShareDriveFile = jest.fn()
const mockCreateGoogleDoc = jest.fn()
const mockAppendSheetValues = jest.fn()
const mockReadSheetValues = jest.fn()

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => async (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

jest.mock('@/lib/google-workspace/actions', () => ({
  listDriveFiles: mockListDriveFiles,
  searchDriveFiles: mockSearchDriveFiles,
  uploadDriveFile: mockUploadDriveFile,
  downloadDriveFile: mockDownloadDriveFile,
  shareDriveFile: mockShareDriveFile,
  createGoogleDoc: mockCreateGoogleDoc,
  appendSheetValues: mockAppendSheetValues,
  readSheetValues: mockReadSheetValues,
}), { virtual: true })

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  mockUser = { uid: 'admin-1', role: 'admin' }
})

describe('Google Workspace proxy routes', () => {
  it('lists Drive files only after PiB org access is established', async () => {
    mockListDriveFiles.mockResolvedValue({ files: [{ id: 'file-1', name: 'Plan' }], nextPageToken: 'next-page' })
    const { GET } = await import('@/app/api/v1/google/drive/list/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/google/drive/list?orgId=org-1&folderId=folder-1&pageSize=10'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual({ files: [{ id: 'file-1', name: 'Plan' }], nextPageToken: 'next-page' })
    expect(mockListDriveFiles).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'folder-1', pageSize: 10 }))

    mockUser = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-allowed'] }
    const forbidden = await GET(new NextRequest('http://localhost/api/v1/google/drive/list?orgId=org-denied&folderId=folder-1'))

    expect(forbidden.status).toBe(403)
    expect(mockListDriveFiles).toHaveBeenCalledTimes(1)
  })

  it('uploads JSON file content into an explicit Drive folder', async () => {
    mockUploadDriveFile.mockResolvedValue({ id: 'file-2', name: 'hello.txt', mimeType: 'text/plain' })
    const { POST } = await import('@/app/api/v1/google/drive/upload/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/google/drive/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', folderId: 'folder-1', name: 'hello.txt', mimeType: 'text/plain', content: 'hello' }),
    }))

    expect(res.status).toBe(201)
    expect(mockUploadDriveFile).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder-1',
      name: 'hello.txt',
      mimeType: 'text/plain',
      content: Buffer.from('hello'),
    }))
  })

  it('downloads Drive file bytes through the proxy response', async () => {
    mockDownloadDriveFile.mockResolvedValue({ name: 'hello.txt', mimeType: 'text/plain', content: Buffer.from('hello') })
    const { GET } = await import('@/app/api/v1/google/drive/download/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/google/drive/download?orgId=org-1&fileId=file-1'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('content-disposition')).toContain('hello.txt')
    expect(await res.text()).toBe('hello')
    expect(mockDownloadDriveFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1' }))
  })

  it('shares Drive files with explicit users but rejects broad public sharing', async () => {
    mockShareDriveFile.mockResolvedValue({ id: 'permission-1', role: 'writer', type: 'user' })
    const { POST } = await import('@/app/api/v1/google/drive/share/route')

    const ok = await POST(new NextRequest('http://localhost/api/v1/google/drive/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', fileId: 'file-1', emailAddress: 'client@example.com', role: 'writer' }),
    }))
    const blocked = await POST(new NextRequest('http://localhost/api/v1/google/drive/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', fileId: 'file-1', type: 'anyone', role: 'reader' }),
    }))

    expect(ok.status).toBe(200)
    expect(blocked.status).toBe(400)
    expect(mockShareDriveFile).toHaveBeenCalledTimes(1)
    expect(mockShareDriveFile).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1', emailAddress: 'client@example.com', role: 'writer' }))
  })

  it('searches Drive with a query and optional folder scope', async () => {
    mockSearchDriveFiles.mockResolvedValue({ files: [{ id: 'file-3', name: 'Client Plan' }] })
    const { GET } = await import('@/app/api/v1/google/drive/search/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/google/drive/search?orgId=org-1&q=client%20plan&folderId=folder-1'))

    expect(res.status).toBe(200)
    expect(mockSearchDriveFiles).toHaveBeenCalledWith(expect.objectContaining({ query: 'client plan', folderId: 'folder-1' }))
  })

  it('creates Docs with optional body content and folder placement', async () => {
    mockCreateGoogleDoc.mockResolvedValue({ documentId: 'doc-1', title: 'Runbook' })
    const { POST } = await import('@/app/api/v1/google/docs/create/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/google/docs/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', folderId: 'folder-1', title: 'Runbook', content: 'Initial notes' }),
    }))

    expect(res.status).toBe(201)
    expect(mockCreateGoogleDoc).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'folder-1', title: 'Runbook', content: 'Initial notes' }))
  })

  it('appends to and reads from Sheets ranges', async () => {
    mockAppendSheetValues.mockResolvedValue({ spreadsheetId: 'sheet-1', updatedRows: 1 })
    mockReadSheetValues.mockResolvedValue({ spreadsheetId: 'sheet-1', range: 'Sheet1!A:B', values: [['Name']] })
    const { POST: append } = await import('@/app/api/v1/google/sheets/append/route')
    const { GET: read } = await import('@/app/api/v1/google/sheets/read/route')

    const appendRes = await append(new NextRequest('http://localhost/api/v1/google/sheets/append', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', spreadsheetId: 'sheet-1', range: 'Sheet1!A:B', values: [['Name']] }),
    }))
    const readRes = await read(new NextRequest('http://localhost/api/v1/google/sheets/read?orgId=org-1&spreadsheetId=sheet-1&range=Sheet1!A:B'))

    expect(appendRes.status).toBe(200)
    expect(readRes.status).toBe(200)
    expect(mockAppendSheetValues).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: 'sheet-1', range: 'Sheet1!A:B', values: [['Name']] }))
    expect(mockReadSheetValues).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: 'sheet-1', range: 'Sheet1!A:B' }))
  })
})
