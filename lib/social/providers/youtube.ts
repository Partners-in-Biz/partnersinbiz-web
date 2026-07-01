/**
 * YouTube Provider — OAuth 2.0 implementation using YouTube Data API v3.
 *
 * Supports video uploads (resumable), community posts (text), and channel info.
 * YouTube is video-first, so publishPost handles both text-only (community) and
 * video uploads depending on whether mediaUrls are provided.
 */
import { SocialProvider, type ProviderCredentials, type PublishOptions } from './base'
import type { PublishResult, ProfileInfo } from './types'

const YOUTUBE_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos'
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'

export class YouTubeProvider extends SocialProvider {
  constructor(credentials: ProviderCredentials) {
    super('youtube', credentials)
    if (!credentials.accessToken) throw new Error('YouTubeProvider requires accessToken')
  }

  /** Create from environment variables (for the default account) */
  static fromEnv(): YouTubeProvider {
    const accessToken = process.env.YOUTUBE_ACCESS_TOKEN
    if (!accessToken) throw new Error('Missing env var: YOUTUBE_ACCESS_TOKEN')
    return new YouTubeProvider({
      accessToken,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    })
  }

  /**
   * Publish a video to YouTube.
   *
   * If mediaUrls are provided, the first one is assumed to be a video URL.
   * The text is used as the description, and title from options (or first line of text).
   * If no media, creates a community post (text-only) — note: community posts
   * require the channel to have 500+ subscribers.
   */
  async publishPost(options: PublishOptions): Promise<PublishResult> {
    if (options.mediaUrls && options.mediaUrls.length > 0) {
      return this.uploadVideo(options)
    }
    // For text-only, we still create a "private" video with just metadata
    // or use the community post API. Community posts are limited, so we
    // default to creating a short/video upload flow.
    // For now, text-only posts return an error guiding the user.
    throw new Error(
      'YouTube requires a video file to publish. Text-only community posts require 500+ subscribers and are not yet supported.'
    )
  }

  /**
   * Upload a video using the YouTube Data API v3 resumable upload flow.
   * For PIB, the video is typically already hosted (URL). We fetch it first,
   * then upload to YouTube.
   */
  private async uploadVideo(options: PublishOptions): Promise<PublishResult> {
    const title = options.title || options.text.split('\n')[0].slice(0, 100) || 'Untitled'
    const description = options.text || ''
    const tags = options.tags?.length
      ? options.tags
      : (description.match(/#(\w+)/g) ?? []).map(t => t.slice(1))
    const privacyStatus = options.privacyStatus ?? options.targetVisibility ?? 'private'

    // Step 1: Initiate resumable upload
    const metadata = {
      snippet: {
        title,
        description,
        tags,
        categoryId: options.categoryId ?? '22', // "People & Blogs" — sensible default
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: options.selfDeclaredMadeForKids ?? false,
        ...(options.publishAt ? { publishAt: options.publishAt } : {}),
      },
    }

    const initResponse = await fetch(
      `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credentials.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(metadata),
      }
    )

    if (!initResponse.ok) {
      const text = await initResponse.text()
      throw new Error(`YouTube upload init error ${initResponse.status}: ${text}`)
    }

    const uploadUrl = initResponse.headers.get('location')
    if (!uploadUrl) throw new Error('YouTube API did not return an upload URL')

    // Step 2: Fetch the video from our media URL
    const videoUrl = options.mediaUrls![0]
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video from ${videoUrl}: ${videoResponse.status}`)
    }
    const videoBuffer = await videoResponse.arrayBuffer()

    // Step 3: Upload the video bytes
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/*',
        'Content-Length': String(videoBuffer.byteLength),
      },
      body: videoBuffer,
    })

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text()
      throw new Error(`YouTube upload error ${uploadResponse.status}: ${text}`)
    }

    const result = await uploadResponse.json() as { id: string }
    if (!result?.id) throw new Error('YouTube API returned unexpected response: ' + JSON.stringify(result))

    return {
      platformPostId: result.id,
      platformPostUrl: `https://www.youtube.com/watch?v=${result.id}`,
    }
  }

  async deletePost(platformPostId: string): Promise<void> {
    const url = `${YOUTUBE_VIDEOS_URL}?id=${platformPostId}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
      },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`YouTube API delete error ${response.status}: ${text}`)
    }
  }

  async getProfile(): Promise<ProfileInfo> {
    const url = `${YOUTUBE_CHANNELS_URL}?part=snippet,statistics&mine=true`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`YouTube API error ${response.status}: ${text}`)
    }

    const json = await response.json() as {
      items: Array<{
        id: string
        snippet: {
          title: string
          customUrl?: string
          thumbnails?: { default?: { url: string } }
        }
        statistics?: {
          subscriberCount?: string
          videoCount?: string
        }
      }>
    }

    const channel = json.items?.[0]
    if (!channel) throw new Error('No YouTube channel found for this account')

    const handle = channel.snippet.customUrl ?? channel.id
    return {
      platformAccountId: channel.id,
      displayName: channel.snippet.title,
      username: handle,
      avatarUrl: channel.snippet.thumbnails?.default?.url ?? '',
      profileUrl: `https://www.youtube.com/${handle.startsWith('@') ? handle : `channel/${channel.id}`}`,
      accountType: 'personal',
      followerCount: channel.statistics?.subscriberCount
        ? parseInt(channel.statistics.subscriberCount, 10)
        : undefined,
      meta: {
        videoCount: channel.statistics?.videoCount,
      },
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
    if (!this.credentials.refreshToken) return null

    const clientId = process.env.YOUTUBE_CLIENT_ID?.trim()
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim()
    if (!clientId || !clientSecret) return null

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) return null

    const data = await response.json() as {
      access_token: string
      expires_in: number
      token_type: string
    }

    const newCredentials: ProviderCredentials = {
      ...this.credentials,
      accessToken: data.access_token,
    }
    this.credentials = newCredentials
    return newCredentials
  }
}
