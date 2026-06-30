/**
 * Account Resolver — Resolves a social provider for a given post + org + platform.
 *
 * Resolution order:
 *  1. If the post has accountIds → resolve that specific account from Firestore
 *  2. Otherwise → find the first active account for this org + platform in Firestore
 *  3. Final fallback → getDefaultProvider (env var credentials)
 *
 * Also handles:
 *  - OAuth token decryption via the org's encryption key
 *  - Auto-refresh on 401 errors (refreshes token, persists to Firestore, retries)
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { getDefaultProvider, getProvider } from '@/lib/social/providers'
import type { SocialPlatformType } from '@/lib/social/providers'
import type { ProviderCredentials } from '@/lib/social/providers/base'
import { decryptTokenBlock, encryptTokenBlock } from '@/lib/social/encryption'

export interface ResolvedAccount {
  provider: ReturnType<typeof getProvider>
  accountId: string | null
}

export function isTokenExpiredError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('error validating access token') ||
    normalized.includes('session has expired') ||
    normalized.includes('oauth') && normalized.includes('code') && normalized.includes('190')
  )
}

export async function markAccountTokenExpired(accountId: string, error: string): Promise<void> {
  await adminDb.collection('social_accounts').doc(accountId).update({
    status: 'token_expired',
    lastError: error,
    updatedAt: FieldValue.serverTimestamp(),
  })
}

/** Map provider type to the platform string stored in social_accounts */
const platformMap: Record<string, string[]> = {
  twitter: ['twitter'],
  linkedin: ['linkedin'],
  facebook: ['facebook'],
  instagram: ['instagram'],
  bluesky: ['bluesky'],
  pinterest: ['pinterest'],
  threads: ['threads'],
  tiktok: ['tiktok'],
  youtube: ['youtube'],
  mastodon: ['mastodon'],
  reddit: ['reddit'],
  dribbble: ['dribbble'],
}

/** Map post platform field to provider platform type */
export function toPlatformType(platform: string): SocialPlatformType | null {
  if (platform === 'x' || platform === 'twitter') return 'twitter'
  if (platform === 'linkedin') return 'linkedin'
  if (platform === 'facebook') return 'facebook'
  if (platform === 'instagram') return 'instagram'
  if (platform === 'bluesky') return 'bluesky'
  if (platform === 'pinterest') return 'pinterest'
  if (platform === 'threads') return 'threads'
  if (platform === 'tiktok') return 'tiktok'
  if (platform === 'youtube') return 'youtube'
  if (platform === 'mastodon') return 'mastodon'
  if (platform === 'reddit') return 'reddit'
  if (platform === 'dribbble') return 'dribbble'
  return null
}

/**
 * Build a provider from a Firestore account document.
 * Handles credential construction for each platform type.
 */
function buildProviderFromAccount(
  account: FirebaseFirestore.DocumentData,
  orgId: string,
  platformType: SocialPlatformType,
): ReturnType<typeof getProvider> {
  const { accessToken, refreshToken } = decryptTokenBlock(account.encryptedTokens, orgId)

  const credentials: ProviderCredentials = {
    accessToken,
    refreshToken: refreshToken ?? undefined,
    personUrn: account.platformAccountId ?? undefined,
    instanceUrl: (account.platformMeta?.instanceUrl as string | undefined) ?? undefined,
  }

  // Twitter OAuth 1.0a legacy accounts (non-personal) need API keys
  if (platformType === 'twitter' && account.accountType !== 'personal') {
    credentials.apiKey = process.env.X_API_KEY
    credentials.apiKeySecret = process.env.X_API_KEY_SECRET
    credentials.accessTokenSecret = refreshToken ?? undefined
  }

  return getProvider(platformType, credentials)
}

function hasUsablePlatformAccountId(account: FirebaseFirestore.DocumentData): boolean {
  const value = typeof account.platformAccountId === 'string' ? account.platformAccountId.trim() : ''
  return value.length > 0 && value !== 'unknown'
}

function isPublishableAccount(
  account: FirebaseFirestore.DocumentData,
  platformNames: string[],
  options: { allowPersonal?: boolean } = {},
): boolean {
  if (!options.allowPersonal && account.accountScope === 'personal') return false
  return (
    account.status === 'active' &&
    platformNames.includes(account.platform) &&
    hasUsablePlatformAccountId(account) &&
    Boolean(account.encryptedTokens)
  )
}

/**
 * Find the default active account for a given org + platform.
 * Returns the Firestore doc ID and account data, or null.
 */
export async function findDefaultAccount(
  orgId: string,
  platformType: SocialPlatformType,
): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  const platformNames = platformMap[platformType]
  if (!platformNames) return null

  // 1. Prefer isDefault=true + active
  const defaultSnap = await adminDb
    .collection('social_accounts')
    .where('orgId', '==', orgId)
    .where('status', '==', 'active')
    .where('isDefault', '==', true)
    .where('platform', 'in', platformNames)
    .get()

  for (const doc of defaultSnap.docs) {
    const data = doc.data()
    if (isPublishableAccount(data, platformNames)) {
      return { id: doc.id, data }
    }
  }

  // 2. Fall back to any active account for this platform
  const snap = await adminDb
    .collection('social_accounts')
    .where('orgId', '==', orgId)
    .where('status', '==', 'active')
    .where('platform', 'in', platformNames)
    .get()

  for (const doc of snap.docs) {
    const data = doc.data()
    if (isPublishableAccount(data, platformNames)) {
      return { id: doc.id, data }
    }
  }

  return null
}

/**
 * Resolve a provider for publishing a post.
 *
 * 1. If post has accountIds → use that specific account
 * 2. Otherwise → find the default active account for this org + platform
 * 3. Fallback → env var credentials
 */
export async function resolveProvider(
  post: Record<string, unknown>,
  orgId: string,
  platformType: SocialPlatformType,
): Promise<ResolvedAccount> {
  const personalScope = post.accountScope === 'personal'
  const ownerUid = typeof post.ownerUid === 'string' ? post.ownerUid : ''
  // 1. Try explicit accountIds on the post
  const accountIds = post.accountIds as string[] | undefined
  const explicitId = Array.isArray(accountIds) && accountIds.length > 0 ? accountIds[0] : null

  if (explicitId) {
    const accountDoc = await adminDb.collection('social_accounts').doc(explicitId).get()
    if (accountDoc.exists && accountDoc.data()?.orgId === orgId) {
      const account = accountDoc.data()!
      if (personalScope && (account.accountScope !== 'personal' || account.ownerUid !== ownerUid)) {
        throw new Error('Selected personal account is not available to this user.')
      }
      if (!personalScope && account.accountScope === 'personal') {
        throw new Error('Selected account is personal and cannot be used for company/organisation publishing.')
      }
      const platformNames = platformMap[platformType] ?? []
      if (!isPublishableAccount(account, platformNames, { allowPersonal: personalScope })) {
        throw new Error(`Selected ${platformType} account is not publishable. Reconnect it from Social Accounts and try again.`)
      }
      const provider = buildProviderFromAccount(account, orgId, platformType)
      return { provider, accountId: explicitId }
    }
  }

  if (personalScope) {
    throw new Error('Select an active personal account before publishing this post.')
  }

  // 2. Look up default active account for this org + platform
  const defaultAccount = await findDefaultAccount(orgId, platformType)
  if (defaultAccount) {
    const provider = buildProviderFromAccount(defaultAccount.data, orgId, platformType)
    return { provider, accountId: defaultAccount.id }
  }

  // 3. Fallback to env var credentials
  return { provider: getDefaultProvider(platformType), accountId: null }
}

/**
 * Refresh an account's OAuth token, persist the new token to Firestore,
 * and return a new provider with the fresh credentials.
 */
export async function refreshAccountToken(
  accountId: string,
  orgId: string,
  platformType: SocialPlatformType,
): Promise<ReturnType<typeof getProvider> | null> {
  try {
    const accountDoc = await adminDb.collection('social_accounts').doc(accountId).get()
    if (!accountDoc.exists) return null

    const account = accountDoc.data()!
    const { accessToken, refreshToken } = decryptTokenBlock(account.encryptedTokens, orgId)

    if (!refreshToken) {
      console.warn(`[refreshAccountToken] No refresh token for ${accountId}`)
      return null
    }

    const credentials: ProviderCredentials = {
      accessToken,
      refreshToken,
      personUrn: account.platformAccountId ?? undefined,
      instanceUrl: (account.platformMeta?.instanceUrl as string | undefined) ?? undefined,
    }

    const provider = getProvider(platformType, credentials)
    const newCreds = await provider.refreshToken()
    if (!newCreds?.accessToken) return null

    // Encrypt and persist new tokens
    const encrypted = encryptTokenBlock(
      {
        accessToken: newCreds.accessToken,
        refreshToken: newCreds.refreshToken ?? refreshToken,
      },
      orgId,
    )

    await adminDb.collection('social_accounts').doc(accountId).update({
      encryptedTokens: encrypted,
      lastTokenRefresh: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    // Return a fresh provider with the new credentials
    const freshCredentials: ProviderCredentials = {
      accessToken: newCreds.accessToken,
      refreshToken: newCreds.refreshToken ?? refreshToken,
      personUrn: account.platformAccountId ?? undefined,
      instanceUrl: (account.platformMeta?.instanceUrl as string | undefined) ?? undefined,
    }

    return getProvider(platformType, freshCredentials)
  } catch (err) {
    console.error(`[refreshAccountToken] Failed for ${accountId}:`, err)
    return null
  }
}
