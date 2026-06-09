/**
 * OAuth Configuration — Per-platform OAuth URLs, scopes, and token exchange logic.
 */
import type { SocialPlatformType } from './providers/types'

export type LinkedInOAuthMode = 'personal' | 'organization'

export interface OAuthConfig {
  platform: SocialPlatformType
  authUrl: string
  tokenUrl: string
  scopes: string[]
  /** Whether to use Basic auth for token exchange (Reddit, Pinterest, Twitter OAuth 2.0) */
  useBasicAuth?: boolean
  /** Whether to use PKCE (Twitter OAuth 2.0) */
  usePKCE?: boolean
  /** Extra params for the auth URL */
  extraAuthParams?: Record<string, string>
}

interface OAuthOptions {
  linkedinMode?: LinkedInOAuthMode
}

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export function getCallbackUrl(platform: SocialPlatformType): string {
  return `${getAppUrl()}/api/v1/social/oauth/${platform}/callback`
}

export function getOAuthConfig(platform: SocialPlatformType, options: OAuthOptions = {}): OAuthConfig | null {
  switch (platform) {
    case 'facebook':
      return {
        platform: 'facebook',
        authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
        tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
        scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'instagram_basic', 'instagram_content_publish'],
      }
    case 'instagram':
      return {
        platform: 'instagram',
        authUrl: 'https://www.instagram.com/oauth/authorize',
        tokenUrl: 'https://api.instagram.com/oauth/access_token',
        scopes: ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
        extraAuthParams: { enable_fb_login: '0', force_reauth: 'true' },
      }
    case 'linkedin':
      if (options.linkedinMode === 'organization') {
        return {
          platform: 'linkedin',
          authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
          tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
          // Dedicated Community Management API app for company-page posting.
          scopes: ['rw_organization_admin', 'w_organization_social_feed'],
        }
      }
      return {
        platform: 'linkedin',
        authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
        scopes: ['w_member_social', 'openid', 'profile'],
      }
    case 'reddit':
      return {
        platform: 'reddit',
        authUrl: 'https://www.reddit.com/api/v1/authorize',
        tokenUrl: 'https://www.reddit.com/api/v1/access_token',
        scopes: ['submit', 'identity', 'read'],
        useBasicAuth: true,
        extraAuthParams: { duration: 'permanent' },
      }
    case 'tiktok':
      return {
        platform: 'tiktok',
        authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
        tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
        scopes: ['user.info.basic', 'video.upload', 'video.publish'],
      }
    case 'pinterest':
      return {
        platform: 'pinterest',
        authUrl: 'https://www.pinterest.com/oauth/',
        tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
        scopes: ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'],
        useBasicAuth: true,
      }
    case 'threads':
      return {
        platform: 'threads',
        authUrl: 'https://threads.net/oauth/authorize',
        tokenUrl: 'https://graph.threads.net/oauth/access_token',
        scopes: ['threads_basic', 'threads_content_publish', 'threads_manage_replies'],
      }
    case 'youtube':
      return {
        platform: 'youtube',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: [
          'https://www.googleapis.com/auth/youtube.upload',
          'https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/yt-analytics.readonly',
          'https://www.googleapis.com/auth/youtube.force-ssl',
        ],
        extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      }
    case 'twitter':
      return {
        platform: 'twitter',
        authUrl: 'https://twitter.com/i/oauth2/authorize',
        tokenUrl: 'https://api.x.com/2/oauth2/token',
        scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
        useBasicAuth: true,
        usePKCE: true,
      }
    case 'bluesky':
      // Bluesky uses app passwords — no OAuth
      return null
    case 'mastodon': {
      // Mastodon is instance-specific; use env var for default instance
      const instanceUrl = process.env.MASTODON_INSTANCE_URL || 'https://mastodon.social'
      return {
        platform: 'mastodon',
        authUrl: `${instanceUrl}/oauth/authorize`,
        tokenUrl: `${instanceUrl}/oauth/token`,
        scopes: ['read', 'write', 'follow'],
      }
    }
    case 'dribbble':
      return {
        platform: 'dribbble',
        authUrl: 'https://dribbble.com/oauth/authorize',
        tokenUrl: 'https://dribbble.com/oauth/token',
        scopes: ['public', 'upload'],
      }
    default:
      return null
  }
}

/**
 * Get the client credentials (client_id, client_secret) for a platform from env.
 */
export function getClientCredentials(platform: SocialPlatformType, options: OAuthOptions = {}): { clientId: string; clientSecret: string } | null {
  // Twitter OAuth 2.0 uses TWITTER_CLIENT_ID / TWITTER_CLIENT_SECRET
  if (platform === 'twitter') {
    const clientId = process.env.TWITTER_CLIENT_ID?.trim()
    const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret }
  }
  // TikTok uses CLIENT_KEY naming convention instead of CLIENT_ID
  if (platform === 'tiktok') {
    const clientId = process.env.TIKTOK_CLIENT_KEY?.trim()
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret }
  }
  if (platform === 'linkedin') {
    if (options.linkedinMode === 'organization') {
      const clientId = process.env.LINKEDIN_ORGANIZATION_CLIENT_ID?.trim() ?? process.env.LINKEDIN_CLIENT_ID?.trim()
      const clientSecret = process.env.LINKEDIN_ORGANIZATION_CLIENT_SECRET?.trim() ?? process.env.LINKEDIN_CLIENT_SECRET?.trim()
      if (!clientId || !clientSecret) return null
      return { clientId, clientSecret }
    }

    const clientId = process.env.LINKEDIN_PERSONAL_CLIENT_ID?.trim()
    const clientSecret = process.env.LINKEDIN_PERSONAL_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) return null
    return { clientId, clientSecret }
  }
const prefix = platform.toUpperCase()
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim()
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}
