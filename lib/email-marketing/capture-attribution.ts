import { createHash } from 'node:crypto'

export interface CaptureUtm {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
}

export interface CaptureProvenance {
  sourceId: string
  sourceName: string
  sourceType: string
  campaignId: string
  programId: string
  referrer: string
  landingPage: string
  utm: CaptureUtm
  clickIds: Record<string, string>
}

type CaptureInput = Record<string, unknown> & {
  sourceId?: unknown
  sourceName?: unknown
  sourceType?: unknown
  campaignId?: unknown
  programId?: unknown
  referrer?: unknown
  landingPage?: unknown
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function lower(value: unknown): string {
  return text(value).toLowerCase()
}

function safeUrl(value: unknown): string {
  const raw = text(value, 2_000)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function compact<T extends Record<string, string>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => Boolean(item))) as Partial<T>
}

export function normalizeCaptureProvenance(input: CaptureInput): CaptureProvenance {
  const landingPage = safeUrl(input.landingPage)
  let landingParams: URLSearchParams | null = null
  try {
    landingParams = landingPage ? new URL(landingPage).searchParams : null
  } catch {
    landingParams = null
  }
  const param = (name: string): string => landingParams?.get(name) ?? ''
  const utm = compact({
    source: lower(input.utm_source) || lower(param('utm_source')),
    medium: lower(input.utm_medium) || lower(param('utm_medium')),
    campaign: lower(input.utm_campaign) || lower(param('utm_campaign')),
    term: lower(input.utm_term) || lower(param('utm_term')),
    content: lower(input.utm_content) || lower(param('utm_content')),
  }) as CaptureUtm
  const clickIds = compact({
    gclid: text(input.gclid) || text(param('gclid')),
    fbclid: text(input.fbclid) || text(param('fbclid')),
    msclkid: text(input.msclkid) || text(param('msclkid')),
    ttclid: text(input.ttclid) || text(param('ttclid')),
  }) as Record<string, string>

  return {
    sourceId: text(input.sourceId),
    sourceName: text(input.sourceName),
    sourceType: text(input.sourceType),
    campaignId: text(input.campaignId),
    programId: text(input.programId),
    referrer: safeUrl(input.referrer),
    landingPage,
    utm,
    clickIds,
  }
}

export function captureAttributionId(orgId: string, sourceId: string, submissionKey: string): string {
  const digest = createHash('sha256')
    .update(`${text(orgId, 500)}\u0000${text(sourceId, 500)}\u0000${text(submissionKey, 500)}`)
    .digest('hex')
  return `capture_${digest}`
}
