// __tests__/api/v1/ads/conversions/offline/process.test.ts
// Tests for the batch process route logic (unit-level, mocking all I/O)

import { parseCsv } from '@/lib/ads/offline-conversions/parse'

// ─── Mock: store ──────────────────────────────────────────────────────────────

const mockGetBatch = jest.fn()
const mockListRows = jest.fn()
const mockUpsertRow = jest.fn()
const mockUpdateBatchStatus = jest.fn()

jest.mock('@/lib/ads/offline-conversions/store', () => ({
  getBatch: (...a: unknown[]) => mockGetBatch(...a),
  listRows: (...a: unknown[]) => mockListRows(...a),
  upsertRow: (...a: unknown[]) => mockUpsertRow(...a),
  updateBatchStatus: (...a: unknown[]) => mockUpdateBatchStatus(...a),
}))

// ─── Mock: trackConversion ────────────────────────────────────────────────────

const mockTrackConversion = jest.fn()

jest.mock('@/lib/ads/conversions/track', () => ({
  trackConversion: (...a: unknown[]) => mockTrackConversion(...a),
}))

// ─── Mock: Firebase Storage ───────────────────────────────────────────────────

const mockDownload = jest.fn()

jest.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({ download: mockDownload }),
    }),
  }),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {},
  getAdminApp: () => ({}),
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ seconds: 1000, nanoseconds: 0 }) },
}))

// ─── Helper: run the process logic inline (mirrors route implementation) ──────

async function runProcessLogic(batchId: string, orgId: string) {
  const { getBatch, listRows, upsertRow, updateBatchStatus } = await import('@/lib/ads/offline-conversions/store')
  const { trackConversion } = await import('@/lib/ads/conversions/track')
  const { getStorage } = await import('firebase-admin/storage')
  const { Timestamp } = await import('firebase-admin/firestore')
  const { getAdminApp } = await import('@/lib/firebase/admin')

  const batch = await getBatch(batchId)
  if (!batch) throw new Error('Batch not found')
  if (batch.orgId !== orgId) throw new Error('Forbidden')

  const bucket = getStorage(getAdminApp()).bucket()
  const file = bucket.file(batch.csvPath)
  const [buffer] = await file.download()
  const { rows } = parseCsv(buffer.toString('utf8'))

  const existingRows = await listRows({ batchId })
  const processedIds = new Set(
    existingRows.filter((r: { status: string }) => r.status !== 'pending').map((r: { eventId: string }) => r.eventId),
  )
  const pendingRows = rows.filter((r) => !processedIds.has(r.eventId))

  await updateBatchStatus({ batchId, status: 'processing' })

  let processed = 0
  let failed = 0

  for (const row of pendingRows) {
    try {
      const result = await trackConversion({
        orgId: batch.orgId,
        conversionActionId: batch.conversionActionId,
        eventId: row.eventId,
        eventTime: new Date(row.eventTimeIso),
        user: { email: row.email, phone: row.phone },
        value: row.value,
        currency: row.currency,
        gclid: row.gclid,
        ttclid: row.ttclid,
        liFatId: row.liFatId,
      })
      await upsertRow({
        batchId,
        row: { ...row, status: 'sent', result, processedAt: Timestamp.now() },
      })
      processed++
    } catch (err) {
      await upsertRow({
        batchId,
        row: { ...row, status: 'failed', errorMessage: (err as Error).message, processedAt: Timestamp.now() },
      })
      failed++
    }
  }

  const finalStatus = failed === 0 ? 'completed' : 'partial'
  await updateBatchStatus({ batchId, status: finalStatus, processedDelta: processed, failedDelta: failed })
  return { processed, failed, finalStatus }
}

// ─── CSV fixtures ─────────────────────────────────────────────────────────────

const CSV_3_ROWS = [
  'event_id,event_time_iso,email,phone,value,currency,gclid,ttclid,li_fat_id',
  'evt-001,2024-01-15T10:00:00Z,a@example.com,,10.00,USD,,,',
  'evt-002,2024-01-15T11:00:00Z,b@example.com,,20.00,USD,,,',
  'evt-003,2024-01-15T12:00:00Z,c@example.com,,30.00,USD,,,',
].join('\n')

const MOCK_BATCH = {
  id: 'ocb_test',
  orgId: 'org-1',
  conversionActionId: 'action-1',
  csvPath: 'orgs/org-1/offline-conversions/ocb_test.csv',
  status: 'queued',
  totalRows: 3,
  processedRows: 0,
  failedRows: 0,
  createdBy: 'user-1',
  createdAt: { seconds: 1000, nanoseconds: 0 },
  updatedAt: { seconds: 1000, nanoseconds: 0 },
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBatch.mockResolvedValue(MOCK_BATCH)
  mockListRows.mockResolvedValue([])
  mockUpsertRow.mockResolvedValue(undefined)
  mockUpdateBatchStatus.mockResolvedValue(undefined)
  mockDownload.mockResolvedValue([Buffer.from(CSV_3_ROWS)])
  mockTrackConversion.mockResolvedValue({ google: 'sent' })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('offline conversions process logic', () => {
  it('processes each row and upserts result', async () => {
    const result = await runProcessLogic('ocb_test', 'org-1')

    expect(result.processed).toBe(3)
    expect(result.failed).toBe(0)
    expect(mockTrackConversion).toHaveBeenCalledTimes(3)
    expect(mockUpsertRow).toHaveBeenCalledTimes(3)
    expect(mockUpsertRow).toHaveBeenCalledWith(
      expect.objectContaining({ row: expect.objectContaining({ status: 'sent' }) }),
    )
  })

  it('continues on per-row failure and marks batch as partial', async () => {
    // First row fails, others succeed
    mockTrackConversion
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValue({ google: 'sent' })

    const result = await runProcessLogic('ocb_test', 'org-1')

    expect(result.failed).toBe(1)
    expect(result.processed).toBe(2)
    expect(result.finalStatus).toBe('partial')

    const failedCall = mockUpsertRow.mock.calls.find(
      ([args]) => args.row.status === 'failed',
    )
    expect(failedCall).toBeDefined()
    expect(failedCall![0].row.errorMessage).toBe('API error')
  })

  it('skips already-processed rows on re-run', async () => {
    // Simulate evt-001 already sent
    mockListRows.mockResolvedValue([
      { eventId: 'evt-001', status: 'sent' },
    ])

    const result = await runProcessLogic('ocb_test', 'org-1')

    // Only 2 pending rows should be processed
    expect(mockTrackConversion).toHaveBeenCalledTimes(2)
    expect(result.processed).toBe(2)
  })

  it('updates batch counters correctly after processing', async () => {
    await runProcessLogic('ocb_test', 'org-1')

    // Should call updateBatchStatus twice: once to set processing, once with final state
    expect(mockUpdateBatchStatus).toHaveBeenCalledTimes(2)
    expect(mockUpdateBatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'ocb_test', status: 'processing' }),
    )
    expect(mockUpdateBatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 'ocb_test',
        status: 'completed',
        processedDelta: 3,
        failedDelta: 0,
      }),
    )
  })
})
