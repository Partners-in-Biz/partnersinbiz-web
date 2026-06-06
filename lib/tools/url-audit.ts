import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type UrlAuditKind = 'metadata' | 'robots' | 'sitemap'

type SafeFetchResult = {
  finalUrl: string
  status: number
  contentType: string
  bytes: number
  body: string
}

export type MetadataAuditResult = {
  kind: 'metadata'
  finalUrl: string
  status: number
  title: string | null
  titleLength: number
  description: string | null
  descriptionLength: number
  canonical: string | null
  robots: string | null
  h1Count: number
  openGraph: {
    title: string | null
    description: string | null
    image: string | null
  }
  issues: string[]
  quickWins: string[]
}

export type RobotsAuditResult = {
  kind: 'robots'
  finalUrl: string
  status: number
  exists: boolean
  sitemapUrls: string[]
  disallowAll: boolean
  disallowCount: number
  issues: string[]
  quickWins: string[]
}

export type SitemapAuditResult = {
  kind: 'sitemap'
  finalUrl: string
  status: number
  urlCount: number
  sitemapCount: number
  sampleUrls: string[]
  issues: string[]
  quickWins: string[]
}

export type UrlAuditResult = MetadataAuditResult | RobotsAuditResult | SitemapAuditResult

const PRIVATE_HOSTS = new Set(['localhost', 'ip6-localhost', 'ip6-loopback'])
const MAX_BYTES = 750_000
const TIMEOUT_MS = 7_000
const MAX_REDIRECTS = 3

function isPrivateIpv4(ip: string) {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) return true
  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a >= 224
  )
}

function isPrivateIpv6(ip: string) {
  const value = ip.toLowerCase()
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value === '::'
}

export function normalisePublicUrl(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Enter a public website URL.')
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(candidate)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https URLs are supported.')
  url.hash = ''
  url.username = ''
  url.password = ''
  return url
}

function targetForKind(raw: string, kind: UrlAuditKind) {
  const url = normalisePublicUrl(raw)
  if (kind === 'robots') {
    url.pathname = '/robots.txt'
    url.search = ''
  }
  if (kind === 'sitemap' && !/sitemap[^/]*\.xml$/i.test(url.pathname)) {
    url.pathname = '/sitemap.xml'
    url.search = ''
  }
  return url
}

export async function assertPublicUrl(url: URL) {
  const hostname = url.hostname.toLowerCase()
  if (PRIVATE_HOSTS.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Private or local hostnames are not allowed.')
  }

  const literal = isIP(hostname)
  if (literal === 4 && isPrivateIpv4(hostname)) throw new Error('Private IPv4 targets are not allowed.')
  if (literal === 6 && isPrivateIpv6(hostname)) throw new Error('Private IPv6 targets are not allowed.')

  if (!literal) {
    const records = await lookup(hostname, { all: true, verbatim: true })
    if (!records.length) throw new Error('The hostname did not resolve.')
    for (const record of records) {
      if (record.family === 4 && isPrivateIpv4(record.address)) throw new Error('This hostname resolves to a private IPv4 address.')
      if (record.family === 6 && isPrivateIpv6(record.address)) throw new Error('This hostname resolves to a private IPv6 address.')
    }
  }
}

async function safeFetch(startUrl: URL, redirects = 0): Promise<SafeFetchResult> {
  await assertPublicUrl(startUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(startUrl, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PartnersInBiz-PublicToolAudit/1.0 (+https://partnersinbiz.online/tools)',
        Accept: 'text/html,text/plain,application/xml,text/xml,*/*;q=0.8',
      },
    })

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= MAX_REDIRECTS) throw new Error('Too many redirects.')
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect response did not include a location.')
      return safeFetch(new URL(location, startUrl), redirects + 1)
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_BYTES) throw new Error('The response is too large for the public checker.')

    const body = await response.text()
    const bytes = Buffer.byteLength(body, 'utf8')
    if (bytes > MAX_BYTES) throw new Error('The response exceeded the public checker size cap.')

    return {
      finalUrl: response.url || startUrl.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bytes,
      body,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The request timed out.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function firstMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern)
  return match?.[1]?.trim() || null
}

function contentForMeta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return firstMatch(html, new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i')) ||
    firstMatch(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'))
}

export function analyseMetadata(fetchResult: SafeFetchResult): MetadataAuditResult {
  const html = fetchResult.body
  const title = firstMatch(html, /<title[^>]*>([^<]*)<\/title>/i)
  const description = contentForMeta(html, 'description')
  const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i) ||
    firstMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i)
  const robots = contentForMeta(html, 'robots')
  const ogTitle = contentForMeta(html, 'og:title')
  const ogDescription = contentForMeta(html, 'og:description')
  const ogImage = contentForMeta(html, 'og:image')
  const h1Count = (html.match(/<h1\b/gi) ?? []).length
  const issues: string[] = []
  const quickWins: string[] = []

  if (!title) issues.push('Missing title tag.')
  if (title && (title.length < 25 || title.length > 60)) issues.push('Title length is outside the usual 25-60 character planning range.')
  if (!description) issues.push('Missing meta description.')
  if (description && (description.length < 70 || description.length > 160)) issues.push('Meta description length is outside the usual 70-160 character planning range.')
  if (!canonical) issues.push('Missing canonical URL.')
  if (!ogTitle || !ogDescription || !ogImage) issues.push('Open Graph preview metadata is incomplete.')
  if (h1Count !== 1) issues.push(`Expected one H1; found ${h1Count}.`)
  if (robots?.toLowerCase().includes('noindex')) issues.push('Robots meta includes noindex.')

  if (!title || !description) quickWins.push('Write a specific title and description that match the page offer and search intent.')
  if (!canonical) quickWins.push('Add a canonical URL so duplicate or parameterised pages have a clear primary version.')
  if (!ogImage) quickWins.push('Add a social preview image to improve link sharing quality.')
  if (h1Count !== 1) quickWins.push('Use one clear H1 that summarises the page purpose.')
  if (!quickWins.length) quickWins.push('Metadata basics look present; review copy quality, schema, internal links, and conversion path next.')

  return {
    kind: 'metadata',
    finalUrl: fetchResult.finalUrl,
    status: fetchResult.status,
    title,
    titleLength: title?.length ?? 0,
    description,
    descriptionLength: description?.length ?? 0,
    canonical,
    robots,
    h1Count,
    openGraph: { title: ogTitle, description: ogDescription, image: ogImage },
    issues,
    quickWins,
  }
}

export function analyseRobots(fetchResult: SafeFetchResult): RobotsAuditResult {
  const text = fetchResult.body
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const sitemapUrls = lines
    .filter(line => /^sitemap:/i.test(line))
    .map(line => line.replace(/^sitemap:/i, '').trim())
    .filter(Boolean)
  const disallows = lines.filter(line => /^disallow:/i.test(line))
  const disallowAll = disallows.some(line => /^disallow:\s*\/\s*$/i.test(line))
  const exists = fetchResult.status >= 200 && fetchResult.status < 300
  const issues: string[] = []
  const quickWins: string[] = []

  if (!exists) issues.push('robots.txt was not found with a 2xx response.')
  if (!sitemapUrls.length) issues.push('No sitemap directive found in robots.txt.')
  if (disallowAll) issues.push('robots.txt appears to disallow the whole site for at least one rule block.')

  if (!exists) quickWins.push('Add a simple robots.txt file with a sitemap reference.')
  if (!sitemapUrls.length) quickWins.push('Add a Sitemap directive pointing to the canonical XML sitemap.')
  if (disallowAll) quickWins.push('Review broad Disallow rules before assuming the site is crawlable.')
  if (!quickWins.length) quickWins.push('Robots basics are present; verify important pages are crawlable in Search Console next.')

  return {
    kind: 'robots',
    finalUrl: fetchResult.finalUrl,
    status: fetchResult.status,
    exists,
    sitemapUrls,
    disallowAll,
    disallowCount: disallows.length,
    issues,
    quickWins,
  }
}

export function analyseSitemap(fetchResult: SafeFetchResult): SitemapAuditResult {
  const xml = fetchResult.body
  const sampleUrls = Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)).map(match => match[1].trim()).slice(0, 8)
  const urlCount = (xml.match(/<url\b/gi) ?? []).length
  const sitemapCount = (xml.match(/<sitemap\b/gi) ?? []).length
  const issues: string[] = []
  const quickWins: string[] = []

  if (fetchResult.status < 200 || fetchResult.status >= 300) issues.push('Sitemap did not return a 2xx response.')
  if (!urlCount && !sitemapCount) issues.push('No URL or sitemap entries were found.')
  if (urlCount > 0 && urlCount < 5) issues.push('Sitemap has very few URLs; confirm important pages are included.')
  if (!/xml|text|application\/octet-stream/i.test(fetchResult.contentType)) issues.push('Response content type is not clearly XML/text.')

  if (!urlCount && !sitemapCount) quickWins.push('Generate a sitemap that lists important canonical pages.')
  if (urlCount > 0 && urlCount < 5) quickWins.push('Add service, case-study, insight, and key conversion pages if they should be discoverable.')
  if (!quickWins.length) quickWins.push('Sitemap is discoverable; submit it in Search Console and monitor index coverage.')

  return {
    kind: 'sitemap',
    finalUrl: fetchResult.finalUrl,
    status: fetchResult.status,
    urlCount,
    sitemapCount,
    sampleUrls,
    issues,
    quickWins,
  }
}

export async function runUrlAudit(rawUrl: string, kind: UrlAuditKind): Promise<UrlAuditResult> {
  const fetchResult = await safeFetch(targetForKind(rawUrl, kind))
  if (kind === 'metadata') return analyseMetadata(fetchResult)
  if (kind === 'robots') return analyseRobots(fetchResult)
  return analyseSitemap(fetchResult)
}
