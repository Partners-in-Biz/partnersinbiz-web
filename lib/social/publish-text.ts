import type { SocialPlatformType, ValidationError } from '@/lib/social/providers'

const URL_IN_CODE_RE = /`((?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}[^\s`]*)`/gi
const CAROUSEL_SPEC_RE = /^#\s*(?:linkedin|instagram|facebook|x|twitter)\s+carousel\s+[—-]\s+\d+\s+slides\b/im
const SLIDE_FOOTER_RE = /\b(?:slide\s+footer\s+pattern|footer\s+pattern|footer\s+reads)\b[\s\S]{0,120}\bslide\s+n\s+of\s+\d+\b/i
const VIDEO_SPEC_RE = /^#\s*(?:short\s+)?video\s+script\s+[—-]\s+\d+\s+seconds\b/im
const FORMAT_INSTRUCTION_RE = /\*\*format:\*\*[\s\S]{0,200}\b(?:voiceover|screen recording|on-screen text|vertical 9:16)\b/i
const PRODUCTION_HEADING_RE = /^#\s*(?:linkedin|instagram|facebook|x|twitter)\s+(?:long-form\s+)?post\s*\([^)\n]*\)\s*\n{2,}/i

export function prepareSocialPublishText(text: string): string {
  return text
    .replace(URL_IN_CODE_RE, '$1')
    .replace(PRODUCTION_HEADING_RE, '')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

export function detectPublishBlockingArtifacts(text: string): ValidationError[] {
  const errors: ValidationError[] = []
  const trimmed = text.trim()

  if (CAROUSEL_SPEC_RE.test(trimmed) && SLIDE_FOOTER_RE.test(trimmed)) {
    errors.push({
      field: 'content.text',
      message: 'Content looks like a carousel production brief, not publish-ready post copy',
    })
  }

  if (VIDEO_SPEC_RE.test(trimmed) && FORMAT_INSTRUCTION_RE.test(trimmed)) {
    errors.push({
      field: 'content.text',
      message: 'Content looks like a video production brief, not publish-ready post copy',
    })
  }

  return errors
}

export function validatePublishReadyText(
  text: string,
  _platforms?: SocialPlatformType[],
): { valid: boolean; text: string; errors: ValidationError[] } {
  void _platforms
  const normalized = text
    .replace(URL_IN_CODE_RE, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim()
  const errors = detectPublishBlockingArtifacts(normalized)
  return { valid: errors.length === 0, text: prepareSocialPublishText(normalized), errors }
}
