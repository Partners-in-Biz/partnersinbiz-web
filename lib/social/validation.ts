/**
 * Social Post Validation Service — Validates content against platform constraints.
 *
 * Used in POST/PUT post routes to reject invalid content before scheduling.
 */
import { getConstraints } from '@/lib/social/providers'
import type { SocialPlatformType, ValidationResult, ValidationError } from '@/lib/social/providers'
import { detectPublishBlockingArtifacts } from '@/lib/social/publish-text'

/**
 * Validate post content against the constraints of all target platforms.
 * Returns a combined result with errors/warnings from all platforms.
 */
export function validatePostContent(
  text: string,
  platforms: SocialPlatformType[],
  options?: {
    threadParts?: string[]
    mediaCount?: number
    mediaTypes?: string[]
  },
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationError[] = []

  if (!text || text.trim().length === 0) {
    errors.push({ field: 'content.text', message: 'Content text is required' })
    return { valid: false, errors, warnings }
  }

  errors.push(...detectPublishBlockingArtifacts(text))

  for (const platform of platforms) {
    const constraints = getConstraints(platform)

    // Text length
    if (text.length > constraints.maxTextLength) {
      errors.push({
        field: 'content.text',
        message: `Text exceeds ${constraints.maxTextLength} character limit (${text.length} chars)`,
        platform,
      })
    }

    // Thread validation
    if (options?.threadParts && options.threadParts.length > 0) {
      if (!constraints.supportsThreads) {
        errors.push({
          field: 'threadParts',
          message: `${platform} does not support threads`,
          platform,
        })
      }
      if (constraints.maxThreadParts && options.threadParts.length > constraints.maxThreadParts) {
        errors.push({
          field: 'threadParts',
          message: `Thread exceeds ${constraints.maxThreadParts} part limit (${options.threadParts.length} parts)`,
          platform,
        })
      }
      if (constraints.maxThreadPartLength) {
        options.threadParts.forEach((part, i) => {
          if (part.length > constraints.maxThreadPartLength!) {
            errors.push({
              field: `threadParts[${i}]`,
              message: `Thread part ${i + 1} exceeds ${constraints.maxThreadPartLength} char limit (${part.length} chars)`,
              platform,
            })
          }
        })
      }
    }

    // Media count
    if (options?.mediaCount && options.mediaCount > constraints.maxMediaPerPost) {
      errors.push({
        field: 'media',
        message: `Too many media attachments for ${platform} (max ${constraints.maxMediaPerPost}, got ${options.mediaCount})`,
        platform,
      })
    }

    // Hashtag warnings
    const hashtags = (text.match(/#\w+/g) ?? [])
    if (constraints.maxHashtags && hashtags.length > constraints.maxHashtags) {
      warnings.push({
        field: 'hashtags',
        message: `${hashtags.length} hashtags exceeds recommended limit of ${constraints.maxHashtags} for ${platform}`,
        platform,
      })
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
