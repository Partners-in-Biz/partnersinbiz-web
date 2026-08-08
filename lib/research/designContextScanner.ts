/**
 * Live-site style scanner — /impeccable document equivalent.
 *
 * Fetches a public client URL (HTML + linked stylesheets), then extracts a
 * design-context draft: palette (named colors), type stack (font families per
 * role), recurring component-ish class names, radius and elevation scales.
 *
 * SSRF-safe: only http/https public URLs; private/local/metadata hosts are
 * rejected before any fetch. Output feeds POST /api/v1/research/design-context
 * with source='style-scan' (gather path (b) in the Impeccable mapping).
 */

const MAX_HTML_BYTES = 1_000_000
const MAX_CSS_BYTES = 300_000
const MAX_STYLESHEETS = 6
const FETCH_TIMEOUT_MS = 12_000

export interface DesignScanResult {
  url: string
  palette: Array<{ name: string; value: string; usage?: string }>
  typeStack: Array<{ role: 'display' | 'heading' | 'body' | 'mono' | 'label'; family: string }>
  componentHints: Array<{ name: string; count: number }>
  radiusScale: Array<{ name: string; value: string }>
  elevationScale: Array<{ name: string; value: string }>
  title: string
  notes: string[]
}

/** True when a hostname is a private/internal target (mirrors workbench guard). */
export function isPrivateScanHost(host: string): boolean {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (clean === 'localhost' || clean.endsWith('.localhost') || clean.endsWith('.local') || clean === '::' || clean === '::1' || clean === '0.0.0.0') return true
  if (clean.includes(':')) return true
  const ipv4 = clean.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  if (!ipv4) return false
  const [a, b, c] = ipv4
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

/** Validate a candidate scan URL; returns the parsed URL or an error string. */
export function validateScanUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'url must be a valid absolute http(s) URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'url must be http(s)' }
  }
  const host = parsed.hostname
  if (!host) return { ok: false, error: 'url is missing a hostname' }
  if (isPrivateScanHost(host)) {
    return { ok: false, error: 'private, local, or metadata hosts are not allowed' }
  }
  return { ok: true, url: parsed }
}

async function fetchWithTimeout(url: string, bytesCap: number): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'PartnersInBiz-DesignScanner/1.0 (+https://partnersinbiz.online)',
        accept: 'text/html,text/css,*/*;q=0.8',
      },
    })
    const arrayBuffer = await res.arrayBuffer()
    const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer.slice(0, bytesCap))
    return { status: res.status, text }
  } finally {
    clearTimeout(timer)
  }
}

function cssFromStyleTags(html: string): string[] {
  const blocks: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null && blocks.length < MAX_STYLESHEETS) {
    blocks.push(match[1] ?? '')
  }
  return blocks
}

function stylesheetUrls(html: string, base: URL): string[] {
  const urls: string[] = []
  const re = /<link[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const tag = match[0] ?? ''
    const relMatch = tag.match(/rel\s*=\s*["']?stylesheet["']?/i)
    if (!relMatch) continue
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i)
    if (!hrefMatch?.[1]) continue
    try {
      const resolved = new URL(hrefMatch[1], base)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        if (!isPrivateScanHost(resolved.hostname)) urls.push(resolved.toString())
      }
    } catch {
      // skip malformed stylesheet hrefs
    }
  }
  return urls.slice(0, MAX_STYLESHEETS)
}

function htmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 200) ?? ''
}

/** Collect named custom-property tokens and raw declarations from CSS text. */
function parseCssTokens(css: string): {
  customProps: Map<string, string>
  fontFamilies: Map<string, { role: string; family: string; count: number }>
  radii: Map<string, { name: string; value: string }>
  elevations: Map<string, { name: string; value: string }>
  colors: Map<string, { value: string; count: number; usage: string }>
} {
  const customProps = new Map<string, string>()
  const fontFamilies = new Map<string, { role: string; family: string; count: number }>()
  const radii = new Map<string, { name: string; value: string }>()
  const elevations = new Map<string, { name: string; value: string }>()
  const colors = new Map<string, { value: string; count: number; usage: string }>()

  const propRe = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g
  let propMatch: RegExpExecArray | null
  while ((propMatch = propRe.exec(css)) !== null) {
    const name = propMatch[1]!.trim()
    const value = propMatch[2]!.trim().replace(/\s+/g, ' ')
    if (!customProps.has(name)) customProps.set(name, value)
    if (/^(--(color|brand|accent|primary|bg|text|surface)|--[a-z0-9-]*colou?r)/i.test(name)) {
      const key = value.toLowerCase()
      const existing = colors.get(key)
      if (existing) existing.count += 1
      else colors.set(key, { value, count: 1, usage: name })
    }
    if (/^(--(font|type|heading|body|sans|serif|mono))/i.test(name)) {
      const role = /mono/i.test(name) ? 'mono' : /heading|display/i.test(name) ? 'heading' : /body|sans/i.test(name) ? 'body' : 'body'
      fontFamilies.set(`prop:${name}`, { role, family: value, count: 1 })
    }
    if (/^(--(radius|round|corner))/i.test(name)) {
      radii.set(name, { name, value })
    }
    if (/^(--(shadow|elevation|elev))/i.test(name)) {
      elevations.set(name, { name, value })
    }
  }

  // Per-selector declarations for font-family / colors / radius / shadow.
  const blockRe = /([^{}]+)\{([^{}]*)\}/g
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockRe.exec(css)) !== null) {
    const selector = blockMatch[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const decls = blockMatch[2]!.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const isBody = /(^|,)\s*(body|html|:root)\s*($|,)/i.test(selector)
    const isHeading = /(^|,)\s*(h1|h2|h3|h4|\.?heading[^,]*|\.?display[^,]*)\s*($|,)/i.test(selector)
    const isMono = /(^|,)\s*(code|pre|kbd|\.?mono[^,]*|\.?code[^,]*)\s*($|,)/i.test(selector)

    const fontRe = /font-family\s*:\s*([^;]+);/gi
    let fontMatch: RegExpExecArray | null
    while ((fontMatch = fontRe.exec(decls)) !== null) {
      const family = fontMatch[1]!.trim().replace(/^["']|["']$/g, '')
      const role = isMono ? 'mono' : isHeading ? 'heading' : isBody ? 'body' : 'body'
      const key = `${role}:${family.toLowerCase()}`
      const existing = fontFamilies.get(key)
      if (existing) existing.count += 1
      else fontFamilies.set(key, { role, family, count: 1 })
    }

    const colorRe = /(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch?\([^)]*\)|(?:[a-z]+))\s*;/g
    let colorMatch: RegExpExecArray | null
    while ((colorMatch = colorRe.exec(decls)) !== null) {
      const value = colorMatch[1]!.trim()
      if (/^(transparent|inherit|initial|unset|none|currentcolor)$/i.test(value)) continue
      const key = value.toLowerCase()
      const existing = colors.get(key)
      if (existing) existing.count += 1
      else colors.set(key, { value, count: 1, usage: selector.split(',').slice(0, 2).join(', ') })
    }

    const radiusRe = /border-radius\s*:\s*([^;]+);/gi
    let radiusMatch: RegExpExecArray | null
    while ((radiusMatch = radiusRe.exec(decls)) !== null) {
      const value = radiusMatch[1]!.trim()
      const name = selector.includes('--') ? `radius-${radii.size + 1}` : selector.split(',').slice(0, 1).join(',').trim().replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || `radius-${radii.size + 1}`
      if (!Array.from(radii.values()).some((entry) => entry.value === value)) {
        radii.set(`dec:${radii.size}`, { name, value })
      }
    }

    const shadowRe = /box-shadow\s*:\s*([^;]+);/gi
    let shadowMatch: RegExpExecArray | null
    while ((shadowMatch = shadowRe.exec(decls)) !== null) {
      const value = shadowMatch[1]!.trim()
      if (/^none$/i.test(value)) continue
      const name = selector.split(',').slice(0, 1).join(',').trim().replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || `elevation-${elevations.size + 1}`
      if (!Array.from(elevations.values()).some((entry) => entry.value === value)) {
        elevations.set(`dec:${elevations.size}`, { name, value })
      }
    }
  }

  return { customProps, fontFamilies, radii, elevations, colors }
}

function namedPalette(colors: Map<string, { value: string; count: number; usage: string }>): Array<{ name: string; value: string; usage?: string }> {
  const roleByValue: Record<string, string> = {
    white: 'background',
    black: 'text',
    '#fff': 'background',
    '#ffffff': 'background',
    '#000': 'text',
    '#000000': 'text',
  }
  const out: Array<{ name: string; value: string; usage?: string }> = []
  const sorted = Array.from(colors.entries()).sort((a, b) => b[1].count - a[1].count)
  for (const [key, entry] of sorted.slice(0, 12)) {
    const role = roleByValue[key] ?? (entry.usage.startsWith('--') ? entry.usage.replace(/^--(?:color|brand|accent|primary|bg|text|surface)-?/i, '') : entry.usage)
    out.push({
      name: (role || `color-${out.length + 1}`).slice(0, 60),
      value: entry.value,
      ...(entry.usage && !entry.usage.startsWith('--') ? { usage: entry.usage.slice(0, 120) } : {}),
    })
  }
  return out
}

function recurringComponentClasses(html: string): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  const classRe = /class\s*=\s*["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = classRe.exec(html)) !== null) {
    const classes = (match[1] ?? '').split(/\s+/).map((c) => c.trim()).filter(Boolean)
    for (const cls of classes) {
      counts.set(cls, (counts.get(cls) ?? 0) + 1)
    }
  }
  const componentLike = /(?:btn|button|card|nav|hero|badge|chip|modal|dialog|form|input|select|dropdown|accordion|tab|pill|avatar|logo|footer|header|banner|section|grid|carousel|table|tooltip|menu|sidebar|toast|alert|banner|cta)/i
  return Array.from(counts.entries())
    .filter(([name, count]) => count >= 2 && componentLike.test(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }))
}

function scaleTokens(map: Map<string, { name: string; value: string }>, max: number): Array<{ name: string; value: string }> {
  return Array.from(map.values()).slice(0, max)
}

/**
 * Scan a live public URL and return a design-context draft.
 * Throws on invalid/private URLs; never follows to private hosts.
 */
export async function scanDesignFromUrl(rawUrl: string): Promise<DesignScanResult> {
  const validated = validateScanUrl(rawUrl)
  if (!validated.ok) throw new Error(validated.error)
  const base = validated.url

  const htmlResult = await fetchWithTimeout(base.toString(), MAX_HTML_BYTES)
  if (htmlResult.status >= 400) throw new Error(`site returned HTTP ${htmlResult.status}`)
  const html = htmlResult.text

  const cssParts = cssFromStyleTags(html)
  const sheetUrls = stylesheetUrls(html, base)
  const sheetPromises = sheetUrls.map(async (url) => {
    try {
      const sheet = await fetchWithTimeout(url, MAX_CSS_BYTES)
      return sheet.status < 400 ? sheet.text : ''
    } catch {
      return ''
    }
  })
  const sheets = await Promise.all(sheetPromises)
  cssParts.push(...sheets.filter(Boolean))

  const css = cssParts.join('\n')
  const tokens = parseCssTokens(css)
  const palette = namedPalette(tokens.colors)
  const typeStack = Array.from(tokens.fontFamilies.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([, entry]) => ({ role: entry.role as 'display' | 'heading' | 'body' | 'mono' | 'label', family: entry.family }))
  const componentHints = recurringComponentClasses(html)

  const notes: string[] = []
  if (cssParts.length === 0) notes.push('No stylesheets or style blocks found; palette/type results are limited to inline declarations.')
  if (palette.length === 0) notes.push('No palette colors detected — confirm brand colors manually.')
  if (typeStack.length === 0) notes.push('No font families detected — confirm type stack manually.')
  if (componentHints.length === 0) notes.push('No recurring component-like classes detected.')
  if (tokens.customProps.size > 0) notes.push(`Found ${tokens.customProps.size} CSS custom properties (design-token source).`)

  return {
    url: base.toString(),
    palette,
    typeStack,
    componentHints,
    radiusScale: scaleTokens(tokens.radii, 10),
    elevationScale: scaleTokens(tokens.elevations, 10),
    title: htmlTitle(html),
    notes,
  }
}
