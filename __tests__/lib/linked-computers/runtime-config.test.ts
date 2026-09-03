/**
 * @jest-environment node
 */

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: async () => { throw new Error('firestore should not be used in these tests') },
        set: async () => { throw new Error('firestore should not be used in these tests') },
      }),
    }),
  },
}))

import {
  DEFAULT_RUNTIME_CHANNELS,
  getRuntimeChannelConfig,
  parseRuntimeChannelsDocument,
  resetRuntimeChannelConfigCache,
  type RuntimeChannelConfigStore,
} from '@/lib/linked-computers/runtime-config'
import { hermesUpdateRequired } from '@/lib/linked-computers/runtime-targets'

function storeOf(data: Record<string, unknown> | null, onGet?: () => void): RuntimeChannelConfigStore {
  return {
    async get() {
      onGet?.()
      return { exists: data !== null, data: () => data ?? undefined }
    },
  }
}

describe('runtime channel config', () => {
  beforeEach(() => {
    resetRuntimeChannelConfigCache()
  })

  it('returns built-in defaults when the Firestore doc is missing', async () => {
    const internal = await getRuntimeChannelConfig('internal', { store: storeOf(null) })
    const stable = await getRuntimeChannelConfig('stable', { store: storeOf(null) })
    expect(internal).toEqual(DEFAULT_RUNTIME_CHANNELS.internal)
    expect(stable).toEqual(DEFAULT_RUNTIME_CHANNELS.stable)
  })

  it('returns the stored channel document when present', async () => {
    const stored = {
      internal: { hermes: { targetVersion: '0.22.0', minVersion: '0.21.0', targetTag: 'v2026.9.1' }, runtimeMinVersion: '1.3.0' },
      stable: { hermes: { targetVersion: '0.20.8', minVersion: '0.20.5', targetTag: 'v2026.8.28' }, runtimeMinVersion: '1.1.40' },
    }
    await expect(getRuntimeChannelConfig('internal', { store: storeOf(stored) })).resolves.toEqual(stored.internal)
    resetRuntimeChannelConfigCache()
    await expect(getRuntimeChannelConfig('stable', { store: storeOf(stored) })).resolves.toEqual(stored.stable)
  })

  it('serves a 60s in-process cache after the first read', async () => {
    let reads = 0
    const stored = {
      internal: DEFAULT_RUNTIME_CHANNELS.internal,
      stable: DEFAULT_RUNTIME_CHANNELS.stable,
    }
    const store = storeOf(stored, () => { reads += 1 })
    const first = await getRuntimeChannelConfig('stable', { store, nowMs: () => 1_000 })
    const second = await getRuntimeChannelConfig('internal', { store, nowMs: () => 30_000 })
    expect(first).toEqual(DEFAULT_RUNTIME_CHANNELS.stable)
    expect(second).toEqual(DEFAULT_RUNTIME_CHANNELS.internal)
    expect(reads).toBe(1)
    await getRuntimeChannelConfig('stable', { store, nowMs: () => 61_001 })
    expect(reads).toBe(2)
  })

  it('rejects a bad Hermes tag in the admin document parser', () => {
    expect(parseRuntimeChannelsDocument({
      ...DEFAULT_RUNTIME_CHANNELS,
      stable: {
        ...DEFAULT_RUNTIME_CHANNELS.stable,
        hermes: { ...DEFAULT_RUNTIME_CHANNELS.stable.hermes, targetTag: '2026.8.27' },
      },
    })).toBeNull()
  })
})

describe('hermesUpdateRequired', () => {
  const min = '0.20.6'

  it('is required when hermesVersion is missing', () => {
    expect(hermesUpdateRequired({}, min)).toBe(true)
    expect(hermesUpdateRequired({ hermesVersion: '' }, min)).toBe(true)
  })

  it('is required when hermesVersion is below min', () => {
    expect(hermesUpdateRequired({ hermesVersion: '0.20.5' }, min)).toBe(true)
    expect(hermesUpdateRequired({ hermesVersion: '0.19.9' }, min)).toBe(true)
    expect(hermesUpdateRequired({ hermesVersion: 'invalid' }, min)).toBe(true)
  })

  it('is not required at the min version', () => {
    expect(hermesUpdateRequired({ hermesVersion: '0.20.6' }, min)).toBe(false)
  })

  it('is not required above the min version', () => {
    expect(hermesUpdateRequired({ hermesVersion: '0.20.7' }, min)).toBe(false)
    expect(hermesUpdateRequired({ hermesVersion: '0.21.0' }, min)).toBe(false)
  })
})
