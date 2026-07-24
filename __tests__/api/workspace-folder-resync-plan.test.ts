import { NextRequest } from 'next/server'

const mockFolderGet = jest.fn()
const mockFolderUpdate = jest.fn()
const mockRequestSet = jest.fn()
const mockLogActivity = jest.fn(async () => undefined)
let mockUser = { uid: 'admin-1', role: 'admin' as const }

type MockHandler = (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: MockHandler) => (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'server-time' } }))
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'workspace_folders') return { doc: () => ({ get: mockFolderGet, update: mockFolderUpdate }) }
      if (name === 'workspace_folder_sync_requests') return { doc: () => ({ id: 'sync-request-1', set: mockRequestSet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))
jest.mock('@/lib/api/actor', () => ({ lastActorFrom: () => ({ lastActorId: 'admin-1' }) }))
jest.mock('@/lib/api/platformAdmin', () => ({ canAccessOrg: () => true }))
jest.mock('@/lib/activity/log', () => ({ logActivity: mockLogActivity }))

const baseFolder = {
  orgId: 'org-1', name: 'Assets', deleted: false, sourceOfTruth: 'google_drive', syncMode: 'full',
  syncTargets: ['vps', 'local'], drive: { folderId: 'drive-1', folderUrl: null },
  paths: { vpsPath: '/var/lib/hermes/Cowork/partners/Acme/assets', localPathHint: '~/Cowork/partners/Acme/assets' },
  syncState: { status: 'synced', lastSyncedAt: null, lastAttemptAt: null, error: null, conflictCount: 0 },
  audit: { conflictStatus: 'none', notes: null },
}

function invoke() {
  const request = new NextRequest('http://localhost/api/v1/workspace-folders/folder-1/resync?orgId=org-1', { method: 'POST' })
  return import('@/app/api/v1/workspace-folders/[id]/resync/route')
    .then(({ POST }) => POST(request, { params: Promise.resolve({ id: 'folder-1' }) }))
}

describe('workspace folder sync plan requests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFolderGet.mockResolvedValue({ exists: true, id: 'folder-1', data: () => baseFolder })
    mockFolderUpdate.mockResolvedValue(undefined)
    mockRequestSet.mockResolvedValue(undefined)
  })

  it('persists an auditable non-destructive plan request without claiming execution', async () => {
    const response = await invoke()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockRequestSet).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder-1', orgId: 'org-1', status: 'planned',
      plan: expect.objectContaining({ destructiveDeletes: false, targets: ['vps', 'local'] }),
    }))
    expect(mockFolderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      syncState: expect.objectContaining({ status: 'pending', lastRequestId: 'sync-request-1', lastRequestStatus: 'planned' }),
    }))
    expect(body.data).toMatchObject({ queued: false, requestId: 'sync-request-1', requestStatus: 'planned' })
    expect(body.data.message).toContain('No file transfer or deletion runs')
  })

  it('blocks the request plan when conflicts are open', async () => {
    mockFolderGet.mockResolvedValue({
      exists: true,
      id: 'folder-1',
      data: () => ({
        ...baseFolder,
        syncState: { ...baseFolder.syncState, status: 'conflict', conflictCount: 2 },
        audit: { ...baseFolder.audit, conflictStatus: 'open' },
      }),
    })

    const response = await invoke()
    const body = await response.json()

    expect(mockRequestSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked_conflict' }))
    expect(mockFolderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      syncState: expect.objectContaining({ status: 'conflict', lastRequestStatus: 'blocked_conflict' }),
    }))
    expect(body.data.message).toContain('blocked by 2 open conflict(s)')
    expect(body.data.message).toContain('No files were overwritten')
  })
})
