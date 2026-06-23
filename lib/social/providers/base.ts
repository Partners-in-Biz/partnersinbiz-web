/**
 * SocialProvider — Abstract base class for all social media platform providers.
 *
 * Each platform implements this interface. The provider registry instantiates
 * providers by platform type, hiding platform-specific logic behind a unified API.
 */
import type {
  SocialPlatformType,
  PublishResult,
  ProfileInfo,
  AnalyticsData,
  PlatformConstraints,
  ValidationResult,
} from './types'
import { getConstraints } from './constraints'

export interface ProviderCredentials {
  accessToken: string
  accessTokenSecret?: string
  refreshToken?: string
  apiKey?: string
  apiKeySecret?: string
  personUrn?: string
  instanceUrl?: string
}

export interface PublishOptions {
  text: string
  threadParts?: string[]
  mediaUrls?: string[]
  altTexts?: string[]
  replyToId?: string
  /**
   * LinkedIn only: whether to publish as the member's personal Profile
   * ('profile') or as a Company Page ('organization'). When omitted the
   * provider infers it from the account's stored author URN.
   */
  shareType?: 'profile' | 'organization'
  title?: string
  privacyStatus?: 'private' | 'unlisted' | 'public'
  targetVisibility?: 'private' | 'unlisted' | 'public'
  tags?: string[]
  categoryId?: string
  publishAt?: string
  selfDeclaredMadeForKids?: boolean
  containsSyntheticMedia?: boolean
  aiDisclosureNotes?: string
}

export abstract class SocialProvider {
  readonly platform: SocialPlatformType
  protected credentials: ProviderCredentials

  constructor(platform: SocialPlatformType, credentials: ProviderCredentials) {
    this.platform = platform
    this.credentials = credentials
  }

  /** Get the platform constraints config */
  getConstraints(): PlatformConstraints {
    return getConstraints(this.platform)
  }

  /** Publish a post (single or thread) to the platform */
  abstract publishPost(options: PublishOptions): Promise<PublishResult>

  /** Publish a thread (multi-part post). Media applies to first part only. */
  async publishThread(parts: string[], mediaUrls?: string[]): Promise<PublishResult[]> {
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

  /**
   * Post a comment on an already-published post (used for first-comment
   * automation). Default implementation posts the comment as a native reply
   * via publishPost({ replyToId }). Platforms with a dedicated comments API
   * (LinkedIn, Facebook, Instagram) override this.
   */
  async postComment(platformPostId: string, text: string): Promise<PublishResult> {
    return this.publishPost({ text, replyToId: platformPostId })
  }

  /** Delete a post by its platform-native ID */
  abstract deletePost(platformPostId: string): Promise<void>

  /** Get profile info for the authenticated account */
  abstract getProfile(): Promise<ProfileInfo>

  /** Validate that credentials are still working */
  abstract validateCredentials(): Promise<boolean>

  /** Refresh OAuth tokens. Returns new credentials if refreshed, null if not needed or not supported. */
  abstract refreshToken(): Promise<ProviderCredentials | null>

  /** Get analytics for a specific post */
  async getAnalytics(platformPostId: string): Promise<AnalyticsData | null> {
    void platformPostId
    // Default: not supported. Platforms override when available.
    return null
  }

  /** Validate content against platform constraints */
  validateContent(text: string, threadParts?: string[]): ValidationResult {
    const constraints = this.getConstraints()
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    // Text length
    if (text.length > constraints.maxTextLength) {
      errors.push({
        field: 'text',
        message: `Text exceeds ${constraints.maxTextLength} character limit (${text.length} chars)`,
        platform: this.platform,
      })
    }

    // Thread parts
    if (threadParts && threadParts.length > 0) {
      if (!constraints.supportsThreads) {
        errors.push({
          field: 'threadParts',
          message: `${this.platform} does not support threads`,
          platform: this.platform,
        })
      }
      if (constraints.maxThreadParts && threadParts.length > constraints.maxThreadParts) {
        errors.push({
          field: 'threadParts',
          message: `Thread exceeds ${constraints.maxThreadParts} part limit (${threadParts.length} parts)`,
          platform: this.platform,
        })
      }
      if (constraints.maxThreadPartLength) {
        threadParts.forEach((part, i) => {
          if (part.length > constraints.maxThreadPartLength!) {
            errors.push({
              field: `threadParts[${i}]`,
              message: `Thread part ${i + 1} exceeds ${constraints.maxThreadPartLength} character limit (${part.length} chars)`,
              platform: this.platform,
            })
          }
        })
      }
    }

    // Hashtag count
    const hashtags = (text.match(/#\w+/g) ?? [])
    if (constraints.maxHashtags && hashtags.length > constraints.maxHashtags) {
      warnings.push({
        field: 'hashtags',
        message: `${hashtags.length} hashtags exceeds recommended limit of ${constraints.maxHashtags}`,
        platform: this.platform,
      })
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
