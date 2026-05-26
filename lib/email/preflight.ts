// lib/email/preflight.ts
//
// Pre-send quality checks for broadcasts and sequence steps.
//
// This is a FAST, PURELY-STRING/STRUCTURAL analyzer. It must not touch
// Firestore, do network calls, or render templates — callers render the
// content first and hand us the finished subject/bodyHtml/bodyText. Each
// check is independent so one broken case never poisons the whole report.
//
// The set of checks here is the "obvious mistakes" list — broken links,
// missing alt text, subject too long, no unsubscribe, low-contrast button,
// uses <script>, etc. Errors block; warnings are advisory; info is for
// nudges. Callers decide whether to gate sends on errors only or block
// on warnings too.

import type { Block, EmailDocument } from '@/lib/email-builder/types'
import { hasAmpBlocks } from '@/lib/email-builder/render-amp'

export type PreflightSeverity = 'error' | 'warning' | 'info'

export interface PreflightIssue {
  id: string
  severity: PreflightSeverity
  title: string
  detail: string
  location?: string
  recommendation: string
}

export interface PreflightReport {
  pass: boolean
  errorCount: number
  warningCount: number
  infoCount: number
  issues: PreflightIssue[]
  scannedAt: string
}

export interface PreflightInput {
  subject: string
  preheader?: string
  bodyHtml: string
  bodyText: string
  document?: EmailDocument | null
  fromName?: string
  fromAddress?: string
  hasUnsubscribeUrl: boolean
  hasPreferencesUrl: boolean
}

// Standard merge fields recognised across the platform. Anything outside
// this set in a subject line triggers a warning.
const STANDARD_MERGE_FIELDS = new Set<string>([
  'firstName',
  'lastName',
  'fullName',
  'name',
  'email',
  'company',
  'orgName',
  'unsubscribeUrl',
  'preferencesUrl',
])

// Common spam-trigger words/phrases. Conservative list — matched case-insensitively.
const SPAM_TRIGGER_WORDS = [
  'free',
  'act now',
  '100% guaranteed',
  'click here',
  'buy now',
  'cash bonus',
  'congratulations',
  'earn money',
  'lowest price',
  'risk free',
  'no obligation',
  'order now',
  'urgent',
  'winner',
  'cheap',
  'double your income',
  'no fees',
  'fast cash',
]

// Crude emoji detector — matches the broad surrogate-pair + pictograph ranges.
// Avoids needing the /u flag with property-escapes for tooling compatibility.
const EMOJI_REGEX = /(?:\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udc00-\udfff]|[☀-➿])/g

// ─── Helpers ────────────────────────────────────────────────────────────────

export function extractLinks(html: string): string[] {
  if (!html) return []
  const out: string[] = []
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? m[2] ?? m[3] ?? ''
    if (href) out.push(href)
  }
  return out
}

export function extractImages(html: string): Array<{ src: string; alt: string; raw: string }> {
  if (!html) return []
  const out: Array<{ src: string; alt: string; raw: string }> = []
  const re = /<img\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? ''
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const altMatch = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : ''
    const alt = altMatch ? (altMatch[1] ?? altMatch[2] ?? '') : ''
    out.push({ src, alt, raw: m[0] })
  }
  return out
}

function countEmoji(s: string): number {
  if (!s) return 0
  const matches = s.match(EMOJI_REGEX)
  return matches ? matches.length : 0
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function hasUnresolvedTemplate(s: string): boolean {
  return /\{\{[^}]*\}\}/.test(s)
}

function extractMergeFields(s: string): string[] {
  const out: string[] = []
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) out.push(m[1])
  return out
}

function isValidUrl(raw: string): boolean {
  if (!raw) return false
  const v = raw.trim()
  // mailto:, tel:, anchor — treat as valid (not browser URLs).
  if (v.startsWith('mailto:') || v.startsWith('tel:') || v.startsWith('#')) return true
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const u = new URL(v)
    return !!u.protocol && (u.protocol === 'http:' || u.protocol === 'https:')
  } catch {
    return false
  }
}

function isLocalhostUrl(raw: string): boolean {
  const v = raw.toLowerCase()
  return (
    v.includes('localhost') ||
    v.includes('127.0.0.1') ||
    v.includes('://0.0.0.0') ||
    v.endsWith('.test') ||
    v.includes('.test/') ||
    v.includes('.local/') ||
    v.endsWith('.local')
  )
}

function isHttp(raw: string): boolean {
  return /^http:\/\//i.test(raw.trim())
}

// ─── Contrast (WCAG) ────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r, g, b }
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const ch = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b)
}

export function contrastRatio(fgHex: string, bgHex: string): number | null {
  const a = hexToRgb(fgHex)
  const b = hexToRgb(bgHex)
  if (!a || !b) return null
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// ─── Issue builders ─────────────────────────────────────────────────────────

function issue(
  id: string,
  severity: PreflightSeverity,
  title: string,
  detail: string,
  recommendation: string,
  location?: string,
): PreflightIssue {
  return { id, severity, title, detail, recommendation, location }
}

// ─── Main runner ────────────────────────────────────────────────────────────

export async function runPreflight(input: PreflightInput): Promise<PreflightReport> {
  const issues: PreflightIssue[] = []
  const subject = input.subject ?? ''
  const preheader = input.preheader ?? ''
  const bodyHtml = input.bodyHtml ?? ''
  const bodyText = input.bodyText ?? ''
  const doc = input.document ?? null

  // ── Subject checks ────────────────────────────────────────────────────────
  if (!subject.trim()) {
    issues.push(
      issue(
        'subject-empty',
        'error',
        'Subject line is empty',
        'No subject was provided. Most inboxes will mark this as suspicious.',
        'Add a subject line of 30–60 characters that previews the value of the email.',
        'subject',
      ),
    )
  } else {
    if (subject.length > 100) {
      issues.push(
        issue(
          'subject-too-long',
          'error',
          'Subject line is too long',
          `Subject is ${subject.length} characters. Inbox previews will truncate aggressively beyond ~70 chars and many clients reject over 100.`,
          'Tighten the subject to under 70 characters.',
          'subject',
        ),
      )
    } else if (subject.length > 70) {
      issues.push(
        issue(
          'subject-too-long',
          'warning',
          'Subject line is long',
          `Subject is ${subject.length} characters. Most inbox previews truncate around 70.`,
          'Consider tightening to 30–60 characters.',
          'subject',
        ),
      )
    }

    const letters = subject.replace(/[^a-zA-Z]/g, '')
    if (letters.length >= 5) {
      const upper = subject.replace(/[^A-Z]/g, '').length
      const ratio = upper / letters.length
      if (ratio > 0.7) {
        issues.push(
          issue(
            'subject-all-caps',
            'warning',
            'Subject is mostly uppercase',
            `~${Math.round(ratio * 100)}% of the letters are uppercase. Spam filters flag SHOUTING subject lines.`,
            'Use sentence case for most subject lines.',
            'subject',
          ),
        )
      }
    }

    const lowerSubject = subject.toLowerCase()
    const matchedSpam = SPAM_TRIGGER_WORDS.filter((w) => lowerSubject.includes(w))
    if (matchedSpam.length > 0) {
      issues.push(
        issue(
          'subject-spam-words',
          'warning',
          'Subject contains spam-trigger phrases',
          `Contains: ${matchedSpam.map((w) => `"${w}"`).join(', ')}. These phrases increase the chance of landing in the spam folder.`,
          'Rewrite to avoid these trigger phrases. Be specific about value instead of promotional.',
          'subject',
        ),
      )
    }

    const subjectMergeFields = extractMergeFields(subject)
    const unknownFields = subjectMergeFields.filter((f) => !STANDARD_MERGE_FIELDS.has(f))
    if (unknownFields.length > 0) {
      issues.push(
        issue(
          'subject-merge-field-missing',
          'warning',
          'Subject references non-standard merge fields',
          `Found: ${unknownFields.map((f) => `{{${f}}}`).join(', ')}. These may render as empty strings unless supplied at send time.`,
          'Use a standard merge field (firstName, fullName, orgName, company) or set these values via your send context.',
          'subject',
        ),
      )
    }

    const alnum = subject.replace(/[^a-zA-Z0-9]/g, '')
    const emojiCount = countEmoji(subject)
    if (alnum.length === 0 && subject.trim().length > 0) {
      issues.push(
        issue(
          'subject-only-emoji',
          'warning',
          'Subject is emoji-only',
          'The subject contains no alphanumeric characters. Inbox accessibility tools and search will struggle.',
          'Add at least a few words alongside emoji.',
          'subject',
        ),
      )
    }
    if (emojiCount > 3) {
      issues.push(
        issue(
          'subject-too-many-emoji',
          'warning',
          'Subject has too many emoji',
          `Found ${emojiCount} emoji. Multiple emoji in a subject is a spam-filter signal.`,
          'Keep emoji to 0–2 per subject line.',
          'subject',
        ),
      )
    }
  }

  // ── Body checks ───────────────────────────────────────────────────────────
  const trimmedBodyText = bodyText.trim()
  const trimmedBodyHtml = bodyHtml.trim()
  if (!trimmedBodyText && !trimmedBodyHtml) {
    issues.push(
      issue(
        'body-empty',
        'error',
        'Email body is empty',
        'Neither HTML nor plain-text body has content.',
        'Add a body — at minimum a few sentences of plain text.',
        'body',
      ),
    )
  }

  const links = extractLinks(bodyHtml)
  const images = extractImages(bodyHtml)

  // Unsubscribe check — accepted if (a) HTML contains an unsub link OR
  // (b) the caller signals one will be injected at send-time.
  const bodyContainsUnsub = /unsubscribe/i.test(bodyHtml) || /unsubscribe/i.test(bodyText)
  if (!bodyContainsUnsub && !input.hasUnsubscribeUrl) {
    issues.push(
      issue(
        'body-no-unsubscribe',
        'error',
        'No unsubscribe link present',
        'Marketing email without an unsubscribe link violates CAN-SPAM, GDPR, and most ESP policies. Send will be blocked.',
        'Add an unsubscribe link in the footer block, or use {{unsubscribeUrl}} in your body.',
        'body',
      ),
    )
  }

  if (!input.hasPreferencesUrl && !/preferences/i.test(bodyHtml)) {
    issues.push(
      issue(
        'body-no-preferences',
        'info',
        'No preferences link',
        'A preferences link lets recipients opt down (e.g. fewer emails) without fully unsubscribing — typically improves retention.',
        'Add {{preferencesUrl}} to your footer block.',
        'body',
      ),
    )
  }

  // Link checks.
  if (links.length > 20) {
    issues.push(
      issue(
        'body-too-many-links',
        'warning',
        'Too many links in body',
        `Body contains ${links.length} links. More than ~20 is a spam-filter signal.`,
        'Consolidate or remove unnecessary links.',
        'body',
      ),
    )
  }
  for (const href of links) {
    if (hasUnresolvedTemplate(href)) {
      issues.push(
        issue(
          'body-broken-link',
          'error',
          'Unresolved template variable in link',
          `Link contains an unresolved \`{{…}}\` token: ${href}`,
          'Either supply the variable in your send context or replace it with a literal URL.',
          `link:${href}`,
        ),
      )
      continue
    }
    if (isLocalhostUrl(href)) {
      issues.push(
        issue(
          'body-broken-link',
          'error',
          'Localhost / test URL in body',
          `Link points to a local-only address: ${href}`,
          'Replace with a public production URL before sending.',
          `link:${href}`,
        ),
      )
      continue
    }
    if (!isValidUrl(href)) {
      issues.push(
        issue(
          'body-broken-link',
          'error',
          'Malformed URL in body',
          `Link is not a valid http(s) / mailto / tel URL: ${href}`,
          'Fix the URL or remove the link.',
          `link:${href}`,
        ),
      )
      continue
    }
    if (isHttp(href)) {
      issues.push(
        issue(
          'body-broken-link',
          'warning',
          'Insecure http:// link',
          `Link uses http:// instead of https://: ${href}`,
          'Use https:// to avoid mixed-content warnings and increase deliverability.',
          `link:${href}`,
        ),
      )
    }
  }

  // Image alt text.
  let imagesWithoutAlt = 0
  for (const img of images) {
    if (!img.alt.trim()) imagesWithoutAlt++
  }
  if (imagesWithoutAlt > 0) {
    issues.push(
      issue(
        'body-missing-alt-text',
        'warning',
        'Images missing alt text',
        `${imagesWithoutAlt} of ${images.length} <img> tags have no alt attribute. Screen readers skip them and Gmail/Outlook block-images mode shows nothing.`,
        'Add a short alt description to every image.',
        'body',
      ),
    )
  }

  // Images-only / text-to-html ratio.
  const visibleText = stripTags(bodyHtml).replace(/\s+/g, ' ').trim()
  if (images.length > 0 && visibleText.length < 60) {
    issues.push(
      issue(
        'body-images-only',
        'warning',
        'Body is mostly images',
        `Found ${images.length} image(s) but only ${visibleText.length} characters of visible text.`,
        'Add at least a paragraph of real text so the email renders for blocked-images recipients and avoids spam filters.',
        'body',
      ),
    )
  }

  // 102KB Gmail clip limit.
  const htmlBytes = new TextEncoder().encode(bodyHtml).length
  if (htmlBytes > 102 * 1024) {
    issues.push(
      issue(
        'body-too-long',
        'warning',
        'Body HTML exceeds 102KB',
        `HTML is ${(htmlBytes / 1024).toFixed(1)} KB. Gmail clips messages beyond 102 KB which hides your unsubscribe link.`,
        'Trim inline styles, reduce repeated structure, or split into multiple emails.',
        'body',
      ),
    )
  }

  // Tracking pixel-only body.
  if (images.length === 1 && visibleText.length === 0 && links.length === 0) {
    const onlyImg = images[0]
    // Heuristic: 1x1 or tracking-pixel sources.
    const isPixel =
      /1[^0-9](px|x1)|tracking|pixel|open|track\?|\.gif(\?|$)/i.test(onlyImg.src) ||
      /width\s*=\s*"?1"?/i.test(onlyImg.raw) ||
      /height\s*=\s*"?1"?/i.test(onlyImg.raw)
    if (isPixel) {
      issues.push(
        issue(
          'body-tracking-pixel-only',
          'info',
          'Body is just a tracking pixel',
          'The HTML body contains only a tracking pixel — recipients will see a blank email.',
          'Add real content alongside the open-tracking pixel.',
          'body',
        ),
      )
    }
  }

  // Text-to-HTML ratio.
  if (bodyHtml.length > 0 && bodyText.length > 0 && bodyHtml.length > 10 * bodyText.length) {
    issues.push(
      issue(
        'body-low-text-to-html-ratio',
        'warning',
        'Plain-text fallback is much shorter than HTML',
        `HTML body is ${bodyHtml.length} chars, plain-text is ${bodyText.length} chars. Spam filters compare both versions.`,
        'Provide a richer plain-text fallback that mirrors the HTML content.',
        'body',
      ),
    )
  }

  // <script> / <style> / <link rel=stylesheet> presence.
  if (/<script\b/i.test(bodyHtml)) {
    issues.push(
      issue(
        'style-uses-javascript',
        'error',
        'Body contains <script>',
        'Email clients strip <script> tags universally. Its presence is also a strong spam signal.',
        'Remove <script> tags entirely.',
        'body',
      ),
    )
  }
  if (/<style\b/i.test(bodyHtml)) {
    issues.push(
      issue(
        'style-uses-style-tag',
        'info',
        '<style> tag used',
        'Most email clients (notably Gmail) strip <style> tags and only honour inline styles.',
        'Inline your CSS for the highest compatibility.',
        'body',
      ),
    )
  }
  if (/<link\b[^>]*stylesheet/i.test(bodyHtml)) {
    issues.push(
      issue(
        'style-uses-external-css',
        'warning',
        'External stylesheet linked',
        'All major email clients strip <link rel="stylesheet">. Styles will not apply.',
        'Inline the styles directly on each element.',
        'body',
      ),
    )
  }

  // ── Document-block checks ─────────────────────────────────────────────────
  if (doc) {
    if (hasAmpBlocks(doc)) {
      issues.push(
        issue(
          'amp-send-fallback',
          'info',
          'AMP blocks will send as HTML fallback',
          'This template contains AMP-for-Email blocks. PiB renders a valid AMP preview, but the current Resend/provider send path only accepts HTML and text parts, not a separate text/x-amp-html MIME part.',
          'Keep the HTML fallback content complete. Interactive AMP sending is intentionally deferred until the provider layer supports raw AMP MIME safely.',
          'document',
        ),
      )
    }
    const walk = (blocks: Block[], path: string) => {
      blocks.forEach((b, idx) => {
        const here = `${path}block:${b.type}#${idx}`
        switch (b.type) {
          case 'button': {
            const p = b.props
            if (!p.url || !p.url.trim()) {
              issues.push(
                issue(
                  'block-button-no-url',
                  'error',
                  'Button has no URL',
                  `Button "${p.text || '(unnamed)'}" has an empty URL.`,
                  'Set the button URL or remove the block.',
                  here,
                ),
              )
            }
            const cr = contrastRatio(p.textColor, p.color)
            if (cr !== null && cr < 4.5) {
              issues.push(
                issue(
                  'block-button-low-contrast',
                  'warning',
                  'Button text contrast is below WCAG AA',
                  `Contrast ratio is ${cr.toFixed(2)}:1 between text ${p.textColor} and background ${p.color}. WCAG AA requires 4.5:1.`,
                  'Pick a darker text colour or a lighter button background.',
                  here,
                ),
              )
            }
            break
          }
          case 'image': {
            const p = b.props
            if (!p.src || !p.src.trim()) {
              issues.push(
                issue(
                  'block-image-no-src',
                  'error',
                  'Image block has no source URL',
                  'An image block was left with an empty src.',
                  'Upload or paste an image URL, or remove the block.',
                  here,
                ),
              )
            } else if (!isValidUrl(p.src) && !p.src.startsWith('{{')) {
              issues.push(
                issue(
                  'block-image-broken-url',
                  'warning',
                  'Image URL looks malformed',
                  `src is not a valid URL: ${p.src}`,
                  'Use a fully-qualified https:// URL.',
                  here,
                ),
              )
            }
            if (!p.alt || !p.alt.trim()) {
              issues.push(
                issue(
                  'block-image-no-alt',
                  'warning',
                  'Image block missing alt text',
                  'An image block has no alt text.',
                  'Add a short descriptive alt attribute.',
                  here,
                ),
              )
            }
            break
          }
          case 'hero': {
            const p = b.props
            if (!p.ctaText || !p.ctaUrl) {
              issues.push(
                issue(
                  'block-hero-no-cta',
                  'info',
                  'Hero block has no CTA',
                  'Hero blocks without a clear call-to-action under-perform on conversion.',
                  'Add CTA text and URL to the hero block.',
                  here,
                ),
              )
            }
            break
          }
          case 'footer': {
            const p = b.props
            if (!p.address || !p.address.trim()) {
              issues.push(
                issue(
                  'footer-no-address',
                  'warning',
                  'Footer is missing a postal address',
                  'CAN-SPAM (US) and analogous laws (UK, EU, ZA) require a valid physical postal address in marketing email.',
                  'Add your organisation\'s postal address to the footer block.',
                  here,
                ),
              )
            }
            break
          }
          case 'columns': {
            walk(b.props.columns[0], here + '/left:')
            walk(b.props.columns[1], here + '/right:')
            break
          }
          default:
            break
        }
      })
    }
    walk(doc.blocks ?? [], '')
  }

  // ── From / sender checks ─────────────────────────────────────────────────
  const fromName = (input.fromName ?? '').trim()
  const fromAddress = (input.fromAddress ?? '').trim()
  if (!fromName) {
    if (fromAddress) {
      issues.push(
        issue(
          'from-display-name-missing',
          'warning',
          'No display name on the from address',
          `Sender is "${fromAddress}" with no display name. Bare addresses look like cold outreach to inbox filters.`,
          'Set a friendly from-name like "Acme Co." or "Sarah from Acme".',
          'from',
        ),
      )
      issues.push(
        issue(
          'from-email-bare-no-name',
          'info',
          'Bare from email',
          `Recipients will see just "${fromAddress}" — adding a display name typically lifts open rates by 5–15%.`,
          'Add a display name in your from-name field.',
          'from',
        ),
      )
    }
  }
  if (fromAddress && /@partnersinbiz\.online$/i.test(fromAddress)) {
    issues.push(
      issue(
        'from-address-shared-domain',
        'info',
        'Sending from the shared PIB domain',
        `From address uses partnersinbiz.online — fine for testing, but using your own verified domain improves deliverability and trust.`,
        'Verify your own domain in Email → Domains and set it as the from-domain.',
        'from',
      ),
    )
  }

  // ── Preheader sanity (info) ─────────────────────────────────────────────
  if (preheader && hasUnresolvedTemplate(preheader)) {
    const fields = extractMergeFields(preheader).filter((f) => !STANDARD_MERGE_FIELDS.has(f))
    if (fields.length > 0) {
      issues.push(
        issue(
          'subject-merge-field-missing',
          'warning',
          'Preheader references non-standard merge fields',
          `Found in preheader: ${fields.map((f) => `{{${f}}}`).join(', ')}.`,
          'Use a standard merge field or supply the variable at send time.',
          'preheader',
        ),
      )
    }
  }

  // ── Sort + summarise ─────────────────────────────────────────────────────
  const order: Record<PreflightSeverity, number> = { error: 0, warning: 1, info: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const infoCount = issues.filter((i) => i.severity === 'info').length

  return {
    pass: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    issues,
    scannedAt: new Date().toISOString(),
  }
}
