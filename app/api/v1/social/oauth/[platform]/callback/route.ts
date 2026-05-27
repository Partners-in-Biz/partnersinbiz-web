/**
 * OAuth Callback — Handles the OAuth redirect from social platforms.
 *
 * GET /api/v1/social/oauth/{platform}/callback
 * Query: ?code={auth_code}&state={state_token}
 *
 * Exchanges the auth code for tokens, encrypts and stores them,
 * fetches profile info, and creates/updates the social_accounts entry.
 */
import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import { getOAuthConfig, getClientCredentials, getCallbackUrl } from '@/lib/social/oauth-config'
import type { LinkedInOAuthMode } from '@/lib/social/oauth-config'
import { encryptTokenBlock } from '@/lib/social/encryption'
import { getProvider } from '@/lib/social/providers/registry'
import { exchangeInstagramLongLivedToken } from '@/lib/social/instagram-oauth'
import { logAudit } from '@/lib/social/audit'
import type { SocialPlatformType } from '@/lib/social/providers/types'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const rawPlatform = url.pathname.split('/').slice(-2)[0]
  const platform = (rawPlatform === 'x' ? 'twitter' : rawPlatform) as SocialPlatformType
  const code = url.searchParams.get('code')
  const stateToken = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // Default redirect on failure
  let redirectUrl = '/admin/social'

  try {
    // Handle platform-side errors
    if (error) {
      const errorDesc = url.searchParams.get('error_description') ?? error
      return NextResponse.redirect(new URL(`${redirectUrl}?status=error&message=${encodeURIComponent(errorDesc)}`, url.origin))
    }

    if (!code || !stateToken) {
      return NextResponse.redirect(new URL(`${redirectUrl}?status=error&message=Missing+code+or+state`, url.origin))
    }

    // Decode and verify state
    const stateData = JSON.parse(Buffer.from(stateToken, 'base64url').toString())
    const { orgId, nonce, redirectUrl: savedRedirect } = stateData
    const accountScope = stateData.accountScope === 'personal' ? 'personal' : 'org'
    const ownerUid = typeof stateData.ownerUid === 'string' ? stateData.ownerUid : ''
    const linkedinMode: LinkedInOAuthMode =
      platform === 'linkedin' && stateData.linkedinMode === 'organization'
        ? 'organization'
        : 'personal'
    redirectUrl = savedRedirect ?? redirectUrl

    // Verify state in Firestore
    const stateDoc = await adminDb.collection('social_oauth_states').doc(nonce).get()
    if (!stateDoc.exists) {
      return NextResponse.redirect(new URL(`${redirectUrl}?status=error&message=Invalid+or+expired+state`, url.origin))
    }

    const stateRecord = stateDoc.data()!
    if (stateRecord.platform !== platform || stateRecord.orgId !== orgId) {
      return NextResponse.redirect(new URL(`${redirectUrl}?status=error&message=State+mismatch`, url.origin))
    }

    // Check expiry
    const expiresAt = stateRecord.expiresAt?.toDate?.() ?? new Date(0)
    if (expiresAt < new Date()) {
      await adminDb.collection('social_oauth_states').doc(nonce).delete()
      return NextResponse.redirect(new URL(`${redirectUrl}?status=error&message=OAuth+state+expired`, url.origin))
    }

    // Retrieve PKCE code_verifier if stored
    const codeVerifier: string | null = stateRecord.codeVerifier ?? null

    // Delete state token (one-time use)
    await adminDb.collection('social_oauth_states').doc(nonce).delete()

    // Exchange code for tokens
    const config = getOAuthConfig(platform, { linkedinMode })
    const clientCreds = getClientCredentials(platform, { linkedinMode })
    if (!config || !clientCreds) {
      return NextResponse.redirect(new URL(`${redirectUrl}?status=error&message=Platform+not+configured`, url.origin))
    }

    const callbackUrl = getCallbackUrl(platform)
    const tokenResponse = await exchangeCode(config, clientCreds, code, callbackUrl, codeVerifier)

    // Build provider credentials to fetch profile
    const providerCreds: {
      accessToken: string
      refreshToken?: string
      apiKey: string
      apiKeySecret: string
      personUrn?: string
    } = {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken ?? undefined,
      apiKey: clientCreds.clientId,
      apiKeySecret: clientCreds.clientSecret,
    }

    // Instagram Login normally returns a short-lived token first. Some Meta app
    // states reject both documented exchange methods with a method-type error,
    // but still allow the returned token to identify the account.
    if (platform === 'instagram') {
      const longLived = await exchangeInstagramLongLivedToken(
        tokenResponse.accessToken,
        clientCreds.clientSecret,
      )
      providerCreds.accessToken = longLived.accessToken
      tokenResponse.accessToken = longLived.accessToken
      if (longLived.exchanged) {
        tokenResponse.expiresIn = longLived.expiresIn
      }
    }

    // Threads: exchange short-lived token (1h) for long-lived token (60 days)
    if (platform === 'threads') {
      const longLived = await exchangeThreadsLongLivedToken(
        tokenResponse.accessToken,
        clientCreds.clientSecret,
      )
      providerCreds.accessToken = longLived.accessToken
      tokenResponse.accessToken = longLived.accessToken
      tokenResponse.expiresIn = longLived.expiresIn
    }

    // Facebook and LinkedIn: collect all accounts/pages, write pending doc, redirect with picker nonce
    if (platform === 'facebook') {
      const fbResult = await fetchAllFacebookAccounts(tokenResponse.accessToken)
      const options = fbResult.map((acc, i) => {
        const encrypted = encryptTokenBlock(
          { accessToken: acc.accessToken, refreshToken: null, tokenType: 'Bearer', expiresAt: null },
          orgId,
        )
        return {
          index: i,
          displayName: acc.displayName,
          username: acc.username,
          avatarUrl: acc.avatarUrl,
          profileUrl: acc.profileUrl,
          accountType: acc.accountType,
          platformAccountId: acc.platformAccountId,
          encryptedTokens: encrypted,
          platformMeta: acc.meta ?? {},
          scopes: config.scopes,
        }
      })
      if (options.length === 0) {
        return NextResponse.redirect(
          new URL(`${redirectUrl}?status=error&message=${encodeURIComponent('No Facebook accounts found')}`, url.origin).toString()
        )
      }
      return writePendingAndRedirect(options, platform, orgId, nonce, redirectUrl, url.origin, accountScope, ownerUid)
    }

    if (platform === 'linkedin') {
      const liResult = await fetchAllLinkedInAccounts(tokenResponse.accessToken)
      const refreshToken = tokenResponse.refreshToken ?? null
      const expiresAt = tokenResponse.expiresIn
        ? new Date(Date.now() + tokenResponse.expiresIn * 1000)
        : null
      // Encrypt once — all LinkedIn sub-accounts share the same user token
      const encrypted = encryptTokenBlock(
        { accessToken: tokenResponse.accessToken, refreshToken, expiresAt },
        orgId,
      )
      const options = liResult.map((acc, i) => ({
        index: i,
        displayName: acc.displayName,
        username: acc.username,
        avatarUrl: acc.avatarUrl,
        profileUrl: acc.profileUrl,
        accountType: acc.accountType,
        platformAccountId: acc.platformAccountId,
        encryptedTokens: encrypted,
        platformMeta: acc.meta ?? {},
        scopes: config.scopes,
      }))
      if (options.length === 0) {
        return NextResponse.redirect(
          new URL(`${redirectUrl}?status=error&message=${encodeURIComponent('No LinkedIn accounts found')}`, url.origin).toString()
        )
      }
      return writePendingAndRedirect(options, platform, orgId, nonce, redirectUrl, url.origin, accountScope, ownerUid)
    }

    // All other platforms: fetch profile, encrypt, upsert social_accounts, audit log
    let profile
    try {
      if (platform === 'instagram') {
        profile = await fetchInstagramProfile(providerCreds.accessToken, tokenResponse.platformAccountId)
      } else if (platform === 'twitter') {
        profile = await fetchTwitterProfile(tokenResponse.accessToken)
      } else {
        const provider = getProvider(platform, {
          ...providerCreds,
          personUrn: 'temp', // Will be set after profile fetch
        })
        profile = await provider.getProfile()
      }
    } catch (profileErr) {
      if (platform === 'instagram') {
        const message = profileErr instanceof Error ? profileErr.message : 'Instagram profile lookup failed'
        throw new Error(`Instagram connected, but PiB could not identify the account. ${message}`)
      }
      // Profile fetch failed — store account anyway with minimal info
      profile = {
        platformAccountId: 'unknown',
        displayName: platform,
        username: '',
        avatarUrl: '',
        profileUrl: '',
        accountType: 'personal' as const,
      }
    }

    // Encrypt tokens
    const encryptedTokens = encryptTokenBlock(
      {
        accessToken: providerCreds.accessToken,
        refreshToken: tokenResponse.refreshToken,
        tokenType: tokenResponse.tokenType,
        expiresAt: tokenResponse.expiresIn
          ? new Date(Date.now() + tokenResponse.expiresIn * 1000)
          : null,
      },
      orgId,
    )

    // Check if account already exists for this platform + platformAccountId
    // Uses top-level social_accounts collection (matching GET/POST /accounts endpoints)
    const existingQuery = await adminDb
      .collection('social_accounts')
      .where('orgId', '==', orgId)
      .where('platform', '==', platform)
      .where('platformAccountId', '==', profile.platformAccountId)
      .limit(1)
      .get()

    const now = Timestamp.now()
    const accountData = {
      orgId,
      platform,
      platformAccountId: profile.platformAccountId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      accountType: profile.accountType ?? 'personal',
      status: 'active',
      scopes: config.scopes,
      encryptedTokens: {
        accessToken: encryptedTokens.accessToken,
        refreshToken: encryptedTokens.refreshToken,
        tokenType: encryptedTokens.tokenType,
        expiresAt: encryptedTokens.expiresAt ? Timestamp.fromDate(encryptedTokens.expiresAt) : null,
        iv: encryptedTokens.iv,
        tag: encryptedTokens.tag,
      },
      platformMeta: profile.meta ?? {},
      lastTokenRefresh: now,
      updatedAt: now,
      ...(accountScope === 'personal' ? { accountScope, ownerUid } : {}),
    }

    let accountId: string
    if (!existingQuery.empty) {
      // Update existing account
      accountId = existingQuery.docs[0].id
      await adminDb
        .collection('social_accounts')
        .doc(accountId)
        .update(accountData)
    } else {
      // Create new account
      const docRef = await adminDb
        .collection('social_accounts')
        .add({
          ...accountData,
          connectedBy: 'oauth',
          connectedAt: now,
          lastUsed: null,
          createdAt: now,
        })
      accountId = docRef.id
    }

    // Audit log
    logAudit({
      orgId,
      action: 'account.connected',
      entityType: 'account',
      entityId: accountId,
      performedBy: 'oauth',
      performedByRole: 'system',
      details: { platform, displayName: profile.displayName },
    })

    return NextResponse.redirect(
      new URL(`${redirectUrl}?status=success&platform=${platform}&account=${accountId}`, url.origin),
    )
  } catch (err) {
    console.error(`OAuth callback error for ${platform}:`, err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.redirect(
      new URL(`${redirectUrl}?status=error&message=${encodeURIComponent(message)}`, url.origin),
    )
  }
}

// --- Token Exchange ---

interface TokenResponse {
  accessToken: string
  refreshToken: string | null
  tokenType: string
  expiresIn: number | null
  platformAccountId?: string
}

async function exchangeCode(
  config: ReturnType<typeof getOAuthConfig> & {},
  clientCreds: { clientId: string; clientSecret: string },
  code: string,
  redirectUri: string,
  codeVerifier?: string | null,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  })

  // Add PKCE code_verifier if present
  if (codeVerifier) {
    body.set('code_verifier', codeVerifier)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  if (config.useBasicAuth) {
    headers['Authorization'] = `Basic ${Buffer.from(`${clientCreds.clientId}:${clientCreds.clientSecret}`).toString('base64')}`
  } else {
    body.set('client_id', clientCreds.clientId)
    body.set('client_secret', clientCreds.clientSecret)
  }

  // TikTok uses JSON body
  let response: Response
  if (config.platform === 'tiktok') {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_key: clientCreds.clientId,
        client_secret: clientCreds.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    })
  } else {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    })
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed for ${config.platform}: ${response.status} ${text}`)
  }

  const rawData = await response.json() as unknown
  const data = normalizeTokenPayload(config.platform, rawData)
  const accessToken = readString(data, 'access_token') ?? readString(data, 'accessToken')
  if (!accessToken) {
    throw new Error(`Token exchange failed for ${config.platform}: missing access token`)
  }

  // Normalize response (different platforms use different field names)
  return {
    accessToken,
    refreshToken: readString(data, 'refresh_token') ?? readString(data, 'refreshToken') ?? null,
    tokenType: readString(data, 'token_type') ?? 'Bearer',
    expiresIn: readNumber(data, 'expires_in') ?? readNumber(data, 'expiresIn') ?? null,
    platformAccountId:
      readString(data, 'user_id') ??
      readString(data, 'userId') ??
      readString(data, 'id') ??
      undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number') return String(value)
  return null
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' ? value : null
}

function normalizeTokenPayload(platform: SocialPlatformType, rawData: unknown): Record<string, unknown> {
  if (
    platform === 'instagram' &&
    isRecord(rawData) &&
    Array.isArray(rawData.data) &&
    isRecord(rawData.data[0])
  ) {
    return rawData.data[0]
  }
  if (isRecord(rawData)) return rawData
  return {}
}

// --- Platform-specific profile helpers ---

interface FacebookAccount {
  platformAccountId: string
  displayName: string
  username: string
  avatarUrl: string
  profileUrl: string
  accountType: 'personal' | 'page'
  accessToken: string
  meta: Record<string, unknown>
}

async function fetchAllFacebookAccounts(userAccessToken: string): Promise<FacebookAccount[]> {
  const accounts: FacebookAccount[] = []

  const meRes = await fetch(
    `https://graph.facebook.com/v19.0/me?fields=id,name,picture&access_token=${userAccessToken}`,
  )
  if (meRes.ok) {
    const me = await meRes.json() as { id: string; name: string; picture?: { data?: { url?: string } } }
    accounts.push({
      platformAccountId: me.id,
      displayName: me.name,
      username: me.name,
      avatarUrl: me.picture?.data?.url ?? '',
      profileUrl: `https://www.facebook.com/${me.id}`,
      accountType: 'personal',
      accessToken: userAccessToken,
      meta: {},
    })
  }

  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,category,access_token,picture&access_token=${userAccessToken}`,
  )
  if (pagesRes.ok) {
    const pagesData = await pagesRes.json() as {
      data: Array<{ id: string; name: string; category?: string; access_token: string; picture?: { data?: { url?: string } } }>
    }
    for (const page of pagesData.data ?? []) {
      accounts.push({
        platformAccountId: page.id,
        displayName: page.name,
        username: page.name,
        avatarUrl: page.picture?.data?.url ?? '',
        profileUrl: `https://www.facebook.com/${page.id}`,
        accountType: 'page',
        accessToken: page.access_token,
        meta: { pageCategory: page.category },
      })
    }
  }

  return accounts
}

async function fetchInstagramProfile(accessToken: string, platformAccountId?: string) {
  const targets = Array.from(new Set(['me', platformAccountId].filter(Boolean) as string[]))
  let lastError = ''
  let data: {
    id?: string
    user_id?: string
    username?: string
    account_type?: string
    media_count?: number
  } | null = null
  let resolvedTarget = 'me'

  for (const rawTarget of targets) {
    const target = encodeURIComponent(rawTarget)
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${target}?fields=id,user_id,username,account_type,media_count&access_token=${accessToken}`,
    )
    if (res.ok) {
      data = await res.json() as {
        id?: string
        user_id?: string
        username?: string
        account_type?: string
        media_count?: number
      }
      resolvedTarget = rawTarget
      break
    }
    lastError = await res.text()
  }

  if (!data) {
    if (platformAccountId && lastError.toLowerCase().includes('method type: get')) {
      return {
        platformAccountId,
        displayName: 'Instagram account',
        username: '',
        avatarUrl: '',
        profileUrl: '',
        accountType: 'business' as const,
        meta: { profileLookupSkipped: true, profileLookupError: lastError },
      }
    }
    throw new Error(`Failed to fetch Instagram profile: ${lastError}`)
  }

  const accountId = data.id || data.user_id || platformAccountId
  if (!accountId || accountId === 'unknown') {
    throw new Error('Instagram did not return a usable account id.')
  }
  if (!data.username) {
    throw new Error('Instagram did not return a username for the connected account.')
  }

  // Attempt to fetch optional fields separately so a missing permission doesn't break the whole profile
  let avatarUrl = ''
  let followersCount: number | undefined
  try {
    const extRes = await fetch(
      `https://graph.instagram.com/v21.0/${encodeURIComponent(resolvedTarget)}?fields=profile_picture_url,followers_count&access_token=${accessToken}`,
    )
    if (extRes.ok) {
      const ext = await extRes.json() as { profile_picture_url?: string; followers_count?: number }
      avatarUrl = ext.profile_picture_url ?? ''
      followersCount = ext.followers_count
    }
  } catch { /* optional — ignore */ }

  return {
    platformAccountId: accountId,
    displayName: data.username,
    username: data.username,
    avatarUrl,
    profileUrl: `https://www.instagram.com/${data.username}/`,
    accountType: 'business' as const,
    meta: { accountType: data.account_type, followersCount, mediaCount: data.media_count },
  }
}

interface LinkedInAccount {
  platformAccountId: string
  displayName: string
  username: string
  avatarUrl: string
  profileUrl: string
  accountType: 'personal' | 'page'
  meta: Record<string, unknown>
}

async function fetchAllLinkedInAccounts(accessToken: string): Promise<LinkedInAccount[]> {
  const accounts: LinkedInAccount[] = []
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
    'LinkedIn-Version': '202502',
  }

  const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  let personalUrn = ''
  if (userRes.ok) {
    const user = await userRes.json() as { sub: string; name: string; picture?: string; email?: string }
    personalUrn = `urn:li:person:${user.sub}`
    accounts.push({
      platformAccountId: personalUrn,
      displayName: user.name,
      username: user.email ?? user.sub,
      avatarUrl: user.picture ?? '',
      profileUrl: `https://www.linkedin.com/in/${user.sub}`,
      accountType: 'personal',
      meta: { personUrn: personalUrn, personalEmail: user.email ?? null },
    })
  }

  try {
    // versioned REST API (/rest/ not /v2/) — requires LinkedIn organization admin scope
    const orgAclsRes = await fetch(
      'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=10',
      { headers },
    )
    if (orgAclsRes.ok) {
      const orgAcls = await orgAclsRes.json() as {
        elements?: Array<{ organization?: string; organizationTarget?: string; role: string; state: string }>
      }
      const approvedOrgs = orgAcls.elements ?? []
      for (const org of approvedOrgs) {
        const orgUrn = org.organization ?? org.organizationTarget
        if (!orgUrn) continue
        const orgNumId = orgUrn.split(':').pop()!
        try {
          const orgRes = await fetch(
            `https://api.linkedin.com/rest/organizations/${orgNumId}?fields=id,localizedName,vanityName`,
            { headers },
          )
          if (orgRes.ok) {
            const orgData = await orgRes.json() as { id: number; localizedName: string; vanityName?: string }
            const vanityName = orgData.vanityName ?? String(orgData.id)
            accounts.push({
              platformAccountId: orgUrn,
              displayName: orgData.localizedName,
              username: vanityName,
              avatarUrl: '',
              profileUrl: `https://www.linkedin.com/company/${vanityName}`,
              accountType: 'page',
              meta: { personUrn: orgUrn, personalUrn },
            })
          }
        } catch { /* skip this org */ }
      }
    }
  } catch { /* org fetch failed, personal only */ }

  return accounts
}

async function fetchTwitterProfile(accessToken: string) {
  const res = await fetch(
    'https://api.x.com/2/users/me?user.fields=profile_image_url,public_metrics,description',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) throw new Error(`Failed to fetch Twitter profile: ${await res.text()}`)
  const json = await res.json() as {
    data: {
      id: string
      name: string
      username: string
      profile_image_url?: string
      public_metrics?: { followers_count: number; following_count: number }
    }
  }
  const d = json.data
  return {
    platformAccountId: d.id,
    displayName: d.name,
    username: d.username,
    avatarUrl: d.profile_image_url ?? '',
    profileUrl: `https://x.com/${d.username}`,
    accountType: 'personal' as const,
    meta: {
      followersCount: d.public_metrics?.followers_count,
      followingCount: d.public_metrics?.following_count,
    },
  }
}

async function exchangeThreadsLongLivedToken(
  shortLivedToken: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${clientSecret}&access_token=${shortLivedToken}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Threads long-lived token exchange failed: ${await res.text()}`)
  const data = await res.json() as { access_token: string; token_type: string; expires_in: number }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

async function writePendingAndRedirect(
  options: Array<{
    index: number
    displayName: string
    username: string
    avatarUrl: string
    profileUrl: string
    accountType: 'personal' | 'page'
    platformAccountId: string
    encryptedTokens: {
      accessToken: string
      refreshToken: string | null
      tokenType: string
      expiresAt: Date | null
      iv: string
      tag: string
    }
    platformMeta: Record<string, unknown>
    scopes: string[]
  }>,
  platform: string,
  orgId: string,
  nonce: string,
  redirectUrl: string,
  originUrl: string,
  accountScope: 'org' | 'personal' = 'org',
  ownerUid = '',
): Promise<NextResponse> {
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000))
  const pendingData = {
    nonce,
    orgId,
    platform,
    ...(accountScope === 'personal' ? { accountScope, ownerUid } : {}),
    createdAt: Timestamp.now(),
    expiresAt,
    options: options.map(opt => ({
      ...opt,
      encryptedTokens: {
        ...opt.encryptedTokens,
        expiresAt: opt.encryptedTokens.expiresAt
          ? Timestamp.fromDate(opt.encryptedTokens.expiresAt)
          : null,
      },
    })),
  }
  await adminDb.collection('social_oauth_pending').doc(nonce).set(pendingData)
  const url = new URL(redirectUrl, originUrl)
  url.searchParams.set('picker', nonce)
  url.searchParams.set('platform', platform)
  return NextResponse.redirect(url.toString())
}
