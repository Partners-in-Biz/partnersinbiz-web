/**
 * @jest-environment node
 */
import { computeNextRunAtMs, selectDueRoutines } from '@/lib/routines/scheduler'

const mockUpdate = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({ id, path: `bot_routines/${id}` }),
    }),
    runTransaction: async (fn: (tx: {
      get: (ref: { id: string }) => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> }>
      update: typeof mockUpdate
    }) => Promise<unknown>) => {
      const state = (globalThis as { __routineClaimState?: Record<string, unknown> }).__routineClaimState
      return fn({
        get: async (ref) => ({
          exists: Boolean(state),
          id: ref.id,
          data: () => (state ? { ...state } : {}),
        }),
        update: mockUpdate,
      })
    },
  },
}))

import { claimDueScheduleRoutine } from '@/lib/routines/store'

describe('routines scheduler', () => {
  it('selects only enabled rows with nextRunAt <= now', () => {
    const now = 1_000_000
    const due = selectDueRoutines([
      { enabled: true, nextRunAt: 900_000 },
      { enabled: true, nextRunAt: 1_100_000 },
      { enabled: false, nextRunAt: 500_000 },
      { enabled: true, nextRunAt: null },
    ], now)
    expect(due).toHaveLength(1)
    expect(due[0].nextRunAt).toBe(900_000)
  })

  it('computes next hourly and daily run bounds', () => {
    const from = Date.UTC(2026, 8, 4, 10, 15, 0)
    const hourly = computeNextRunAtMs('@hourly', from)
    expect(hourly).toBeGreaterThan(from)
    const daily = computeNextRunAtMs('@daily', from)
    expect(daily).toBeGreaterThan(from)
  })
})

describe('claimDueScheduleRoutine lock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete (globalThis as { __routineClaimState?: unknown }).__routineClaimState
  })

  it('returns null when nextRunAt is in the future', async () => {
    ;(globalThis as { __routineClaimState?: Record<string, unknown> }).__routineClaimState = {
      enabled: true,
      status: 'active',
      triggerKind: 'schedule',
      nextRunAt: Date.now() + 60_000,
      runCount: 0,
    }
    const claimed = await claimDueScheduleRoutine('rt_1', Date.now(), Date.now() + 3_600_000)
    expect(claimed).toBeNull()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('locks and bumps nextRunAt when due', async () => {
    const now = 1_700_000_000_000
    ;(globalThis as { __routineClaimState?: Record<string, unknown> }).__routineClaimState = {
      routineId: 'rt_1',
      enabled: true,
      status: 'active',
      triggerKind: 'schedule',
      nextRunAt: now - 1,
      runCount: 2,
      orgId: 'org-1',
      agentId: 'blake',
    }
    const next = now + 3_600_000
    const claimed = await claimDueScheduleRoutine('rt_1', now, next)
    expect(claimed?.routineId).toBe('rt_1')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rt_1' }),
      expect.objectContaining({ nextRunAt: next, lastRunAt: now, runCount: 3 }),
    )
  })
})
