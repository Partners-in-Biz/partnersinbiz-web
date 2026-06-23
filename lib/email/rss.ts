// lib/email/rss.ts
//
// Dependency-free RSS 2.0 / Atom 1.0 feed parser + email-digest renderer.
//
// We intentionally avoid pulling in a heavyweight XML library (and DOMParser
// isn't available in the Node serverless runtime). The parser below is a small
// regex/scanner that extracts the fields a digest actually needs —
// title / link / pubDate / description / guid — from both RSS <item> and Atom
// <entry> elements. It is forgiving of namespaces, CDATA sections, and entity
// encoding, which covers the overwhelming majority of real-world feeds.

export interface RssItem {
  title: string
  link: string
  /** Stable identifier — <guid> (RSS) or <id> (Atom); falls back to link. */
  guid: string
  /** ISO-8601 when parseable, else the raw string, else ''. */
  pubDate: string
  /** Plain-text excerpt (HTML stripped, collapsed whitespace, capped). */
  description: string
}

export interface ParsedFeed {
  title: string
  link: string
  items: RssItem[]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#34': '"',
  nbsp: ' ',
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X'
      const num = parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10)
      if (Number.isFinite(num)) {
        try {
          return String.fromCodePoint(num)
        } catch {
          return whole
        }
      }
      return whole
    }
    const mapped = ENTITIES[code]
    return mapped !== undefined ? mapped : whole
  })
}

/** Strip CDATA wrappers and trim. */
function unwrapCdata(value: string): string {
  const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  if (cdata) return cdata[1].trim()
  return value.trim()
}

/** Pull the inner text of the first matching tag inside `block`. */
function tagText(block: string, tag: string): string {
  // Matches <tag ...attrs>inner</tag> or <tag .../> (self-closing → '').
  const open = new RegExp(`<(?:\\w+:)?${tag}(\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i')
  const m = block.match(open)
  if (!m) return ''
  return decodeEntities(unwrapCdata(m[2])).trim()
}

/** Atom links live in attributes: <link href="..." rel="alternate"/>. */
function atomLink(block: string): string {
  const links = [...block.matchAll(/<(?:\w+:)?link\b([^>]*)\/?>/gi)]
  if (links.length === 0) return ''
  // Prefer rel="alternate" (or no rel), with an href.
  let fallback = ''
  for (const l of links) {
    const attrs = l[1]
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const rel = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!rel || rel.toLowerCase() === 'alternate') return decodeEntities(href)
    if (!fallback) fallback = decodeEntities(href)
  }
  return fallback
}

export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDate(raw: string): string {
  if (!raw) return ''
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return raw.trim()
  return new Date(ms).toISOString()
}

function parseBlock(block: string, isAtom: boolean): RssItem {
  const title = tagText(block, 'title')
  const link = isAtom ? atomLink(block) || tagText(block, 'link') : tagText(block, 'link')
  const rawDesc =
    tagText(block, 'description') ||
    tagText(block, 'summary') ||
    tagText(block, 'content') ||
    tagText(block, 'encoded')
  const description = stripHtml(rawDesc).slice(0, 400)
  const pubDate = normalizeDate(
    tagText(block, 'pubDate') ||
      tagText(block, 'published') ||
      tagText(block, 'updated') ||
      tagText(block, 'date'),
  )
  const guid = tagText(block, 'guid') || tagText(block, 'id') || link
  return { title, link, guid, pubDate, description }
}

/**
 * Parse an RSS 2.0 or Atom 1.0 feed string into a normalised structure.
 * Never throws — a malformed feed yields an empty item list.
 */
export function parseFeed(xml: string): ParsedFeed {
  if (!xml || typeof xml !== 'string') return { title: '', link: '', items: [] }

  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["'][^"']*Atom/i.test(xml) || /<entry\b/i.test(xml)

  const channelMatch = xml.match(/<channel\b[\s\S]*?>([\s\S]*?)<\/channel>/i)
  const feedHeader = channelMatch ? channelMatch[1] : xml
  const feedTitle = tagText(feedHeader.replace(/<item\b[\s\S]*$/i, '').replace(/<entry\b[\s\S]*$/i, ''), 'title')
  const feedLink = isAtom ? atomLink(feedHeader.replace(/<entry\b[\s\S]*$/i, '')) : tagText(feedHeader, 'link')

  const blockRe = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi
  const items: RssItem[] = []
  for (const m of xml.matchAll(blockRe)) {
    const item = parseBlock(m[0], isAtom)
    if (item.title || item.link) items.push(item)
  }

  return { title: feedTitle, link: feedLink, items }
}

/**
 * Fetch + parse a feed URL. Returns null on network/HTTP failure so callers
 * can skip gracefully without crashing a whole cron run.
 */
export async function fetchFeed(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<ParsedFeed | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 12000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PartnersInBiz-RSS/1.0 (+https://partnersinbiz.online)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const xml = await res.text()
    return parseFeed(xml)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// ── Digest rendering ─────────────────────────────────────────────────────────

export interface DigestRenderOptions {
  /** Items to render (already filtered to "new since last run"). */
  items: RssItem[]
  /** Feed display title, used in fallbacks. */
  feedTitle?: string
  /** Max items to include in the rendered list. */
  maxItems?: number
}

/**
 * Build the merge-tag map an RSS digest exposes to the subject/body template:
 *   {{latest_post_title}}, {{latest_post_link}}, {{latest_post_excerpt}},
 *   {{post_count}}, {{feed_title}}, {{posts_html}}, {{posts_text}}.
 */
export function buildDigestVars(opts: DigestRenderOptions): Record<string, string> {
  const max = opts.maxItems && opts.maxItems > 0 ? opts.maxItems : 10
  const items = opts.items.slice(0, max)
  const latest = items[0]

  return {
    latest_post_title: latest?.title ?? '',
    latest_post_link: latest?.link ?? '',
    latest_post_excerpt: latest?.description ?? '',
    post_count: String(items.length),
    feed_title: opts.feedTitle ?? '',
    posts_html: renderItemsHtml(items),
    posts_text: renderItemsText(items),
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderItemsHtml(items: RssItem[]): string {
  if (items.length === 0) return '<p style="margin:0;color:#666;">No new posts.</p>'
  const rows = items
    .map((item) => {
      const date = item.pubDate
        ? new Date(item.pubDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : ''
      const titleHtml = item.link
        ? `<a href="${escapeHtml(item.link)}" style="color:#0b5fff;text-decoration:none;font-weight:600;">${escapeHtml(item.title || item.link)}</a>`
        : `<span style="font-weight:600;">${escapeHtml(item.title)}</span>`
      const dateHtml = date
        ? `<div style="font-size:12px;color:#888;margin-top:2px;">${escapeHtml(date)}</div>`
        : ''
      const descHtml = item.description
        ? `<div style="font-size:14px;color:#444;margin-top:6px;line-height:1.5;">${escapeHtml(item.description)}</div>`
        : ''
      return `<div style="padding:14px 0;border-bottom:1px solid #eee;">${titleHtml}${dateHtml}${descHtml}</div>`
    })
    .join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;">${rows}</div>`
}

export function renderItemsText(items: RssItem[]): string {
  if (items.length === 0) return 'No new posts.'
  return items
    .map((item) => {
      const parts = [item.title || item.link]
      if (item.link) parts.push(item.link)
      if (item.description) parts.push(item.description)
      return parts.filter(Boolean).join('\n')
    })
    .join('\n\n')
}

/**
 * Wrap a digest body in a minimal branded HTML shell. The caller supplies the
 * already-interpolated inner HTML (which usually includes {{posts_html}}).
 */
export function wrapDigestHtml(innerHtml: string, opts?: { title?: string }): string {
  const heading = opts?.title
    ? `<h1 style="font-size:20px;margin:0 0 16px;color:#111;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(opts.title)}</h1>`
    : ''
  return `<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111;">${heading}${innerHtml}</div>`
}
