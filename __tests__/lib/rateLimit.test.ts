const mockTxGet = jest.fn()
const mockTxUpdate = jest.fn()
const mockTxSet = jest.fn()
const mockRunTx = jest.fn()
const configDocs = new Map<string, Record<string, unknown>>()

function primeConfigDoc(path: string, data?: Record<string, unknown>) {
  if (data) configDocs.set(path, data)
  else configDocs.delete(path)
}

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((collectionName: string) => ({
      doc: jest.fn((docId: string) => ({
        id: docId,
        path: `${collectionName}/${docId}`,
        get: jest.fn(async () => {
          const data = configDocs.get(`${collectionName}/${docId}`)
          return {
            exists: data !== undefined,
            data: () => data,
          }
        }),
      })),
    })),
    runTransaction: (fn: (tx: unknown) => unknown) => mockRunTx(fn),
  },
}))

import { checkAndIncrementRateLimit, __resetRateLimitPolicyCacheForTests } from '@/lib/rateLimit'

beforeEach(() => {
  configDocs.clear()
  mockTxGet.mockReset()
  mockTxUpdate.mockReset()
  mockTxSet.mockReset()
  mockRunTx.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet }),
  )
  __resetRateLimitPolicyCacheForTests()
})

test('first hit creates record and allows', async () => {
  mockTxGet.mockResolvedValue({ exists: false })
  const res = await checkAndIncrementRateLimit({ key: 'code:1.2.3.4', limit: 5, windowMs: 60000 })
  expect(res.allowed).toBe(true)
  expect(mockTxSet).toHaveBeenCalled()
})

test('under limit allows + increments', async () => {
  mockTxGet.mockResolvedValue({ exists: true, data: () => ({ count: 2, resetAt: Date.now() + 30000 }) })
  const res = await checkAndIncrementRateLimit({ key: 'code:1.2.3.4', limit: 5, windowMs: 60000 })
  expect(res.allowed).toBe(true)
  expect(res.remaining).toBe(2)
  expect(mockTxUpdate).toHaveBeenCalled()
})

test('over limit blocks', async () => {
  mockTxGet.mockResolvedValue({ exists: true, data: () => ({ count: 5, resetAt: Date.now() + 30000 }) })
  const res = await checkAndIncrementRateLimit({ key: 'code:1.2.3.4', limit: 5, windowMs: 60000 })
  expect(res.allowed).toBe(false)
  expect(res.remaining).toBe(0)
})

test('expired window resets count', async () => {
  mockTxGet.mockResolvedValue({ exists: true, data: () => ({ count: 99, resetAt: Date.now() - 1000 }) })
  const res = await checkAndIncrementRateLimit({ key: 'code:1.2.3.4', limit: 5, windowMs: 60000 })
  expect(res.allowed).toBe(true)
  expect(mockTxSet).toHaveBeenCalled()
})

test('uses the configured API profile limit when the key matches a runtime profile', async () => {
  primeConfigDoc('rate_limit_config/api', {
    entries: [
      { id: 'magic_link_send', limit: 2, windowMs: 15 * 60 * 1000 },
    ],
  })
  mockTxGet.mockResolvedValue({ exists: true, data: () => ({ count: 2, resetAt: Date.now() + 30000 }) })

  const res = await checkAndIncrementRateLimit({
    key: 'magic_link:foo@example.com',
    limit: 3,
    windowMs: 15 * 60 * 1000,
  })

  expect(res.allowed).toBe(false)
  expect(res.remaining).toBe(0)
})

test('applies an active org override to raise the effective limit', async () => {
  primeConfigDoc('rate_limit_overrides/org-live', {
    orgId: 'org-live',
    limit: 10,
    disabled: false,
    expiresAt: Date.now() + 60_000,
  })
  mockTxGet.mockResolvedValue({ exists: true, data: () => ({ count: 5, resetAt: Date.now() + 30000 }) })

  const res = await checkAndIncrementRateLimit({
    key: 'email_transactional:org-live',
    limit: 5,
    windowMs: 60_000,
    orgId: 'org-live',
  })

  expect(res.allowed).toBe(true)
  expect(res.remaining).toBe(4)
  expect(mockTxUpdate).toHaveBeenCalled()
})
