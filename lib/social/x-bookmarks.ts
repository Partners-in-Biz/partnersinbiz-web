import { adminDb } from '@/lib/firebase/admin'
import { decryptTokenBlock } from '@/lib/social/encryption'

export type XBookmarkAuthor = {
  id: string
  name?: string
  username?: string
}

export type XBookmark = {
  id: string
  text: string
  authorId?: string
  author?: XBookmarkAuthor
  createdAt?: string
  url: string
}

const REQUIRED_BOOKMARK_SCOPES = ['bookmark.read', 'users.read', 'tweet.read']

function hasBookmarkScopes(scopes: unknown): boolean {
  if (!Array.isArray(scopes)) return false
  const scopeSet = new Set(scopes.filter((scope): scope is string => typeof scope === 'string'))
  return REQUIRED_BOOKMARK_SCOPES.every((scope) => scopeSet.has(scope))
}

export async function findPersonalXBookmarkAccount(orgId: string, ownerUid: string): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  const snapshot = await adminDb
    .collection('social_accounts')
    .where('orgId', '==', orgId)
    .where('platform', '==', 'twitter')
    .where('accountScope', '==', 'personal')
    .where('ownerUid', '==', ownerUid)
    .get()

  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (data.status === 'active' && data.encryptedTokens && hasBookmarkScopes(data.scopes)) {
      return { id: doc.id, data }
    }
  }

  return null
}

export function missingXBookmarkScopes(scopes: unknown): string[] {
  const scopeSet = new Set(Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : [])
  return REQUIRED_BOOKMARK_SCOPES.filter((scope) => !scopeSet.has(scope))
}

export async function fetchXBookmarksForAccount(opts: {
  orgId: string
  account: FirebaseFirestore.DocumentData
  maxResults?: number
}): Promise<XBookmark[]> {
  const platformAccountId = typeof opts.account.platformAccountId === 'string' ? opts.account.platformAccountId.trim() : ''
  if (!platformAccountId || platformAccountId === 'unknown') {
    throw new Error('Connected X account is missing its X user id. Reconnect the account from Personal social accounts.')
  }

  const { accessToken } = decryptTokenBlock(opts.account.encryptedTokens, opts.orgId)
  const maxResults = Math.min(Math.max(opts.maxResults ?? 5, 1), 100)
  const url = new URL(`https://api.x.com/2/users/${platformAccountId}/bookmarks`)
  url.searchParams.set('max_results', String(maxResults))
  url.searchParams.set('tweet.fields', 'created_at,author_id,text')
  url.searchParams.set('expansions', 'author_id')
  url.searchParams.set('user.fields', 'username,name')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) {
      throw new Error(`X bookmark access is not authorized yet. Reconnect X from Personal social accounts so PiB can request bookmark.read/bookmark.write scopes. (${response.status})`)
    }
    throw new Error(`X bookmarks request failed: ${response.status} ${text}`.trim())
  }

  const payload = await response.json() as {
    data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }>
    includes?: { users?: XBookmarkAuthor[] }
  }
  const authors = new Map((payload.includes?.users ?? []).map((author) => [author.id, author]))
  return (payload.data ?? []).map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    author: tweet.author_id ? authors.get(tweet.author_id) : undefined,
    createdAt: tweet.created_at,
    url: `https://x.com/i/web/status/${tweet.id}`,
  }))
}
