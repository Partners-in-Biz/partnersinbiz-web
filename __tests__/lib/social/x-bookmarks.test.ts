const mockGet = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()
const mockDecryptTokenBlock = jest.fn(() => ({ accessToken: 'user-token', refreshToken: 'refresh-token' }))

const query = { where: mockWhere, get: mockGet }
mockWhere.mockReturnValue(query)

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/social/encryption', () => ({
  decryptTokenBlock: mockDecryptTokenBlock,
}))

import { fetchXBookmarksForAccount, findPersonalXBookmarkAccount, missingXBookmarkScopes } from '@/lib/social/x-bookmarks'

describe('personal X bookmark helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCollection.mockReturnValue(query)
    mockWhere.mockReturnValue(query)
    global.fetch = jest.fn() as any
  })

  it('requires bookmark scopes before selecting a personal X account', async () => {
    mockGet.mockResolvedValue({ docs: [
      { id: 'posting-only', data: () => ({ status: 'active', scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'], encryptedTokens: {} }) },
      { id: 'bookmark-ready', data: () => ({ status: 'active', scopes: ['tweet.read', 'users.read', 'bookmark.read'], encryptedTokens: {} }) },
    ] })

    const account = await findPersonalXBookmarkAccount('org-1', 'user-1')

    expect(account?.id).toBe('bookmark-ready')
    expect(mockCollection).toHaveBeenCalledWith('social_accounts')
    expect(mockWhere).toHaveBeenCalledWith('accountScope', '==', 'personal')
    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', 'user-1')
  })

  it('reports missing bookmark scopes for existing posting-only X accounts', () => {
    expect(missingXBookmarkScopes(['tweet.read', 'tweet.write', 'users.read', 'offline.access'])).toEqual(['bookmark.read'])
  })

  it('fetches bookmarks through the connected user token', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'tweet-1', text: 'Saved post', author_id: 'author-1', created_at: '2026-06-30T09:00:00.000Z' }],
        includes: { users: [{ id: 'author-1', username: 'peetstander', name: 'Peet' }] },
      }),
    })

    const bookmarks = await fetchXBookmarksForAccount({
      orgId: 'org-1',
      account: { platformAccountId: 'user-x-id', encryptedTokens: { accessToken: 'enc', iv: 'iv', tag: 'tag' } },
      maxResults: 1,
    })

    expect(mockDecryptTokenBlock).toHaveBeenCalledWith({ accessToken: 'enc', iv: 'iv', tag: 'tag' }, 'org-1')
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ href: expect.stringContaining('https://api.x.com/2/users/user-x-id/bookmarks') }),
      { headers: { Authorization: 'Bearer user-token' } },
    )
    expect(bookmarks[0]).toEqual(expect.objectContaining({
      id: 'tweet-1',
      text: 'Saved post',
      author: { id: 'author-1', username: 'peetstander', name: 'Peet' },
      url: 'https://x.com/i/web/status/tweet-1',
    }))
  })
})
