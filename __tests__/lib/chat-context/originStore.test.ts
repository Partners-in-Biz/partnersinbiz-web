const records = new Map<string, Record<string, unknown>>()

function ref(path: string) {
  return {
    path,
    get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
    set: async (value: Record<string, unknown>, options?: { merge?: boolean }) => {
      records.set(path, options?.merge ? { ...(records.get(path) ?? {}), ...value } : value)
    },
    delete: async () => { records.delete(path) },
  }
}

const db = {
  collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
  runTransaction: async (work: (transaction: any) => Promise<unknown>) => work({
    get: (document: ReturnType<typeof ref>) => document.get(),
    set: (document: ReturnType<typeof ref>, value: Record<string, unknown>, options?: { merge?: boolean }) => document.set(value, options),
    delete: (document: ReturnType<typeof ref>) => document.delete(),
  }),
}

jest.mock('@/lib/firebase/admin', () => ({ adminDb: db }))

import { claimStudioArtifactOrigin, completeStudioArtifactOrigin, releaseStudioArtifactOrigin } from '@/lib/chat-context/originStore'

const origin = { conversationId: 'conv-1', requestMessageId: 'req-1', responseMessageId: 'res-1', bundleId: 'bundle-1', sequence: 0 }

describe('originStore lease ownership', () => {
  beforeEach(() => { records.clear(); jest.restoreAllMocks() })

  it('rotates nonce on expired takeover while retaining the deterministic artifact ID', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000)
    const first = await claimStudioArtifactOrigin('marketing_studio', 'org-1', origin)
    jest.spyOn(Date, 'now').mockReturnValue(1_000 + (5 * 60 * 1000) + 1)
    const second = await claimStudioArtifactOrigin('marketing_studio', 'org-1', origin)

    expect(second).toMatchObject({ claimed: true, artifactId: first.artifactId })
    expect(second.claimNonce).not.toBe(first.claimNonce)
  })

  it('prevents a stale claimant from completing or releasing a newer lease', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000)
    const stale = await claimStudioArtifactOrigin('marketing_studio', 'org-1', origin)
    jest.spyOn(Date, 'now').mockReturnValue(1_000 + (5 * 60 * 1000) + 1)
    const current = await claimStudioArtifactOrigin('marketing_studio', 'org-1', origin)

    await expect(completeStudioArtifactOrigin('marketing_studio', 'org-1', origin, current.artifactId!, stale.claimNonce)).rejects.toThrow('stale')
    await releaseStudioArtifactOrigin('marketing_studio', 'org-1', origin, stale.claimNonce)
    await expect(completeStudioArtifactOrigin('marketing_studio', 'org-1', origin, current.artifactId!, current.claimNonce)).resolves.toBeUndefined()
    const replay = await claimStudioArtifactOrigin('marketing_studio', 'org-1', origin)
    expect(replay).toMatchObject({ claimed: false, artifactId: current.artifactId, claimNonce: current.claimNonce })
  })
})
