const mockCollection = jest.fn()
const mockCallHermesJson = jest.fn()
const mockDocSet = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
}))

jest.mock('@/lib/hermes/server', () => ({
  HERMES_RUNS_COLLECTION: 'hermes_runs',
  callHermesJson: (...args: unknown[]) => mockCallHermesJson(...args),
}))

import { reconcileActiveHermesRunsForOrg } from '@/lib/hermes/run-ledger'
import type { HermesProfileLink } from '@/lib/hermes/types'

beforeEach(() => {
  jest.clearAllMocks()
  mockDocSet.mockResolvedValue(undefined)
})

describe('reconcileActiveHermesRunsForOrg', () => {
  it('updates direct profile-run ledger rows when Hermes reports completion', async () => {
    const directRunDoc = {
      id: 'run-doc-1',
      ref: { set: mockDocSet },
      data: () => ({
        orgId: 'pib-platform-owner',
        profile: 'pip',
        status: 'started',
        hermesRunId: 'run_123',
        createdAt: { toMillis: () => Date.now() - 60_000 },
      }),
    }
    const get = jest.fn().mockResolvedValue({ docs: [directRunDoc] })
    const limit = jest.fn(() => ({ get }))
    const where = jest.fn(() => ({ limit }))
    mockCollection.mockReturnValue({ where })

    mockCallHermesJson.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {
        status: 'completed',
        output: { text: 'Direct run finished.' },
      },
    })

    const result = await reconcileActiveHermesRunsForOrg({
      orgId: 'pib-platform-owner',
      profile: 'pip',
      baseUrl: 'http://127.0.0.1:8643',
      enabled: true,
      capabilities: { runs: true, dashboard: true, cron: false, models: false, tools: true, files: false, terminal: false },
      permissions: { superAdmin: false, restrictedAdmin: false, client: true, allowedUserIds: [] },
    } as HermesProfileLink)

    expect(result).toMatchObject({ scanned: 1, checked: 1, updated: 1 })
    expect(mockCallHermesJson).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'pip' }),
      '/v1/runs/run_123',
    )
    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        response: expect.objectContaining({ status: 'completed' }),
        output: 'Direct run finished.',
        completedAt: expect.anything(),
      }),
      { merge: true },
    )
  })
})
