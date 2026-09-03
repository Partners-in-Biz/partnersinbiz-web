/**
 * @jest-environment node
 */

const authenticateSignedDeviceRequest = jest.fn()
const getRuntimeChannelConfig = jest.fn()
const loadDeviceSnap = jest.fn()

jest.mock('@/lib/linked-computers/http', () => ({
  authenticateSignedDeviceRequest: (...args: unknown[]) => authenticateSignedDeviceRequest(...args),
  lifecycleError: (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    const status = /not found/.test(message) ? 404 : /authentication|signature|credential/.test(message) ? 403 : 400
    return new Response(JSON.stringify({ success: false, error: status === 403 ? 'Linked computer access denied' : 'Linked computer request invalid' }), { status })
  },
  noStoreHeaders: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
}))

jest.mock('@/lib/linked-computers/runtime-config', () => {
  const actual = jest.requireActual('@/lib/linked-computers/runtime-config') as typeof import('@/lib/linked-computers/runtime-config')
  return {
    ...actual,
    getRuntimeChannelConfig: (...args: unknown[]) => getRuntimeChannelConfig(...args),
  }
})

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: () => loadDeviceSnap(),
      }),
    }),
  },
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/linked-computers/[deviceId]/runtime-config/route'
import { DEFAULT_RUNTIME_CHANNELS } from '@/lib/linked-computers/runtime-config'

function request() {
  return new NextRequest('https://test/api/v1/linked-computers/device-a/runtime-config', { method: 'GET' })
}

describe('signed linked computer runtime-config', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authenticateSignedDeviceRequest.mockResolvedValue({ deviceId: 'device-a', ownerUserId: 'user-a', credentialVersion: 1 })
    getRuntimeChannelConfig.mockImplementation(async (channel: 'internal' | 'stable') => DEFAULT_RUNTIME_CHANNELS[channel])
    loadDeviceSnap.mockResolvedValue({
      exists: true,
      data: () => ({
        deviceId: 'device-a',
        releaseChannel: 'internal',
        hermesVersion: '0.20.6',
      }),
    })
  })

  it('GET returns the device release channel block plus serverTime', async () => {
    const response = await GET(request(), { params: Promise.resolve({ deviceId: 'device-a' }) })
    expect(response.status).toBe(200)
    expect(authenticateSignedDeviceRequest).toHaveBeenCalled()
    expect(getRuntimeChannelConfig).toHaveBeenCalledWith('internal')
    const json = await response.json() as {
      success: boolean
      data: { channel: string; hermes: { targetVersion: string }; runtimeMinVersion: string; serverTime: string }
    }
    expect(json.success).toBe(true)
    expect(json.data.channel).toBe('internal')
    expect(json.data.hermes).toEqual(DEFAULT_RUNTIME_CHANNELS.internal.hermes)
    expect(json.data.runtimeMinVersion).toBe('1.2.0')
    expect(json.data.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('defaults a missing releaseChannel to stable', async () => {
    loadDeviceSnap.mockResolvedValue({
      exists: true,
      data: () => ({ deviceId: 'device-a' }),
    })
    const response = await GET(request(), { params: Promise.resolve({ deviceId: 'device-a' }) })
    const json = await response.json() as { data: { channel: string } }
    expect(json.data.channel).toBe('stable')
    expect(getRuntimeChannelConfig).toHaveBeenCalledWith('stable')
  })
})
