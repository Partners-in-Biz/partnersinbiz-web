import type { Block, EmailDocument } from '@/lib/email-builder/types'
import { validateMergeTags } from '@/lib/email/merge-tags'

export type PreflightSeverity = 'error' | 'warning' | 'info'

export interface PreflightIssue {
  code: string
  severity: PreflightSeverity
  message: string
  blockId?: string
}

export interface EmailPreflightResult {
  blocking: boolean
  score: number
  issues: PreflightIssue[]
}

interface PreflightOptions {
  renderedHtmlBytes?: number
}

interface CollectedDocument {
  text: string[]
  images: Array<{ id: string; alt: string; src: string }>
  links: Array<{ id: string; url: string }>
  footers: Array<{ id: string; address: string; unsubscribeUrl: string }>
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function collectBlocks(blocks: Block[], output: CollectedDocument): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'hero':
        output.text.push(block.props.headline, block.props.subhead ?? '', block.props.ctaText ?? '')
        if (block.props.backgroundUrl) output.images.push({ id: block.id, alt: block.props.headline, src: block.props.backgroundUrl })
        if (block.props.ctaUrl) output.links.push({ id: block.id, url: block.props.ctaUrl })
        break
      case 'heading':
        output.text.push(block.props.text)
        break
      case 'paragraph':
        output.text.push(stripHtml(block.props.html), block.props.html)
        break
      case 'button':
        output.text.push(block.props.text)
        output.links.push({ id: block.id, url: block.props.url })
        break
      case 'image':
        output.images.push({ id: block.id, alt: block.props.alt, src: block.props.src })
        if (block.props.link) output.links.push({ id: block.id, url: block.props.link })
        break
      case 'columns':
        collectBlocks(block.props.columns.flat(), output)
        break
      case 'footer':
        output.text.push(block.props.orgName, block.props.address)
        output.footers.push({ id: block.id, address: block.props.address, unsubscribeUrl: block.props.unsubscribeUrl })
        output.links.push({ id: block.id, url: block.props.unsubscribeUrl })
        if (block.props.preferencesUrl) output.links.push({ id: block.id, url: block.props.preferencesUrl })
        for (const url of Object.values(block.props.social ?? {})) if (url) output.links.push({ id: block.id, url })
        break
      case 'amp-carousel':
        for (const slide of block.props.slides) {
          output.images.push({ id: block.id, alt: slide.alt, src: slide.imageUrl })
          if (slide.linkUrl) output.links.push({ id: block.id, url: slide.linkUrl })
        }
        break
      case 'amp-accordion':
        for (const item of block.props.items) output.text.push(item.heading, stripHtml(item.bodyHtml), item.bodyHtml)
        break
      case 'amp-form':
        output.text.push(block.props.successMessage, block.props.buttonText)
        output.links.push({ id: block.id, url: block.props.submitUrl })
        break
      case 'amp-live-data':
        output.text.push(block.props.template)
        output.links.push({ id: block.id, url: block.props.endpoint })
        break
      default:
        break
    }
  }
}

function isSafeUrl(url: string): boolean {
  if (/^\{\{\s*[a-zA-Z0-9_]+\s*\}\}$/.test(url.trim())) return true
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function luminance(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  const values = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = values.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(left: string, right: string): number | null {
  const first = luminance(left)
  const second = luminance(right)
  if (first == null || second == null) return null
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export function runEmailPreflight(
  document: EmailDocument,
  options: PreflightOptions = {},
): EmailPreflightResult {
  const issues: PreflightIssue[] = []
  const collected: CollectedDocument = { text: [], images: [], links: [], footers: [] }
  collectBlocks(document.blocks, collected)

  if (!document.subject.trim()) issues.push({ code: 'subject_missing', severity: 'error', message: 'Add a subject line.' })
  else if (document.subject.length > 70) issues.push({ code: 'subject_long', severity: 'warning', message: 'Subject lines over 70 characters are often truncated.' })
  if (!document.preheader.trim()) issues.push({ code: 'preheader_missing', severity: 'warning', message: 'Add preview text to control the inbox snippet.' })
  else if (document.preheader.length > 140) issues.push({ code: 'preheader_long', severity: 'warning', message: 'Preview text over 140 characters may be truncated.' })

  const merge = validateMergeTags(
    collected.text.join('\n'),
    document.subject,
    document.mergeTagFallbacks ?? {},
  )
  const systemFields = new Set(['orgname', 'unsubscribeurl', 'preferencesurl'])
  const unknownFields = merge.unknownTags.filter((field) => !systemFields.has(field.toLowerCase()))
  if (unknownFields.length) {
    issues.push({ code: 'merge_unknown', severity: 'error', message: `Unknown merge fields: ${unknownFields.join(', ')}.` })
  }
  if (merge.missingTags.length) {
    issues.push({ code: 'merge_fallback_missing', severity: 'error', message: `Add fallback copy for: ${merge.missingTags.join(', ')}.` })
  }

  if (collected.footers.length === 0) {
    issues.push({ code: 'compliance_footer_missing', severity: 'error', message: 'Add a compliance footer with an address and unsubscribe link.' })
  }
  for (const footer of collected.footers) {
    if (!footer.address.trim()) issues.push({ code: 'postal_address_missing', severity: 'error', message: 'The footer needs a physical postal address.', blockId: footer.id })
    if (!footer.unsubscribeUrl.trim()) issues.push({ code: 'unsubscribe_missing', severity: 'error', message: 'The footer needs an unsubscribe link.', blockId: footer.id })
  }
  for (const image of collected.images) {
    if (!image.alt.trim()) issues.push({ code: 'image_alt_missing', severity: 'warning', message: 'Describe this image for screen readers.', blockId: image.id })
    if (!isSafeUrl(image.src)) issues.push({ code: 'image_url_unsafe', severity: 'error', message: 'Image URLs must use HTTP or HTTPS.', blockId: image.id })
  }
  for (const link of collected.links) {
    if (!isSafeUrl(link.url)) issues.push({ code: 'link_unsafe', severity: 'error', message: 'Links must use HTTP or HTTPS.', blockId: link.id })
  }

  const ratio = contrastRatio(document.theme.textColor, document.theme.backgroundColor)
  if (ratio != null && ratio < 4.5) issues.push({ code: 'contrast_low', severity: 'warning', message: `Body text contrast is ${ratio.toFixed(1)}:1; aim for at least 4.5:1.` })
  if ((options.renderedHtmlBytes ?? 0) >= 102_000) issues.push({ code: 'gmail_clipping_risk', severity: 'warning', message: 'Rendered HTML is near Gmail’s clipping threshold (about 102 KB).' })

  const readableWords = stripHtml(collected.text.join(' ')).split(/\s+/).filter(Boolean).length
  if (collected.images.length > 0 && readableWords < collected.images.length * 12) {
    issues.push({ code: 'image_text_balance', severity: 'warning', message: 'Add more live text so the message is useful when images are blocked.' })
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  return {
    blocking: errorCount > 0,
    score: Math.max(0, 100 - errorCount * 20 - warningCount * 5),
    issues,
  }
}
