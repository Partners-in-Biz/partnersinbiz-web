// __tests__/lib/ads/offline-conversions/store.test.ts

import { createBatch, getBatch, listBatches, updateBatchStatus, upsertRow, listRows } from '@/lib/ads/offline-conversions/store'

// ─── In-memory Firestore mock ─────────────────────────────────────────────────

type DocData = Record<string, unknown>
const docs = new Map<string, DocData>()

let mockTimestampSeconds = 1000

function makePath(parts: string[]) {
  return parts.join('/')
}

function makeDoc(path: string) {
  return {
    id: path.split('/').pop()!,
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
    }),
    set: async (data: DocData, options?: { merge?: boolean }) => {
      if (options?.merge) {
        const cur = docs.get(path) ?? {}
        docs.set(path, { ...cur, ...data })
      } else {
        docs.set(path, { ...data })
      }
    },
    update: async (patch: DocData) => {
      const cur = docs.get(path) ?? {}
      // Handle FieldValue.increment
      const merged: DocData = { ...cur }
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && '__increment__' in v) {
          merged[k] = ((cur[k] as number) ?? 0) + (v as { __increment__: number }).__increment__
        } else {
          merged[k] = v
        }
      }
      docs.set(path, merged)
    },
    collection: (sub: string) => makeCollection(`${path}/${sub}`),
  }
}

function makeCollection(basePath: string) {
  return {
    doc: (id?: string) => {
      const docId = id ?? `auto-${Math.random().toString(36).slice(2)}`
      return makeDoc(`${basePath}/${docId}`)
    },
    where: (field: string, _op: string, value: unknown) => ({
      get: async () => ({
        docs: Array.from(docs.entries())
          .filter(([k, data]) => k.startsWith(`${basePath}/`) && !k.slice(basePath.length + 1).includes('/') && data[field] === value)
          .map(([, v]) => ({ data: () => v })),
      }),
      where: () => ({ get: async () => ({ docs: [] }) }), // nested where stub
    }),
    get: async () => ({
      docs: Array.from(docs.entries())
        .filter(([k]) => k.startsWith(`${basePath}/`) && !k.slice(basePath.length + 1).includes('/'))
        .map(([, v]) => ({ data: () => v })),
    }),
  }
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (path: string) => makeCollection(path),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => ({ seconds: mockTimestampSeconds, nanoseconds: 0 }),
  },
  FieldValue: {
    increment: (n: number) => ({ __increment__: n }),
  },
}))

jest.mock('crypto', () => ({
  randomBytes: () => Buffer.from('aabbccdd11223344', 'hex'),
}))

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  docs.clear()
  mockTimestampSeconds = 1000
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('offline-conversions store', () => {
  it('createBatch generates id and sets queued status', async () => {
    const batch = await createBatch({
      orgId: 'org-1',
      conversionActionId: 'action-1',
      csvPath: 'orgs/org-1/offline-conversions/test.csv',
      totalRows: 5,
      createdBy: 'user-1',
    })
    expect(batch.id).toMatch(/^ocb_/)
    expect(batch.status).toBe('queued')
    expect(batch.totalRows).toBe(5)
    expect(batch.processedRows).toBe(0)
    expect(batch.failedRows).toBe(0)
  })

  it('listBatches filters by status', async () => {
    await createBatch({ orgId: 'org-1', conversionActionId: 'a1', csvPath: 'p1.csv', totalRows: 1, createdBy: 'u1' })
    // Manually insert a completed batch
    const completedId = 'ocb_completed123'
    docs.set(`ad_offline_conversion_batches/${completedId}`, {
      id: completedId, orgId: 'org-1', conversionActionId: 'a1', csvPath: 'p2.csv',
      status: 'completed', totalRows: 2, processedRows: 2, failedRows: 0,
      createdBy: 'u1', createdAt: { seconds: 999, nanoseconds: 0 }, updatedAt: { seconds: 999, nanoseconds: 0 },
    })

    const queued = await listBatches({ orgId: 'org-1', status: 'queued' })
    expect(queued.every((b) => b.status === 'queued')).toBe(true)

    const completed = await listBatches({ orgId: 'org-1', status: 'completed' })
    expect(completed.every((b) => b.status === 'completed')).toBe(true)
  })

  it('listBatches sorts by createdAt desc', async () => {
    // Insert two batches with different timestamps
    docs.set('ad_offline_conversion_batches/ocb_older', {
      id: 'ocb_older', orgId: 'org-1', status: 'queued',
      createdAt: { seconds: 100, nanoseconds: 0 }, updatedAt: { seconds: 100, nanoseconds: 0 },
      totalRows: 1, processedRows: 0, failedRows: 0, conversionActionId: 'a1', csvPath: 'p.csv', createdBy: 'u1',
    })
    docs.set('ad_offline_conversion_batches/ocb_newer', {
      id: 'ocb_newer', orgId: 'org-1', status: 'queued',
      createdAt: { seconds: 200, nanoseconds: 0 }, updatedAt: { seconds: 200, nanoseconds: 0 },
      totalRows: 1, processedRows: 0, failedRows: 0, conversionActionId: 'a1', csvPath: 'p.csv', createdBy: 'u1',
    })
    const batches = await listBatches({ orgId: 'org-1' })
    expect(batches[0].id).toBe('ocb_newer')
    expect(batches[1].id).toBe('ocb_older')
  })

  it('updateBatchStatus increments counters and sets completedAt on terminal status', async () => {
    const batch = await createBatch({ orgId: 'org-1', conversionActionId: 'a1', csvPath: 'p.csv', totalRows: 10, createdBy: 'u1' })
    mockTimestampSeconds = 2000

    await updateBatchStatus({ batchId: batch.id, status: 'completed', processedDelta: 10, failedDelta: 0 })

    const stored = docs.get(`ad_offline_conversion_batches/${batch.id}`)!
    expect(stored.status).toBe('completed')
    expect(stored.processedRows).toBe(10)
    expect((stored.completedAt as { seconds: number }).seconds).toBe(2000)
  })

  it('upsertRow uses eventId as doc id', async () => {
    const batchId = 'ocb_test123'
    docs.set(`ad_offline_conversion_batches/${batchId}`, { id: batchId })

    await upsertRow({
      batchId,
      row: {
        eventId: 'evt-abc',
        eventTimeIso: '2024-01-01T00:00:00Z',
        email: 'a@b.com',
        status: 'sent',
      },
    })

    const docPath = `ad_offline_conversion_batches/${batchId}/rows/evt-abc`
    expect(docs.has(docPath)).toBe(true)
    const stored = docs.get(docPath)!
    expect(stored.id).toBe('evt-abc')
    expect(stored.batchId).toBe(batchId)
  })

  it('listRows filters by status', async () => {
    const batchId = 'ocb_filter123'
    docs.set(`ad_offline_conversion_batches/${batchId}`, { id: batchId })

    // Insert rows directly
    docs.set(`ad_offline_conversion_batches/${batchId}/rows/evt-sent`, {
      id: 'evt-sent', batchId, eventId: 'evt-sent', eventTimeIso: '2024-01-01T00:00:00Z', status: 'sent',
    })
    docs.set(`ad_offline_conversion_batches/${batchId}/rows/evt-failed`, {
      id: 'evt-failed', batchId, eventId: 'evt-failed', eventTimeIso: '2024-01-01T00:00:00Z', status: 'failed',
    })

    const failedRows = await listRows({ batchId, status: 'failed' })
    expect(failedRows).toHaveLength(1)
    expect(failedRows[0].eventId).toBe('evt-failed')
  })
})
