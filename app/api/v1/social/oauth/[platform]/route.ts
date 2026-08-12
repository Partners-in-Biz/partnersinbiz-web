/**
 * OAuth Connect — Initiates the OAuth flow for a social platform.
 *
 * GET /api/v1/social/oauth/{platform}
 * Query: ?redirectUrl=/portal/social/accounts (where to go after callback)
 *
 * Generates a state token, stores it in Firestore, and redirects to the platform auth URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { getOAuthConfig, getClientCredentials, getCallbackUrl } from '@/lib/social/oauth-config'
import { sanitizeOAuthRedirectPath } from '@/lib/social/oauth-redirect'
import type { LinkedInOAuthMode } from '@/lib/social/oauth-config'
import type { SocialPlatformType } from '@/lib/social/providers/types'
import { Timestamp } from 'firebase-admin/firestore'

const PERSONAL_SCOPE = 'personal'

function requestedOrgScope(req: NextRequest): boolean {
  const url = new URL(req.url)
  return Boolean(url.searchParams.get('orgId')?.trim() || req.headers.get('x-org-id')?.trim())
}

function resolveOAuthOrgId(req: NextRequest, user: { activeOrgId?: string }, orgId: string, redirectUrl: string): string {
  if (requestedOrgScope(req)) return orgId
  if (redirectUrl.startsWith('/portal') && user.activeOrgId) return user.activeOrgId
  return orgId
}

export const GET = withAuth('client', withTenant(async (req: NextRequest, user, orgId) => {
  const url = new URL(req.url)
  const rawPlatform = url.pathname.split('/').slice(-1)[0]
  const platform = (rawPlatform === 'x' ? 'twitter' : rawPlatform) as SocialPlatformType
  const redirectUrl = sanitizeOAuthRedirectPath(url.searchParams.get('redirectUrl') ?? '/portal/social')
  const oauthOrgId = resolveOAuthOrgId(req, user, orgId, redirectUrl)
  const accountScope = url.searchParams.get('scope') === PERSONAL_SCOPE ? PERSONAL_SCOPE : 'org'
  const requestedLinkedInMode = url.searchParams.get('linkedinMode')
  const linkedinMode: LinkedInOAuthMode =
    platform !== 'linkedin'
      ? 'personal'
      : requestedLinkedInMode === 'personal'
        ? 'personal'
        : requestedLinkedInMode === 'organization' || accountScope === 'org'
          ? 'organization'
          : 'personal'
  const feature = url.searchParams.get('feature') === 'youtube_studio' ? 'youtube_studio' : undefined
  const rawPrompt = url.searchParams.get('prompt')
  const requestedPrompt = rawPrompt === 'select_account' || rawPrompt === 'consent' ? rawPrompt : undefined

  // Special handling for non-OAuth platforms
  if (platform === 'bluesky') {
    return apiError('Bluesky uses app passwords, not OAuth. Use the account creation endpoint directly.', 400)
  }

  const config = getOAuthConfig(platform, { linkedinMode })
  if (!config) {
    return apiError(`OAuth not supported for platform: ${platform}`, 400)
  }

  const creds = getClientCredentials(platform, { linkedinMode })
  if (!creds) {
    const envHint = platform === 'linkedin' && linkedinMode === 'personal'
      ? 'Set LINKEDIN_PERSONAL_CLIENT_ID and LINKEDIN_PERSONAL_CLIENT_SECRET.'
      : `Set ${platform.toUpperCase()}_CLIENT_ID and ${platform.toUpperCase()}_CLIENT_SECRET.`
    return apiError(`Missing client credentials for ${platform}. ${envHint}`, 500)
  }

  // Generate state token
  const nonce = crypto.randomBytes(16).toString('hex')
  const stateData = {
    orgId: oauthOrgId,
    platform,
    nonce,
    redirectUrl,
    accountScope,
    ownerUid: user.uid,
    ...(platform === 'linkedin' ? { linkedinMode } : {}),
    ...(feature ? { feature } : {}),
  }
  const stateToken = Buffer.from(JSON.stringify(stateData)).toString('base64url')

  // Generate PKCE code_verifier if platform requires it
  let codeVerifier: string | null = null
  if (config.usePKCE) {
    codeVerifier = crypto.randomBytes(32).toString('base64url')
  }

  // Store state in Firestore with 10-minute TTL
  await adminDb.collection('social_oauth_states').doc(nonce).set({
    orgId: oauthOrgId,
    platform,
    nonce,
    redirectUrl,
    accountScope,
    ownerUid: user.uid,
    ...(feature ? { feature } : {}),
    ...(platform === 'linkedin' ? { linkedinMode } : {}),
    ...(codeVerifier ? { codeVerifier } : {}),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
    createdAt: Timestamp.now(),
  })

  // Build authorization URL
  const callbackUrl = getCallbackUrl(platform)
  // TikTok uses 'client_key' in the auth URL, all other platforms use 'client_id'
  const clientIdParam = platform === 'tiktok' ? 'client_key' : 'client_id'
  const authParams = new URLSearchParams({
    [clientIdParam]: creds.clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state: stateToken,
    ...config.extraAuthParams,
  })

  if (requestedPrompt) {
    const promptParts = new Set([
      ...(authParams.get('prompt')?.split(/\s+/).filter(Boolean) ?? []),
      requestedPrompt,
    ])
    authParams.set('prompt', Array.from(promptParts).join(' '))
  }

  // Add PKCE challenge if required
  if (codeVerifier) {
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url')
    authParams.set('code_challenge', codeChallenge)
    authParams.set('code_challenge_method', 'S256')
  }

  const authUrl = `${config.authUrl}?${authParams.toString()}`
  return NextResponse.redirect(authUrl)
}))
