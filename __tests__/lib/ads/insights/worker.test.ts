import { drainRefreshQueue } from '@/lib/ads/insights/worker'
import type { RefreshJob } from '@/lib/ads/insights/queue'
import type { AdConnection } from '@/lib/ads/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockClaimPendingJobs = jest.fn<Promise<RefreshJob[]>, [{ limit: number }]>()
const mockMarkJobDone = jest.fn<Promise<void>, [string]>()
const mockMarkJobFailed = jest.fn<Promise<void>, [string, string]>()

jest.mock('@/lib/ads/insights/queue', () => ({
  claimPendingJobs: (...args: unknown[]) => mockClaimPendingJobs(...(args as [{ limit: number }])),
  markJobDone: (...args: unknown[]) => mockMarkJobDone(...(args as [string])),
  markJobFailed: (...args: unknown[]) => mockMarkJobFailed(...(args as [string, string])),
}))

const mockRefreshEntityInsights = jest.fn<Promise<{ rowsWritten: number; daysProcessed: number }>, [unknown]>()

jest.mock('@/lib/ads/insights/refresh', () => ({
  refreshEntityInsights: (...args: unknown[]) => mockRefreshEntityInsights(...(args as [unknown])),
}))

const mockListConnections = jest.fn<Promise<AdConnection[]>, [{ orgId: string }]>()
const mockDecryptAccessToken = jest.fn<string, [AdConnection]>()

jest.mock('@/lib/ads/connections/store', () => ({
  listConnections: (...args: unknown[]) => mockListConnections(...(args as [{ orgId: string }])),
  decryptAccessToken: (...args: unknown[]) => mockDecryptAccessToken(...(args as [AdConnection])),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<RefreshJob> = {}): RefreshJob {
  return {
    id: 'job_1',
    orgId: 'org_a',
    pibEntityId: 'cmp_001',
    metaObjectId: 'meta_cmp_001',
    level: 'campaign',
    status: 'running',
    attempts: 1,
    createdAt: { toMillis: () => Date.now() } as unknown as import('firebase-admin/firestore').Timestamp,
    ...overrides,
  }
}

function makeMetaConn(orgId: string): AdConnection {
  return {
    id: 'conn_1',
    orgId,
    platform: 'meta',
    status: 'active',
    userId: 'u1',
    scopes: [],
    adAccounts: [],
    tokenType: 'user',
    accessTokenEnc: 'enc_tok' as unknown as AdConnection['accessTokenEnc'],
    expiresAt: { toMillis: () => Date.now() + 86400000 } as unknown as import('firebase-admin/firestore').Timestamp,
    createdAt: { toMillis: () => Date.now() } as unknown as import('firebase-admin/firestore').Timestamp,
    updatedAt: { toMillis: () => Date.now() } as unknown as import('firebase-admin/firestore').Timestamp,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drainRefreshQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRefreshEntityInsights.mockResolvedValue({ rowsWritten: 3, daysProcessed: 1 })
    mockMarkJobDone.mockResolvedValue(undefined)
    mockMarkJobFailed.mockResolvedValue(undefined)
  })

  it('returns {processed:0, failed:0} when no pending jobs exist', async () => {
    mockClaimPendingJobs.mockResolvedValue([])

    const result = await drainRefreshQueue()

    expect(result).toEqual({ processed: 0, failed: 0 })
    expect(mockListConnections).not.toHaveBeenCalled()
    expect(mockRefreshEntityInsights).not.toHaveBeenCalled()
  })

  it('drains N jobs, groups by org (1 token decrypt per org), calls refresh per job', async () => {
    const jobs = [
      makeJob({ id: 'job_1', orgId: 'org_a', pibEntityId: 'cmp_001', metaObjectId: 'meta_001' }),
      makeJob({ id: 'job_2', orgId: 'org_a', pibEntityId: 'cmp_002', metaObjectId: 'meta_002' }),
      makeJob({ id: 'job_3', orgId: 'org_b', pibEntityId: 'cmp_003', metaObjectId: 'meta_003' }),
    ]
    mockClaimPendingJobs.mockResolvedValue(jobs)
    mockListConnections.mockImplementation(async ({ orgId }) => [makeMetaConn(orgId)])
    mockDecryptAccessToken.mockReturnValue('tok_decrypted')

    const result = await drainRefreshQueue()

    expect(result).toEqual({ processed: 3, failed: 0 })

    // listConnections called once per org (2 orgs → 2 calls)
    expect(mockListConnections).toHaveBeenCalledTimes(2)
    expect(mockListConnections).toHaveBeenCalledWith({ orgId: 'org_a' })
    expect(mockListConnections).toHaveBeenCalledWith({ orgId: 'org_b' })

    // decryptAccessToken called once per org
    expect(mockDecryptAccessToken).toHaveBeenCalledTimes(2)

    // refreshEntityInsights called once per job
    expect(mockRefreshEntityInsights).toHaveBeenCalledTimes(3)
    expect(mockRefreshEntityInsights).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_a', pibEntityId: 'cmp_001', metaObjectId: 'meta_001' }),
    )
    expect(mockRefreshEntityInsights).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_b', pibEntityId: 'cmp_003' }),
    )

    // All 3 jobs marked done
    expect(mockMarkJobDone).toHaveBeenCalledTimes(3)
    expect(mockMarkJobDone).toHaveBeenCalledWith('job_1')
    expect(mockMarkJobDone).toHaveBeenCalledWith('job_2')
    expect(mockMarkJobDone).toHaveBeenCalledWith('job_3')
    expect(mockMarkJobFailed).not.toHaveBeenCalled()
  })

  it('marks all jobs for an org failed when no Meta connection exists', async () => {
    const jobs = [
      makeJob({ id: 'job_1', orgId: 'org_no_meta', pibEntityId: 'cmp_001', metaObjectId: 'meta_001' }),
      makeJob({ id: 'job_2', orgId: 'org_no_meta', pibEntityId: 'cmp_002', metaObjectId: 'meta_002' }),
    ]
    mockClaimPendingJobs.mockResolvedValue(jobs)
    // Return connections without a Meta one
    mockListConnections.mockResolvedValue([
      { ...makeMetaConn('org_no_meta'), platform: 'google' } as AdConnection,
    ])

    const result = await drainRefreshQueue()

    expect(result).toEqual({ processed: 0, failed: 2 })
    expect(mockRefreshEntityInsights).not.toHaveBeenCalled()
    expect(mockMarkJobFailed).toHaveBeenCalledTimes(2)
    expect(mockMarkJobFailed).toHaveBeenCalledWith('job_1', 'No Meta connection')
    expect(mockMarkJobFailed).toHaveBeenCalledWith('job_2', 'No Meta connection')
    expect(mockMarkJobDone).not.toHaveBeenCalled()
  })

  it('marks a job failed (and continues) when refreshEntityInsights throws', async () => {
    const jobs = [
      makeJob({ id: 'job_ok', orgId: 'org_a', pibEntityId: 'cmp_ok', metaObjectId: 'meta_ok' }),
      makeJob({ id: 'job_err', orgId: 'org_a', pibEntityId: 'cmp_err', metaObjectId: 'meta_err' }),
    ]
    mockClaimPendingJobs.mockResolvedValue(jobs)
    mockListConnections.mockResolvedValue([makeMetaConn('org_a')])
    mockDecryptAccessToken.mockReturnValue('tok_decrypted')

    // First job succeeds, second throws
    mockRefreshEntityInsights
      .mockResolvedValueOnce({ rowsWritten: 5, daysProcessed: 1 })
      .mockRejectedValueOnce(new Error('Meta rate limited'))

    const result = await drainRefreshQueue()

    expect(result).toEqual({ processed: 1, failed: 1 })
    expect(mockMarkJobDone).toHaveBeenCalledWith('job_ok')
    expect(mockMarkJobFailed).toHaveBeenCalledWith('job_err', 'Meta rate limited')
  })
})
