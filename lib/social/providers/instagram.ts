/**
 * Instagram Provider — Instagram Business Login API.
 *
 * Uses the Instagram Graph API (graph.instagram.com v21.0) for publishing,
 * profile retrieval, and analytics. Publishing uses a 2-step container API:
 * create container, then publish container.
 */
import { SocialProvider, type ProviderCredentials, type PublishOptions } from './base'
import type { PublishResult, ProfileInfo, AnalyticsData } from './types'

const GRAPH_API_BASE = 'https://graph.instagram.com/v21.0'

export class InstagramProvider extends SocialProvider {
  private igUserId: string

  constructor(credentials: ProviderCredentials) {
    super('instagram', credentials)
    if (!credentials.accessToken) throw new Error('InstagramProvider requires accessToken')
    if (!credentials.personUrn) throw new Error('InstagramProvider requires personUrn (Instagram business account ID)')
    this.igUserId = credentials.personUrn
  }

  /** Create from environment variables (for the default account) */
  static fromEnv(): InstagramProvider {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN
    const personUrn = process.env.INSTAGRAM_USER_ID
    if (!accessToken) throw new Error('Missing env var: INSTAGRAM_ACCESS_TOKEN')
    if (!personUrn) throw new Error('Missing env var: INSTAGRAM_USER_ID')
    return new InstagramProvider({ accessToken, personUrn })
  }

  async publishPost(options: PublishOptions): Promise<PublishResult> {
    const { text, mediaUrls } = options

    // Instagram requires media — text-only posts are not supported
    if (!mediaUrls || mediaUrls.length === 0) {
      throw new Error('Instagram requires at least one image or video. Text-only posts are not supported.')
    }

    // Carousel: multiple media items
    if (mediaUrls.length > 1) {
      return this.publishCarousel(text, mediaUrls)
    }

    // Single media post
    const mediaUrl = mediaUrls[0]
    const isVideo = this.isVideoUrl(mediaUrl)

    // Step 1: Create media container.
    // Meta's Instagram endpoints are more reliable with form-encoded POST bodies
    // than JSON bodies, especially through graph.instagram.com.
    const containerBody = new URLSearchParams({
      caption: text,
      access_token: this.credentials.accessToken,
    })

    if (isVideo) {
      containerBody.set('video_url', mediaUrl)
      containerBody.set('media_type', 'REELS')
    } else {
      containerBody.set('image_url', mediaUrl)
    }

    const containerResponse = await fetch(`${GRAPH_API_BASE}/${this.igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: containerBody.toString(),
    })

    if (!containerResponse.ok) {
      const errText = await containerResponse.text()
      throw new Error(`Instagram API error ${containerResponse.status}: ${errText}`)
    }

    const containerJson = await containerResponse.json() as { id: string }
    if (!containerJson?.id) throw new Error('Instagram API returned unexpected response: ' + JSON.stringify(containerJson))

    // Step 2: Publish the container
    const mediaId = await this.publishContainer(containerJson.id)

    return {
      platformPostId: mediaId,
      platformPostUrl: `https://www.instagram.com/p/${mediaId}/`,
    }
  }

  private async publishCarousel(text: string, mediaUrls: string[]): Promise<PublishResult> {
    // Step 1: Create item containers for each media
    const childIds: string[] = []

    for (const mediaUrl of mediaUrls) {
      const isVideo = this.isVideoUrl(mediaUrl)
      const itemBody = new URLSearchParams({
        is_carousel_item: 'true',
        access_token: this.credentials.accessToken,
      })

      if (isVideo) {
        itemBody.set('video_url', mediaUrl)
        itemBody.set('media_type', 'VIDEO')
      } else {
        itemBody.set('image_url', mediaUrl)
      }

      const itemResponse = await fetch(`${GRAPH_API_BASE}/${this.igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: itemBody.toString(),
      })

      if (!itemResponse.ok) {
        const errText = await itemResponse.text()
        throw new Error(`Instagram API carousel item error ${itemResponse.status}: ${errText}`)
      }

      const itemJson = await itemResponse.json() as { id: string }
      if (!itemJson?.id) throw new Error('Instagram API returned unexpected carousel item response: ' + JSON.stringify(itemJson))
      childIds.push(itemJson.id)
    }

    // Step 2: Create carousel container
    const carouselResponse = await fetch(`${GRAPH_API_BASE}/${this.igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        media_type: 'CAROUSEL',
        caption: text,
        children: childIds.join(','),
        access_token: this.credentials.accessToken,
      }).toString(),
    })

    if (!carouselResponse.ok) {
      const errText = await carouselResponse.text()
      throw new Error(`Instagram API carousel error ${carouselResponse.status}: ${errText}`)
    }

    const carouselJson = await carouselResponse.json() as { id: string }
    if (!carouselJson?.id) throw new Error('Instagram API returned unexpected carousel response: ' + JSON.stringify(carouselJson))

    // Step 3: Publish the carousel container
    const mediaId = await this.publishContainer(carouselJson.id)

    return {
      platformPostId: mediaId,
      platformPostUrl: `https://www.instagram.com/p/${mediaId}/`,
    }
  }

  private async publishContainer(containerId: string): Promise<string> {
    const publishResponse = await fetch(`${GRAPH_API_BASE}/${this.igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: containerId,
        access_token: this.credentials.accessToken,
      }).toString(),
    })

    if (!publishResponse.ok) {
      const errText = await publishResponse.text()
      throw new Error(`Instagram API publish error ${publishResponse.status}: ${errText}`)
    }

    const publishJson = await publishResponse.json() as { id: string }
    if (!publishJson?.id) throw new Error('Instagram API returned unexpected publish response: ' + JSON.stringify(publishJson))

    return publishJson.id
  }

  private isVideoUrl(url: string): boolean {
    const lower = url.toLowerCase()
    return lower.includes('.mp4') || lower.includes('.mov') || lower.includes('.avi') || lower.includes('video')
  }

  async deletePost(): Promise<void> {
    throw new Error('Instagram does not support post deletion via API')
  }

  async getProfile(): Promise<ProfileInfo> {
    const url = `${GRAPH_API_BASE}/${this.igUserId}?fields=id,username,name,profile_picture_url,followers_count,media_count&access_token=${this.credentials.accessToken}`
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Instagram API error ${response.status}: ${text}`)
    }

    const data = await response.json() as {
      id: string
      username: string
      name: string
      profile_picture_url?: string
      followers_count?: number
      media_count?: number
    }

    return {
      platformAccountId: data.id,
      displayName: data.name,
      username: data.username,
      avatarUrl: data.profile_picture_url ?? '',
      profileUrl: `https://www.instagram.com/${data.username}`,
      accountType: 'business',
      followerCount: data.followers_count,
      meta: { mediaCount: data.media_count },
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
    // Instagram Business Login long-lived tokens are refreshed directly (no app secret needed)
    // Tokens must be refreshed within 60 days of last refresh
    const url = `${GRAPH_API_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${this.credentials.accessToken}`
    const response = await fetch(url)

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Instagram token refresh error ${response.status}: ${text}`)
    }

    const data = await response.json() as { access_token: string; token_type: string; expires_in?: number }

    return {
      accessToken: data.access_token,
      personUrn: this.igUserId,
      apiKey: this.credentials.apiKey,
      apiKeySecret: this.credentials.apiKeySecret,
    }
  }

  async getAnalytics(platformPostId: string): Promise<AnalyticsData | null> {
    const url = `${GRAPH_API_BASE}/${platformPostId}/insights?metric=impressions,reach,engagement,saved&access_token=${this.credentials.accessToken}`
    const response = await fetch(url)

    if (!response.ok) {
      // Analytics may not be available for all post types
      return null
    }

    const json = await response.json() as {
      data: Array<{ name: string; values: Array<{ value: number }> }>
    }

    const metrics: Record<string, number> = {}
    for (const entry of json.data ?? []) {
      metrics[entry.name] = entry.values?.[0]?.value ?? 0
    }

    return {
      impressions: metrics.impressions ?? 0,
      reach: metrics.reach ?? 0,
      engagements: metrics.engagement ?? 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: metrics.saved ?? 0,
      clicks: 0,
    }
  }
}
