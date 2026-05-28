import {
  runWithFirestoreReadAudit,
  wrapFirestoreReadTarget,
} from '@/lib/firebase/read-audit'

describe('Firestore read audit', () => {
  const originalEnv = process.env.FIRESTORE_READ_AUDIT
  const originalThreshold = process.env.FIRESTORE_READ_AUDIT_MIN_READS
  const originalConsoleInfo = console.info

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.FIRESTORE_READ_AUDIT = '1'
    process.env.FIRESTORE_READ_AUDIT_MIN_READS = '1'
    console.info = jest.fn()
  })

  afterEach(() => {
    process.env.FIRESTORE_READ_AUDIT = originalEnv
    process.env.FIRESTORE_READ_AUDIT_MIN_READS = originalThreshold
    console.info = originalConsoleInfo
  })

  it('logs one scoped summary for Firestore query reads', async () => {
    const query = {
      where: jest.fn(function () { return this }),
      limit: jest.fn(function () { return this }),
      get: jest.fn(async () => ({
        docs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      })),
    }
    const db = {
      collection: jest.fn(() => query),
    }
    const auditedDb = wrapFirestoreReadTarget(db, { target: 'firestore' })

    const result = await runWithFirestoreReadAudit('api/cron/social', async () => {
      return auditedDb
        .collection('social_posts')
        .where('status', '==', 'scheduled')
        .limit(25)
        .get()
    })

    expect(result.docs).toHaveLength(3)
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledWith('[firestore-read-audit]', expect.objectContaining({
      scope: 'api/cron/social',
      totalReadEstimate: 3,
      operationCount: 1,
      topTargets: [expect.objectContaining({
        target: 'firestore/social_posts',
        readEstimate: 3,
      })],
    }))
  })

  it('counts empty query snapshots as one minimum billable read estimate', async () => {
    const query = {
      get: jest.fn(async () => ({
        docs: [],
        empty: true,
      })),
    }
    const db = {
      collectionGroup: jest.fn(() => query),
    }
    const auditedDb = wrapFirestoreReadTarget(db, { target: 'firestore' })

    await runWithFirestoreReadAudit('agent-watcher/sweep-ready', async () => {
      return auditedDb.collectionGroup('tasks').get()
    })

    expect(console.info).toHaveBeenCalledWith('[firestore-read-audit]', expect.objectContaining({
      scope: 'agent-watcher/sweep-ready',
      totalReadEstimate: 1,
      topTargets: [expect.objectContaining({
        target: 'firestore/**/tasks',
        readEstimate: 1,
      })],
    }))
  })

  it('counts getAll document batch reads', async () => {
    const db = {
      getAll: jest.fn(async () => [
        { exists: true, id: 'org-1' },
        { exists: false, id: 'org-2' },
      ]),
    }
    const auditedDb = wrapFirestoreReadTarget(db, { target: 'firestore' })

    await runWithFirestoreReadAudit('api/v1/search', async () => {
      return auditedDb.getAll({ path: 'organizations/org-1' }, { path: 'organizations/org-2' })
    })

    expect(console.info).toHaveBeenCalledWith('[firestore-read-audit]', expect.objectContaining({
      scope: 'api/v1/search',
      totalReadEstimate: 2,
      topTargets: [expect.objectContaining({
        target: 'firestore',
        operation: 'getAll',
        readEstimate: 2,
      })],
    }))
  })

  it('does not log when audit is disabled', async () => {
    process.env.FIRESTORE_READ_AUDIT = '0'
    const docRef = {
      get: jest.fn(async () => ({
        exists: true,
        id: 'contact-1',
      })),
    }
    const db = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => docRef),
      })),
    }
    const auditedDb = wrapFirestoreReadTarget(db, { target: 'firestore' })

    await runWithFirestoreReadAudit('api/test', async () => {
      return auditedDb.collection('contacts').doc('contact-1').get()
    })

    expect(console.info).not.toHaveBeenCalled()
  })
})
