import { NextRequest } from 'next/server'

const mockGet = jest.fn()
const mockSet = jest.fn()
const mockPreferenceDoc = jest.fn(() => ({ get: mockGet, set: mockSet }))
const mockPreferenceCollection = jest.fn(() => ({ doc: mockPreferenceDoc }))
const mockUserDoc = jest.fn(() => ({ collection: mockPreferenceCollection }))
const mockUsersCollection = jest.fn(() => ({ doc: mockUserDoc }))
const mockCollection = jest.fn((name: string) => {
  if (name === 'users') return mockUsersCollection()
  throw new Error(`Unexpected collection: ${name}`)
})

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: Function) => async (req: NextRequest) => handler(req, {
    uid: 'user-1', role: 'client', orgId: 'org-1', authKind: 'firebase',
  }),
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}))

import { GET, POST } from '@/app/api/v1/account/messages-sidebar-preferences/route'

describe('Messages sidebar folder preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({ exists: true, data: () => ({
      hiddenFolderKeys: ['workspace:acme', 'agent:theo', 'project:not-allowed', 'agent:theo'],
    }) })
    mockSet.mockResolvedValue(undefined)
  })

  it('reads only durable workspace and agent folder keys for the current user and org', async () => {
    const response = await GET(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { hiddenFolderKeys: ['workspace:acme', 'agent:theo'] },
    })
    expect(mockUserDoc).toHaveBeenCalledWith('user-1')
    expect(mockPreferenceCollection).toHaveBeenCalledWith('messagesSidebarPreferences')
    expect(mockPreferenceDoc).toHaveBeenCalledWith('org-1')
  })

  it('validates, deduplicates, and persists the complete hidden-folder preference', async () => {
    const response = await POST(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hiddenFolderKeys: ['agent:theo', 'workspace:acme', 'agent:theo'] }),
    }))
    expect(response.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'user-1',
      hiddenFolderKeys: ['agent:theo', 'workspace:acme'],
      updatedAt: 'SERVER_TIMESTAMP',
    }, { merge: true })
  })

  it('rejects a client preference request for another organisation', async () => {
    const response = await GET(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-2'))
    expect(response.status).toBe(403)
    expect(mockPreferenceDoc).not.toHaveBeenCalled()
  })

  it('reads the pinned bot alongside hidden folders and drops malformed ids', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ hiddenFolderKeys: [], pinnedBotId: 'theo' }) })
    let response = await GET(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1'))
    await expect(response.json()).resolves.toMatchObject({ data: { hiddenFolderKeys: [], pinnedBotId: 'theo' } })

    mockGet.mockResolvedValue({ exists: true, data: () => ({ pinnedBotId: 'not valid!' }) })
    response = await GET(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1'))
    await expect(response.json()).resolves.toMatchObject({ data: { pinnedBotId: null } })
  })

  it('persists a pinned bot per user and org without touching hidden folders', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ hiddenFolderKeys: ['agent:theo'], pinnedBotId: 'maya' }) })
    const response = await POST(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinnedBotId: 'maya' }),
    }))
    expect(response.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'user-1',
      pinnedBotId: 'maya',
      updatedAt: 'SERVER_TIMESTAMP',
    }, { merge: true })
    expect(mockPreferenceDoc).toHaveBeenCalledWith('org-1')
    await expect(response.json()).resolves.toMatchObject({ data: { hiddenFolderKeys: ['agent:theo'], pinnedBotId: 'maya' } })
  })

  it('unpins with null and rejects malformed pinned bot ids', async () => {
    let response = await POST(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinnedBotId: null }),
    }))
    expect(response.status).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ pinnedBotId: null }), { merge: true })

    mockSet.mockClear()
    response = await POST(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinnedBotId: 'agent id with spaces' }),
    }))
    expect(response.status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects unsupported folder kinds instead of hiding projects or Cowork folders', async () => {
    const response = await POST(new NextRequest('https://example.test/api/v1/account/messages-sidebar-preferences?orgId=org-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hiddenFolderKeys: ['company:acme'] }),
    }))
    expect(response.status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })
})
