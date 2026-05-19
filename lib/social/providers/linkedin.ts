/**
 * LinkedIn Provider — OAuth 2.0 Bearer token implementation.
 *
 * Migrated from lib/social/linkedin.ts into the provider pattern.
 * Supports text posts and profile retrieval.
 */
import { SocialProvider, type ProviderCredentials, type PublishOptions } from './base'
import type { PublishResult, ProfileInfo } from './types'

const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts'
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo'

export class LinkedInProvider extends SocialProvider {
  constructor(credentials: ProviderCredentials) {
    super('linkedin', credentials)
    if (!credentials.accessToken) throw new Error('LinkedInProvider requires accessToken')
    if (!credentials.personUrn) throw new Error('LinkedInProvider requires personUrn')
    if (!credentials.personUrn.startsWith('urn:li:person:') && !credentials.personUrn.startsWith('urn:li:organization:')) {
      throw new Error('personUrn must be urn:li:person:XXXX or urn:li:organization:XXXX')
    }
  }

  /** Create from environment variables (for the default account) */
  static fromEnv(): LinkedInProvider {
    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN
    const personUrn = process.env.LINKEDIN_PERSON_URN
    if (!accessToken) throw new Error('Missing env var: LINKEDIN_ACCESS_TOKEN')
    if (!personUrn) throw new Error('Missing env var: LINKEDIN_PERSON_URN')
    return new LinkedInProvider({ accessToken, personUrn })
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

  private async uploadImageFromUrl(imageUrl: string): Promise<string> {
    const res = await fetch(imageUrl)
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type') ?? 'image/jpeg'

    const headers = {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202502',
    }

    const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
      method: 'POST',
      headers,
      body: JSON.stringify({ initializeUploadRequest: { owner: this.credentials.personUrn } }),
    })
    if (!initRes.ok) throw new Error(`LinkedIn image initializeUpload error ${initRes.status}: ${await initRes.text()}`)
    const initJson = await initRes.json() as { value: { uploadUrl: string; image: string } }

    const uploadRes = await fetch(initJson.value.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: buffer,
    })
    if (!uploadRes.ok) throw new Error(`LinkedIn image PUT error ${uploadRes.status}: ${await uploadRes.text()}`)

    return initJson.value.image
  }

  private async uploadVideoFromUrl(videoUrl: string): Promise<string> {
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`Failed to download video: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const mimeType = res.headers.get('content-type') ?? 'video/mp4'

    const headers = {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202502',
    }

    const initRes = await fetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: this.credentials.personUrn,
          fileSizeBytes: buffer.length,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      }),
    })
    if (!initRes.ok) throw new Error(`LinkedIn video initializeUpload error ${initRes.status}: ${await initRes.text()}`)
    const initJson = await initRes.json() as {
      value: {
        uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>
        video: string
        uploadToken: string
      }
    }

    const uploadedPartIds: string[] = []
    for (const instruction of initJson.value.uploadInstructions) {
      const chunk = buffer.subarray(instruction.firstByte, instruction.lastByte + 1)
      const chunkRes = await fetch(instruction.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: chunk,
      })
      if (!chunkRes.ok) throw new Error(`LinkedIn video chunk PUT error ${chunkRes.status}: ${await chunkRes.text()}`)
      const etag = chunkRes.headers.get('etag') ?? chunkRes.headers.get('x-amz-etag')
      if (etag) uploadedPartIds.push(etag.replace(/"/g, ''))
    }

    const videoUrn = initJson.value.video
    const finalizeRes = await fetch(`https://api.linkedin.com/rest/videos/${encodeURIComponent(videoUrn)}?action=finalizeUpload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ finalizeUploadRequest: { uploadToken: initJson.value.uploadToken, uploadedPartIds } }),
    })
    if (!finalizeRes.ok) throw new Error(`LinkedIn video finalizeUpload error ${finalizeRes.status}: ${await finalizeRes.text()}`)

    return videoUrn
  }

  async publishPost(options: PublishOptions): Promise<PublishResult> {
    let mediaUrn: string | null = null

    if (options.mediaUrls && options.mediaUrls.length > 0) {
      const url = options.mediaUrls[0]
      const mimeType = this.guessMimeType(url)
      if (mimeType.startsWith('video/')) {
        mediaUrn = await this.uploadVideoFromUrl(url)
      } else {
        mediaUrn = await this.uploadImageFromUrl(url)
      }
    }

    const body: Record<string, unknown> = {
      author: this.credentials.personUrn,
      commentary: options.text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }

    if (mediaUrn) {
      body.content = { media: { id: mediaUrn, title: 'Media' } }
    }

    const response = await fetch(LINKEDIN_POSTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202502',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`LinkedIn API error ${response.status}: ${text}`)
    }

    const urn = response.headers.get('x-restli-id')
    if (!urn) throw new Error('LinkedIn API did not return a post URN')

    return {
      platformPostId: urn,
      platformPostUrl: `https://www.linkedin.com/feed/update/${urn}`,
    }
  }

  async deletePost(platformPostId: string): Promise<void> {
    const url = `${LINKEDIN_POSTS_URL}/${platformPostId}`
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202502',
      },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`LinkedIn API delete error ${response.status}: ${text}`)
    }
  }

  async getProfile(): Promise<ProfileInfo> {
    const headers = {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202502',
    }

    // For org URNs, fetch org details from the organizations API
    if (this.credentials.personUrn?.startsWith('urn:li:organization:')) {
      const orgId = this.credentials.personUrn.split(':').pop()!
      const response = await fetch(
        `https://api.linkedin.com/v2/organizations/${orgId}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`,
        { headers },
      )
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`LinkedIn API error ${response.status}: ${text}`)
      }
      const org = await response.json() as { id: number; localizedName: string; vanityName?: string }
      const vanity = org.vanityName ?? String(org.id)
      return {
        platformAccountId: this.credentials.personUrn,
        displayName: org.localizedName,
        username: vanity,
        avatarUrl: '',
        profileUrl: `https://www.linkedin.com/company/${vanity}`,
        accountType: 'page',
      }
    }

    // Personal account
    const response = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`LinkedIn API error ${response.status}: ${text}`)
    }

    const data = await response.json() as {
      sub: string
      name: string
      given_name?: string
      family_name?: string
      picture?: string
      email?: string
    }

    const personUrn = `urn:li:person:${data.sub}`
    return {
      platformAccountId: personUrn,
      displayName: data.name,
      username: data.email ?? data.sub,
      avatarUrl: data.picture ?? '',
      profileUrl: `https://www.linkedin.com/in/${data.sub}`,
      accountType: 'personal',
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
    // LinkedIn token refresh requires client_id/client_secret which are
    // stored per-account in Firestore. When full OAuth flow is implemented,
    // this will use the refresh_token grant. For now, env-based tokens
    // must be refreshed manually.
    return null
  }
}
