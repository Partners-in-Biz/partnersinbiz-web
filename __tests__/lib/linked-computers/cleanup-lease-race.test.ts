import { claimDeviceCleanupLease, DeviceCleanupLeaseLostError, mutateCleanupRunWithLease } from '@/lib/linked-computers/store'

function fakeCleanupDb(seed: Record<string, unknown>) {
  let row = { ...seed }
  const ref = { id: 'device-a' }
  const snap = () => ({ exists: true, data: () => ({ ...row }) })
  return {
    row: () => ({ ...row }),
    db: {
      collection: () => ({ doc: () => ref }),
      runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
        get: async () => snap(),
        set: (_ref: unknown, patch: Record<string, unknown>, options?: { merge?: boolean }) => { row = options?.merge ? { ...row, ...patch } : { ...patch } },
      }),
    },
  }
}

describe('linked device cleanup lease races', () => {
  it('fences stale worker success and error paths after replacement worker reclaim', async () => {
    const fake = fakeCleanupDb({ deviceId: 'device-a', status: 'pending', phase: 'mappings', processed: 0 })
    const tokenA = await claimDeviceCleanupLease('device-a', fake.db, 'worker-a', 1_000)
    expect(tokenA).toEqual(expect.any(String))

    const tokenB = await claimDeviceCleanupLease('device-a', fake.db, 'worker-b', 62_000)
    expect(tokenB).toEqual(expect.any(String))
    expect(tokenB).not.toBe(tokenA)
    const afterReclaim = fake.row()

    await expect(mutateCleanupRunWithLease(fake.db, 'device-a', 'worker-a', tokenA!, { phase: 'jobs', processed: 99 }, 62_001)).rejects.toBeInstanceOf(DeviceCleanupLeaseLostError)
    expect(fake.row()).toEqual(afterReclaim)

    await expect(mutateCleanupRunWithLease(fake.db, 'device-a', 'worker-a', tokenA!, { status: 'retryable', lastError: 'stale failure' }, 62_002)).rejects.toBeInstanceOf(DeviceCleanupLeaseLostError)
    expect(fake.row()).toEqual(afterReclaim)

    await mutateCleanupRunWithLease(fake.db, 'device-a', 'worker-b', tokenB!, { phase: 'complete', processed: 500 }, 62_003)
    expect(fake.row()).toEqual(expect.objectContaining({ status: 'running', leaseOwner: 'worker-b', leaseToken: tokenB, phase: 'complete', processed: 500 }))
    await mutateCleanupRunWithLease(fake.db, 'device-a', 'worker-b', tokenB!, { status: 'completed', leaseOwner: null, leaseToken: null, leaseExpiresAt: null }, 62_004)
    expect(fake.row()).toEqual(expect.objectContaining({ status: 'completed', phase: 'complete', processed: 500 }))
  })
})
