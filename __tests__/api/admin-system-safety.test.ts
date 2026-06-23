import { NextRequest } from 'next/server'

const mockIsSuperAdmin = jest.fn()
const mockWriteAdminAudit = jest.fn()
const mockGetStorage = jest.fn()

type StoredDoc = {
  exists: boolean
  data?: Record<string, unknown>
  delete?: jest.Mock<Promise<void>, []>
}

const docStore = new Map<string, StoredDoc>()
const batchSet = jest.fn()
const batchCommit = jest.fn()
const listCollections = jest.fn()

function pathKey(collection: string, docId: string) {
  return `${collection}/${docId}`
}

function primeDoc(collection: string, docId: string, data?: Record<string, unknown>, overrides: Partial<StoredDoc> = {}) {
  docStore.set(pathKey(collection, docId), {
    exists: data !== undefined,
    data,
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  })
}

function resetDocStore() {
  docStore.clear()
}

const adminDb = {
  collection: jest.fn((collectionName: string) => ({
    doc: jest.fn((docId: string) => {
      const entry = docStore.get(pathKey(collectionName, docId))
      return {
        id: docId,
        path: pathKey(collectionName, docId),
        get: jest.fn(async () => ({
          exists: entry?.exists ?? false,
          id: docId,
          data: () => entry?.data,
        })),
        delete: entry?.delete ?? jest.fn().mockResolvedValue(undefined),
      }
    }),
  })),
  batch: jest.fn(() => ({
    set: batchSet,
    commit: batchCommit,
  })),
  listCollections,
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: unknown) => handler,
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  isSuperAdmin: (...args: unknown[]) => mockIsSuperAdmin(...args),
}))

jest.mock('@/lib/admin/audit', () => ({
  writeAdminAudit: (...args: unknown[]) => mockWriteAdminAudit(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb,
  getAdminApp: jest.fn(() => ({})),
}))

jest.mock('firebase-admin/storage', () => ({
  getStorage: (...args: unknown[]) => mockGetStorage(...args),
}))

function makeJsonRequest(url: string, method: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const adminUser = { uid: 'admin-1', role: 'admin', email: 'admin@example.com' }

describe('admin system safety routes', () => {
  beforeEach(() => {
    resetDocStore()
    jest.clearAllMocks()
    mockIsSuperAdmin.mockReturnValue(true)
    mockWriteAdminAudit.mockResolvedValue(undefined)
    batchCommit.mockResolvedValue(undefined)
    listCollections.mockResolvedValue([
      { id: 'contacts' },
      { id: 'admin_audit_log' },
    ])
  })

  describe('backup restore', () => {
    it('rejects restore when payload.meta.orgId does not match the backup org and audits the rejection', async () => {
      primeDoc('org_backups', 'backup-1', {
        orgId: 'org-live',
        storageFallback: true,
      })
      primeDoc('backup_blobs', 'backup-1', {
        json: JSON.stringify({
          meta: { orgId: 'org-other' },
          collections: { contacts: [{ id: 'contact-1', orgId: 'org-other' }] },
        }),
      })

      const { POST } = await import('@/app/api/v1/admin/system/backups/[id]/restore/route')
      const res = await POST(
        makeJsonRequest('http://localhost/api/v1/admin/system/backups/backup-1/restore', 'POST', {
          confirm: 'RESTORE backup-1 org-live',
        }),
        adminUser,
        { params: Promise.resolve({ id: 'backup-1' }) },
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/orgId/i) })
      expect(batchSet).not.toHaveBeenCalled()
      expect(mockWriteAdminAudit).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'system.backup.restore',
          orgId: 'org-live',
          summary: expect.stringMatching(/rejected/i),
          metadata: expect.objectContaining({
            outcome: 'rejected',
            reason: 'org_mismatch',
            backupId: 'backup-1',
          }),
        }),
      )
    })

    it('rejects restore payloads containing collections outside BACKUP_COLLECTIONS', async () => {
      primeDoc('org_backups', 'backup-2', {
        orgId: 'org-live',
        storageFallback: true,
      })
      primeDoc('backup_blobs', 'backup-2', {
        json: JSON.stringify({
          meta: { orgId: 'org-live' },
          collections: {
            contacts: [{ id: 'contact-1', orgId: 'org-live' }],
            secrets: [{ id: 'secret-1', orgId: 'org-live' }],
          },
        }),
      })

      const { POST } = await import('@/app/api/v1/admin/system/backups/[id]/restore/route')
      const res = await POST(
        makeJsonRequest('http://localhost/api/v1/admin/system/backups/backup-2/restore', 'POST', {
          confirm: 'RESTORE backup-2 org-live',
        }),
        adminUser,
        { params: Promise.resolve({ id: 'backup-2' }) },
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/collection/i) })
      expect(batchCommit).not.toHaveBeenCalled()
      expect(mockWriteAdminAudit).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'system.backup.restore',
          metadata: expect.objectContaining({
            outcome: 'rejected',
            reason: 'disallowed_collections',
            disallowedCollections: ['secrets'],
          }),
        }),
      )
    })
  })

  describe('database delete', () => {
    it('requires a strong confirmation phrase before deleting documents', async () => {
      primeDoc('contacts', 'contact-1', { orgId: 'org-live', name: 'Ada' })

      const { DELETE } = await import('@/app/api/v1/admin/system/database/[collection]/[docId]/route')
      const res = await DELETE(
        new NextRequest('http://localhost/api/v1/admin/system/database/contacts/contact-1?confirm=contacts%2Fcontact-1', {
          method: 'DELETE',
        }),
        adminUser,
        { params: Promise.resolve({ collection: 'contacts', docId: 'contact-1' }) },
      )

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/confirm/i) })
      expect(docStore.get('contacts/contact-1')?.delete).not.toHaveBeenCalled()
      expect(mockWriteAdminAudit).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'system.database.delete',
          metadata: expect.objectContaining({
            outcome: 'rejected',
            reason: 'confirmation_mismatch',
          }),
        }),
      )
    })

    it('blocks deletes for restricted collections and audits the attempt', async () => {
      primeDoc('admin_audit_log', 'audit-1', { action: 'system.test' })

      const { DELETE } = await import('@/app/api/v1/admin/system/database/[collection]/[docId]/route')
      const res = await DELETE(
        new NextRequest('http://localhost/api/v1/admin/system/database/admin_audit_log/audit-1?confirm=DELETE%20admin_audit_log%2Faudit-1', {
          method: 'DELETE',
        }),
        adminUser,
        { params: Promise.resolve({ collection: 'admin_audit_log', docId: 'audit-1' }) },
      )

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/restricted/i) })
      expect(docStore.get('admin_audit_log/audit-1')?.delete).not.toHaveBeenCalled()
      expect(mockWriteAdminAudit).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'system.database.delete',
          metadata: expect.objectContaining({
            outcome: 'rejected',
            reason: 'restricted_collection',
            collection: 'admin_audit_log',
          }),
        }),
      )
    })
  })

  describe('storage orphan delete', () => {
    it('quarantines orphaned files by default and audits the mutation', async () => {
      const copy = jest.fn().mockResolvedValue(undefined)
      const del = jest.fn().mockResolvedValue(undefined)
      const file = jest.fn((path: string) => ({
        name: path,
        copy,
        delete: del,
      }))
      mockGetStorage.mockReturnValue({ bucket: () => ({ file }) })

      const { DELETE } = await import('@/app/api/v1/admin/system/storage/orphans/route')
      const res = await DELETE(
        makeJsonRequest('http://localhost/api/v1/admin/system/storage/orphans', 'DELETE', {
          path: 'uploads/org-live/orphan.pdf',
          confirm: 'uploads/org-live/orphan.pdf',
        }),
        adminUser,
      )

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({
        success: true,
        data: expect.objectContaining({
          quarantined: true,
          deleted: false,
          path: 'uploads/org-live/orphan.pdf',
        }),
      })
      expect(copy).toHaveBeenCalledTimes(1)
      expect(del).toHaveBeenCalledTimes(1)
      expect(mockWriteAdminAudit).toHaveBeenCalledWith(
        adminUser,
        expect.objectContaining({
          action: 'system.storage.orphan.quarantine',
          metadata: expect.objectContaining({
            outcome: 'completed',
            path: 'uploads/org-live/orphan.pdf',
          }),
        }),
      )
    })
  })
})
