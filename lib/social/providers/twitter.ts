/**
 * Twitter (X) Provider — OAuth 1.0a implementation.
 *
 * Migrated from lib/social/twitter.ts into the provider pattern.
 * Supports single tweets, threads, and deletion.
 */
import crypto from 'crypto'
import { SocialProvider, type ProviderCredentials, type PublishOptions } from './base'
import type { PublishResult, ProfileInfo } from './types'

const TWEETS_URL = 'https://api.twitter.com/2/tweets'
const USERS_ME_URL = 'https://api.twitter.com/2/users/me'

// RFC 3986 percent-encoding
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function buildOAuthHeader(
  method: string,
  url: string,
  apiKey: string,
  apiKeySecret: string,
  accessToken: string,
  accessTokenSecret: string,
  bodyParams?: Record<string, string>,
): string {
  const urlObj = new URL(url)
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`
  const urlQueryParams: Record<string, string> = {}
  urlObj.searchParams.forEach((value, key) => {
    urlQueryParams[key] = value
  })

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  }

  const allParams: Record<string, string> = { ...urlQueryParams, ...oauthParams, ...(bodyParams ?? {}) }

  const encodedPairs = Object.entries(allParams)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(encodedPairs),
  ].join('&')

  const signingKey = `${percentEncode(apiKeySecret)}&${percentEncode(accessTokenSecret)}`
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')

  const signedOAuthParams: Record<string, string> = {
    ...oauthParams,
    oauth_signature: signature,
  }

  const headerParts = Object.entries(signedOAuthParams)
    .map(([k, v]) => `${k}="${percentEncode(v)}"`)
    .join(', ')

  return `OAuth ${headerParts}`
}

export class TwitterProvider extends SocialProvider {
  /** true when using OAuth 2.0 Bearer token (user-linked accounts) */
  private useOAuth2: boolean

  constructor(credentials: ProviderCredentials) {
    super('twitter', credentials)
    // OAuth 2.0 mode: only accessToken required (Bearer token)
    // OAuth 1.0a mode: apiKey, apiKeySecret, accessToken, accessTokenSecret all required
    this.useOAuth2 = !credentials.apiKey || !credentials.apiKeySecret || !credentials.accessTokenSecret
    if (!this.useOAuth2) {
      if (!credentials.accessTokenSecret) throw new Error('TwitterProvider OAuth 1.0a requires accessTokenSecret')
    }
    if (!credentials.accessToken) throw new Error('TwitterProvider requires accessToken')
  }

  /** Create from environment variables (for the default account — OAuth 1.0a) */
  static fromEnv(): TwitterProvider {
    const apiKey = process.env.X_API_KEY
    const apiKeySecret = process.env.X_API_KEY_SECRET
    const accessToken = process.env.X_ACCESS_TOKEN
    const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET
    if (!apiKey) throw new Error('Missing env var: X_API_KEY')
    if (!apiKeySecret) throw new Error('Missing env var: X_API_KEY_SECRET')
    if (!accessToken) throw new Error('Missing env var: X_ACCESS_TOKEN')
    if (!accessTokenSecret) throw new Error('Missing env var: X_ACCESS_TOKEN_SECRET')
    return new TwitterProvider({ apiKey, apiKeySecret, accessToken, accessTokenSecret })
  }

  private getAuthHeader(method: string, url: string, bodyParams?: Record<string, string>): string {
    if (this.useOAuth2) {
      return `Bearer ${this.credentials.accessToken}`
    }
    return buildOAuthHeader(
      method,
      url,
      this.credentials.apiKey!,
      this.credentials.apiKeySecret!,
      this.credentials.accessToken,
      this.credentials.accessTokenSecret!,
      bodyParams,
    )
  }

  private guessMimeType(url: string): string {
    const lower = url.toLowerCase().split('?')[0]
    if (lower.endsWith('.mp4')) return 'video/mp4'
    if (lower.endsWith('.mov')) return 'video/quicktime'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.webp')) return 'image/webp'
    return 'image/jpeg'
  }

  private ensureMediaUploadSupported(): void {
    if (this.useOAuth2) {
      throw new Error('Twitter/X media upload requires OAuth 1.0a credentials or an OAuth 2 token with media upload support. Text-only publishing can continue, but media posts need the account connection/app scopes reviewed before retrying.')
    }
  }

  private async uploadImageFromUrl(imageUrl: string, mimeType: string): Promise<string> {
    this.ensureMediaUploadSupported()
    const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json'
    const res = await fetch(imageUrl)
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())

    const form = new FormData()
    form.append('media', new Blob([buffer], { type: mimeType }), 'media')

    const uploadRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: this.getAuthHeader('POST', UPLOAD_URL) },
      body: form,
    })
    if (!uploadRes.ok) throw new Error(`Twitter media upload error ${uploadRes.status}: ${await uploadRes.text()}`)
    const json = await uploadRes.json() as { media_id_string: string }
    return json.media_id_string
  }

  private async uploadVideoFromUrl(videoUrl: string, mimeType: string): Promise<string> {
    this.ensureMediaUploadSupported()
    const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json'
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`Failed to download video: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())

    const initParams: Record<string, string> = {
      command: 'INIT',
      media_type: mimeType,
      total_bytes: buffer.length.toString(),
      media_category: 'tweet_video',
    }
    const initRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader('POST', UPLOAD_URL, initParams),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(initParams).toString(),
    })
    if (!initRes.ok) throw new Error(`Twitter video INIT error ${initRes.status}: ${await initRes.text()}`)
    const initJson = await initRes.json() as { media_id_string: string }
    const mediaId = initJson.media_id_string

    const appendForm = new FormData()
    appendForm.append('command', 'APPEND')
    appendForm.append('media_id', mediaId)
    appendForm.append('segment_index', '0')
    appendForm.append('media', new Blob([buffer], { type: mimeType }), 'media')
    const appendRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: this.getAuthHeader('POST', UPLOAD_URL) },
      body: appendForm,
    })
    if (!appendRes.ok && appendRes.status !== 204) {
      throw new Error(`Twitter video APPEND error ${appendRes.status}: ${await appendRes.text()}`)
    }

    const finalizeParams: Record<string, string> = { command: 'FINALIZE', media_id: mediaId }
    const finalizeRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: this.getAuthHeader('POST', UPLOAD_URL, finalizeParams),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(finalizeParams).toString(),
    })
    if (!finalizeRes.ok) throw new Error(`Twitter video FINALIZE error ${finalizeRes.status}: ${await finalizeRes.text()}`)
    const finalizeJson = await finalizeRes.json() as {
      media_id_string: string
      processing_info?: { state: string; check_after_secs?: number }
    }

    if (finalizeJson.processing_info?.state === 'pending' || finalizeJson.processing_info?.state === 'in_progress') {
      await this.pollMediaStatus(mediaId, finalizeJson.processing_info.check_after_secs ?? 5)
    }

    return mediaId
  }

  private async pollMediaStatus(mediaId: string, waitSecs: number, attemptsLeft = 20): Promise<void> {
    if (attemptsLeft <= 0) throw new Error(`Twitter video processing timed out for media_id: ${mediaId}`)
    await new Promise(r => setTimeout(r, waitSecs * 1000))
    const STATUS_URL = `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`
    const res = await fetch(STATUS_URL, { headers: { Authorization: this.getAuthHeader('GET', STATUS_URL) } })
    if (!res.ok) return
    const json = await res.json() as { processing_info?: { state: string; check_after_secs?: number } }
    const state = json.processing_info?.state
    if (state === 'failed') throw new Error(`Twitter video processing failed for media_id: ${mediaId}`)
    if (state === 'pending' || state === 'in_progress') {
      await this.pollMediaStatus(mediaId, json.processing_info?.check_after_secs ?? 5, attemptsLeft - 1)
    }
  }

  async publishPost(options: PublishOptions): Promise<PublishResult> {
    if (options.threadParts && options.threadParts.length > 0) {
      const results = await this.publishThread(options.threadParts, options.mediaUrls)
      return results[0]
    }

    // Upload media to Twitter and collect media_ids
    const mediaIds: string[] = []
    if (options.mediaUrls && options.mediaUrls.length > 0) {
      for (const url of options.mediaUrls.slice(0, 4)) {
        const mimeType = this.guessMimeType(url)
        const mediaId = mimeType.startsWith('video/')
          ? await this.uploadVideoFromUrl(url, mimeType)
          : await this.uploadImageFromUrl(url, mimeType)
        mediaIds.push(mediaId)
      }
    }

    const authHeader = this.getAuthHeader('POST', TWEETS_URL)
    const bodyObj: Record<string, unknown> = { text: options.text }
    if (options.replyToId) {
      bodyObj.reply = { in_reply_to_tweet_id: options.replyToId }
    }
    if (mediaIds.length > 0) {
      bodyObj.media = { media_ids: mediaIds }
    }

    const response = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Twitter API error ${response.status}: ${text}`)
    }

    const json = await response.json() as { data: { id: string } }
    if (!json?.data?.id) throw new Error('Twitter API returned unexpected response: ' + JSON.stringify(json))

    return {
      platformPostId: json.data.id,
      platformPostUrl: `https://x.com/i/status/${json.data.id}`,
    }
  }

  async publishThread(parts: string[], mediaUrls?: string[]): Promise<PublishResult[]> {
    if (parts.length === 0) throw new Error('publishThread requires at least one part')
    const results: PublishResult[] = []
    for (let i = 0; i < parts.length; i++) {
      const result = await this.publishPost({
        text: parts[i],
        replyToId: results[results.length - 1]?.platformPostId,
        mediaUrls: i === 0 ? mediaUrls : undefined,
      })
      results.push(result)
    }
    return results
  }

  async deletePost(platformPostId: string): Promise<void> {
    const url = `${TWEETS_URL}/${platformPostId}`
    const authHeader = this.getAuthHeader('DELETE', url)
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Twitter API delete error ${response.status}: ${text}`)
    }
  }

  async getProfile(): Promise<ProfileInfo> {
    const url = `${USERS_ME_URL}?user.fields=profile_image_url,public_metrics,description`
    const authHeader = this.getAuthHeader('GET', url)
    const response = await fetch(url, {
      headers: { Authorization: authHeader },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Twitter API error ${response.status}: ${text}`)
    }
    const json = await response.json() as {
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
      accountType: 'personal',
      followerCount: d.public_metrics?.followers_count,
      followingCount: d.public_metrics?.following_count,
    }
  }

  async validateCredentials(): Promise<boolean> {
    try {
      await this.getProfile()
      return true
    } catch {
      return false
    }
  }

  async refreshToken(): Promise<ProviderCredentials | null> {
    // OAuth 1.0a tokens don't expire — no refresh needed
    if (!this.useOAuth2) return null

    // OAuth 2.0: refresh using refresh_token grant
    const refreshToken = this.credentials.refreshToken
    if (!refreshToken) return null

    const clientId = process.env.TWITTER_CLIENT_ID?.trim()
    const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) return null

    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    })

    if (!res.ok) return null
    const data = await res.json() as { access_token: string; refresh_token?: string }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
    }
  }
}
