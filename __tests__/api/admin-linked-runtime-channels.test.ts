/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockUser: ApiUser = {
  uid: 'admin-1',
  orgId: 'org-1',
  orgIds: ['org-1'],
  role: 'admin',
}

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, ctx?: unknown) => Promise<Response>) =>
    (req: NextRequest, ctx?: unknown) => handler(req, mockUser, ctx),
}))

const writeRuntimeChannelsDocument = jest.fn()
const getRuntimeChannelsDocument = jest.fn()

jest.mock('@/lib/linked-computers/runtime-config', () => {
  const actual = jest.requireActual('@/lib/linked-computers/runtime-config') as typeof import('@/lib/linked-computers/runtime-config')
  return {
    ...actual,
    writeRuntimeChannelsDocument: (...args: unknown[]) => writeRuntimeChannelsDocument(...args),
    getRuntimeChannelsDocument: (...args: unknown[]) => getRuntimeChannelsDocument(...args),
  }
})

import { PUT } from '@/app/api/v1/admin/linked-runtime/channels/route'
import { DEFAULT_RUNTIME_CHANNELS } from '@/lib/linked-computers/runtime-config'

function put(body: unknown) {
  return new NextRequest('https://test/api/v1/admin/linked-runtime/channels', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('admin linked runtime channels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    writeRuntimeChannelsDocument.mockImplementation(async (value: unknown) => value)
  })

  it('PUT rejects a bad Hermes tag', async () => {
    const response = await PUT(put({
      ...DEFAULT_RUNTIME_CHANNELS,
      stable: {
        ...DEFAULT_RUNTIME_CHANNELS.stable,
        hermes: { ...DEFAULT_RUNTIME_CHANNELS.stable.hermes, targetTag: 'not-a-tag' },
      },
    }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false })
    expect(writeRuntimeChannelsDocument).not.toHaveBeenCalled()
  })

  it('PUT rejects a non-semver version', async () => {
    const response = await PUT(put({
      ...DEFAULT_RUNTIME_CHANNELS,
      internal: {
        ...DEFAULT_RUNTIME_CHANNELS.internal,
        runtimeMinVersion: '1.2',
      },
    }))
    expect(response.status).toBe(400)
    expect(writeRuntimeChannelsDocument).not.toHaveBeenCalled()
  })

  it('PUT persists a valid document', async () => {
    const response = await PUT(put(DEFAULT_RUNTIME_CHANNELS))
    expect(response.status).toBe(200)
    expect(writeRuntimeChannelsDocument).toHaveBeenCalledWith(DEFAULT_RUNTIME_CHANNELS)
  })
})
