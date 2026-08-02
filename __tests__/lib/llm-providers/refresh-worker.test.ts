/**
 * @jest-environment node
 */

const mockConnectionGet = jest.fn()
const mockLimit = jest.fn(() => ({ get: (...args: unknown[]) => mockConnectionGet(...args) }))
const mockWhere = jest.fn(() => ({ limit: (...args: unknown[]) => mockLimit(...args) }))
const mockCollection = jest.fn(() => ({ where: (...args: unknown[]) => mockWhere(...args) }))
const mockGetCredentials = jest.fn()
const mockSyncConnection = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: (...args: unknown[]) => mockCollection(...args) },
}))

jest.mock('@/lib/llm-providers/store', () => ({
  getDecryptedLlmCredentials: (...args: unknown[]) => mockGetCredentials(...args),
}))

jest.mock('@/lib/llm-providers/sync-hermes', () => ({
  syncLlmConnectionToHermes: (...args: unknown[]) => mockSyncConnection(...args),
}))

import { refreshDueXaiLlmConnections } from '@/lib/llm-providers/refresh-worker'

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

describe('xAI OAuth credential refresh worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSyncConnection.mockResolvedValue({ synced: ['pip'], queued: [], failed: [] })
  })

  it('refreshes only due connected accounts and returns fleet delivery counts', async () => {
    const now = 1_900_000_000_000
    mockConnectionGet.mockResolvedValue({
      docs: [
        {
          id: 'due',
          data: () => ({ id: 'due', status: 'connected', credentialsEnc: { ciphertext: 'c' } }),
        },
        {
          id: 'fresh',
          data: () => ({ id: 'fresh', status: 'connected', credentialsEnc: { ciphertext: 'c' } }),
        },
        {
          id: 'reauth',
          data: () => ({ id: 'reauth', status: 'reauth_required', credentialsEnc: { ciphertext: 'c' } }),
        },
      ],
    })
    mockGetCredentials.mockImplementation((connection: { id: string }) => ({
      access_token: connection.id === 'due' ? jwt(1_900_000_600) : jwt(1_900_003_600),
    }))

    const result = await refreshDueXaiLlmConnections({ nowMs: now, limit: 8 })

    expect(mockCollection).toHaveBeenCalledWith('llm_provider_connections')
    expect(mockWhere).toHaveBeenCalledWith('provider', '==', 'xai-oauth')
    expect(mockLimit).toHaveBeenCalledWith(8)
    expect(mockSyncConnection).toHaveBeenCalledWith('due')
    expect(mockSyncConnection).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ scanned: 2, due: 1, refreshed: 1, synced: 1, queued: 0, failed: 0 })
  })

  it('continues after a failed account refresh', async () => {
    const now = 1_900_000_000_000
    mockConnectionGet.mockResolvedValue({
      docs: [
        { id: 'bad', data: () => ({ id: 'bad', status: 'connected', credentialsEnc: { ciphertext: 'c' } }) },
        { id: 'good', data: () => ({ id: 'good', status: 'connected', credentialsEnc: { ciphertext: 'c' } }) },
      ],
    })
    mockGetCredentials.mockResolvedValue({ access_token: jwt(1_900_000_600) })
    mockSyncConnection
      .mockRejectedValueOnce(new Error('invalid grant'))
      .mockResolvedValueOnce({ synced: ['pip'], queued: [], failed: [] })

    const result = await refreshDueXaiLlmConnections({ nowMs: now })

    expect(mockSyncConnection).toHaveBeenCalledWith('bad')
    expect(mockSyncConnection).toHaveBeenCalledWith('good')
    expect(result).toEqual({ scanned: 2, due: 2, refreshed: 1, synced: 1, queued: 0, failed: 1 })
  })
})
