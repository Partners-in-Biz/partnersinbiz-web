const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockLimit = jest.fn()

const chain: { where: typeof mockWhere; limit: typeof mockLimit; get: typeof mockGet } = {
  where: mockWhere,
  limit: mockLimit,
  get: mockGet,
}
mockWhere.mockReturnValue(chain)
mockLimit.mockReturnValue(chain)

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: jest.fn(() => ({ where: mockWhere })) },
}))
jest.mock('@/lib/social/providers', () => ({
  getProvider: jest.fn(),
  getDefaultProvider: jest.fn(),
}))
jest.mock('@/lib/social/encryption', () => ({
  decryptTokenBlock: jest.fn(() => ({ accessToken: 'tok', refreshToken: null })),
}))

import { findDefaultAccount } from '@/lib/social/account-resolver'

describe('findDefaultAccount', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns isDefault=true account first when available', async () => {
    const defaultDoc = { id: 'acc-1', data: () => ({ platform: 'linkedin', platformAccountId: 'li-1', encryptedTokens: {}, isDefault: true, status: 'active' }) }
    mockGet.mockResolvedValueOnce({ empty: false, docs: [defaultDoc] })
    const result = await findDefaultAccount('org-1', 'linkedin')
    expect(result?.id).toBe('acc-1')
  })

  it('falls back to any active account when no isDefault exists', async () => {
    const fallbackDoc = { id: 'acc-2', data: () => ({ platform: 'linkedin', platformAccountId: 'li-2', encryptedTokens: {}, isDefault: false, status: 'active' }) }
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: false, docs: [fallbackDoc] })
    const result = await findDefaultAccount('org-1', 'linkedin')
    expect(result?.id).toBe('acc-2')
  })

  it('returns null when no active accounts exist', async () => {
    mockGet
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: true, docs: [] })
    const result = await findDefaultAccount('org-1', 'linkedin')
    expect(result).toBeNull()
  })

  it('ignores isDefault account from a different platform', async () => {
    const wrongPlatformDoc = { id: 'acc-wrong', data: () => ({ platform: 'twitter', platformAccountId: 'tw-1', encryptedTokens: {}, isDefault: true, status: 'active' }) }
    const correctDoc = { id: 'acc-correct', data: () => ({ platform: 'linkedin', platformAccountId: 'li-3', encryptedTokens: {}, isDefault: false, status: 'active' }) }
    mockGet
      .mockResolvedValueOnce({ empty: false, docs: [wrongPlatformDoc] }) // isDefault query returns twitter account
      .mockResolvedValueOnce({ empty: false, docs: [correctDoc] })       // fallback returns linkedin
    const result = await findDefaultAccount('org-1', 'linkedin')
    expect(result?.id).toBe('acc-correct')
  })

  it('ignores placeholder Instagram accounts with unknown account ids', async () => {
    const unknownDoc = { id: 'bad-ig', data: () => ({ platform: 'instagram', platformAccountId: 'unknown', encryptedTokens: {}, isDefault: true, status: 'active' }) }
    const correctDoc = { id: 'good-ig', data: () => ({ platform: 'instagram', platformAccountId: '17841400000000001', encryptedTokens: {}, isDefault: false, status: 'active' }) }
    mockGet
      .mockResolvedValueOnce({ empty: false, docs: [unknownDoc] })
      .mockResolvedValueOnce({ empty: false, docs: [correctDoc] })
    const result = await findDefaultAccount('org-1', 'instagram')
    expect(result?.id).toBe('good-ig')
  })
})
