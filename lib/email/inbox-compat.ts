// lib/email/inbox-compat.ts
//
// Deterministic, rule-based email-client compatibility analyzer.
//
// This is NOT a render service. It does NOT call Litmus / Email-on-Acid and
// does NOT fabricate screenshots. It scans a finished HTML string and returns
// per-client, rule-based warnings that approximate how a handful of common
// email clients will mangle (or refuse) the markup.
//
// Everything here is a pure string/structural function — no Firestore, no
// network, no DOM. Same input always produces the same output. The companion
// React component (components/email/InboxPreview.tsx) wraps the same HTML in a
// client-specific CSS normalize variant for the visual side.

// ─── Client catalogue ────────────────────────────────────────────────────────

export type InboxClientId =
  | 'apple-mail'
  | 'gmail-web'
  | 'outlook-desktop'
  | 'outlook-com'
  | 'iphone-mail'
  | 'android-gmail'

export interface InboxClient {
  id: InboxClientId
  /** Human label shown on the tab. */
  label: string
  /** Short engine/quirk note shown under the tab. */
  engine: string
  /** Mobile clients render in a constrained viewport. */
  device: 'desktop' | 'mobile'
  /** Viewport width (px) the preview iframe is clamped to. */
  viewportWidth: number
  /** Gmail-family clients strip <style> in <head> and clip at ~102KB. */
  stripsHeadStyles: boolean
  /** Gmail clips the message past this byte size (0 = never clips). */
  clipBytes: number
  /** Outlook desktop uses Word's engine — no flex/grid/position, VML only. */
  wordEngine: boolean
}

// 102 KB — the Gmail message-clip threshold (matches preflight.ts).
const GMAIL_CLIP_BYTES = 102 * 1024

export const INBOX_CLIENTS: InboxClient[] = [
  {
    id: 'apple-mail',
    label: 'Apple Mail',
    engine: 'WebKit · macOS',
    device: 'desktop',
    viewportWidth: 600,
    stripsHeadStyles: false,
    clipBytes: 0,
    wordEngine: false,
  },
  {
    id: 'gmail-web',
    label: 'Gmail Web',
    engine: 'Blink · strips <style>, clips 102KB',
    device: 'desktop',
    viewportWidth: 600,
    stripsHeadStyles: true,
    clipBytes: GMAIL_CLIP_BYTES,
    wordEngine: false,
  },
  {
    id: 'outlook-desktop',
    label: 'Outlook Desktop',
    engine: 'Word engine · no flex/grid, VML only',
    device: 'desktop',
    viewportWidth: 600,
    stripsHeadStyles: false,
    clipBytes: 0,
    wordEngine: true,
  },
  {
    id: 'outlook-com',
    label: 'Outlook.com',
    engine: 'Webmail · rewrites CSS, prefixes classes',
    device: 'desktop',
    viewportWidth: 600,
    stripsHeadStyles: false,
    clipBytes: 0,
    wordEngine: false,
  },
  {
    id: 'iphone-mail',
    label: 'iPhone Mail',
    engine: 'WebKit · iOS',
    device: 'mobile',
    viewportWidth: 390,
    stripsHeadStyles: false,
    clipBytes: 0,
    wordEngine: false,
  },
  {
    id: 'android-gmail',
    label: 'Android Gmail',
    engine: 'Blink · strips <style>, clips 102KB',
    device: 'mobile',
    viewportWidth: 390,
    stripsHeadStyles: true,
    clipBytes: GMAIL_CLIP_BYTES,
    wordEngine: false,
  },
]

export function getInboxClient(id: InboxClientId): InboxClient {
  const c = INBOX_CLIENTS.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown inbox client: ${id}`)
  return c
}

// ─── Warning model ───────────────────────────────────────────────────────────

export type InboxSeverity = 'error' | 'warning' | 'info'

export interface InboxWarning {
  id: string
  severity: InboxSeverity
  title: string
  detail: string
  /** Practical fix. */
  recommendation: string
}

export interface InboxClientReport {
  clientId: InboxClientId
  label: string
  /** True when the client will badly mangle or clip the email. */
  hasBlocking: boolean
  warnings: InboxWarning[]
}

export interface InboxCompatReport {
  /** Byte size of the analysed HTML (UTF-8). */
  htmlBytes: number
  clients: InboxClientReport[]
  scannedAt: string
}

// ─── Shared HTML facts (computed once, reused per client) ─────────────────────

interface HtmlFacts {
  bytes: number
  // Style usage
  usesFlex: boolean
  usesGrid: boolean
  usesPosition: boolean
  usesFloat: boolean
  usesNegativeMargin: boolean
  usesMarginOnBlock: boolean
  usesBackgroundImage: boolean
  hasVmlFallback: boolean
  usesWebFont: boolean
  usesBorderRadius: boolean
  // Structure
  headStyleBlocks: number
  hasMsoConditional: boolean
  imageCount: number
  imagesMissingAlt: number
  externalStylesheet: boolean
  // Sample offending declarations for messaging
  flexSamples: string[]
  positionSamples: string[]
}

function inlineStyleStrings(html: string): string[] {
  const out: string[] = []
  const re = /style\s*=\s*("([^"]*)"|'([^']*)')/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[2] ?? m[3] ?? '')
  return out
}

function styleBlockContents(html: string): string[] {
  const out: string[] = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1] ?? '')
  return out
}

function computeFacts(html: string): HtmlFacts {
  const bytes = new TextEncoder().encode(html).length
  const inlineStyles = inlineStyleStrings(html)
  const styleBlocks = styleBlockContents(html)
  // CSS that lives anywhere a client might read (inline + <style>). We scan
  // both because Outlook ignores most of it regardless of where it sits.
  const allCss = [...inlineStyles, ...styleBlocks].join('\n').toLowerCase()
  const headStyleBlocks = (html.match(/<style\b/gi) ?? []).length

  const flexSamples: string[] = []
  const positionSamples: string[] = []
  for (const s of inlineStyles) {
    const low = s.toLowerCase()
    if (/display\s*:\s*(inline-)?flex/.test(low) || /display\s*:\s*grid/.test(low)) {
      if (flexSamples.length < 3) flexSamples.push(s.trim())
    }
    if (/(^|;|\s)position\s*:\s*(absolute|fixed|relative|sticky)/.test(low)) {
      if (positionSamples.length < 3) positionSamples.push(s.trim())
    }
  }

  // Margin on block elements: any inline margin (Outlook ignores margins on
  // many block elements and collapses spacing). We look for a real margin
  // value (not margin:0) in inline styles.
  const usesMarginOnBlock = inlineStyles.some((s) =>
    /(^|;|\s)margin(-top|-bottom|-left|-right)?\s*:\s*(?!0(px|em|%|\b))[^;]+/i.test(s),
  )
  const usesNegativeMargin = /margin[^;:]*:\s*-/.test(allCss)

  // background-image used where there's no MSO/VML fallback present.
  const usesBackgroundImage = /background(-image)?\s*:\s*[^;"']*url\s*\(/.test(allCss)
  const hasVmlFallback = /v:rect|v:fill|v:roundrect|v:image/i.test(html)

  // Web fonts: @font-face or a Google-Fonts style <link>.
  const usesWebFont =
    /@font-face/i.test(html) ||
    /<link\b[^>]*fonts\.googleapis\.com/i.test(html) ||
    /<link\b[^>]*fonts\.gstatic\.com/i.test(html)

  // Images + missing alt.
  let imageCount = 0
  let imagesMissingAlt = 0
  const imgRe = /<img\b([^>]*)>/gi
  let im: RegExpExecArray | null
  while ((im = imgRe.exec(html)) !== null) {
    imageCount++
    const attrs = im[1] ?? ''
    const altMatch = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const alt = altMatch ? (altMatch[1] ?? altMatch[2] ?? '') : ''
    if (!alt.trim()) imagesMissingAlt++
  }

  return {
    bytes,
    usesFlex: /display\s*:\s*(inline-)?flex/.test(allCss),
    usesGrid: /display\s*:\s*grid/.test(allCss),
    usesPosition: /(^|;|\s|\{)position\s*:\s*(absolute|fixed|relative|sticky)/.test(allCss),
    usesFloat: /(^|;|\s|\{)float\s*:\s*(left|right)/.test(allCss),
    usesNegativeMargin,
    usesMarginOnBlock,
    usesBackgroundImage,
    hasVmlFallback,
    usesWebFont,
    usesBorderRadius: /border-radius\s*:/.test(allCss),
    headStyleBlocks,
    hasMsoConditional: /<!--\[if\s+mso/i.test(html),
    imageCount,
    imagesMissingAlt,
    externalStylesheet: /<link\b[^>]*stylesheet/i.test(html),
    flexSamples,
    positionSamples,
  }
}

// ─── Per-client rules ────────────────────────────────────────────────────────

function warn(
  id: string,
  severity: InboxSeverity,
  title: string,
  detail: string,
  recommendation: string,
): InboxWarning {
  return { id, severity, title, detail, recommendation }
}

function analyzeClient(client: InboxClient, facts: HtmlFacts): InboxClientReport {
  const warnings: InboxWarning[] = []

  // ── Word-engine clients (Outlook desktop) ───────────────────────────────
  if (client.wordEngine) {
    if (facts.usesFlex || facts.usesGrid) {
      const sample = facts.flexSamples[0]
      warnings.push(
        warn(
          'outlook-flexbox-grid',
          'error',
          'Flexbox / CSS grid not supported',
          `Outlook Desktop renders with Microsoft Word's engine and ignores ` +
            `display:flex and display:grid entirely. Affected layouts collapse to ` +
            `stacked block flow.${sample ? ` Example: "${sample}".` : ''}`,
          'Use table-based layout (role="presentation" tables with <td> columns) instead of flex/grid.',
        ),
      )
    }
    if (facts.usesPosition) {
      const sample = facts.positionSamples[0]
      warnings.push(
        warn(
          'outlook-position',
          'error',
          'CSS positioning is dropped',
          `position:absolute/relative/fixed is ignored by the Word engine, so ` +
            `overlapped or offset elements snap back into normal flow.${sample ? ` Example: "${sample}".` : ''}`,
          'Remove positioning; achieve layout with nested tables and cell padding.',
        ),
      )
    }
    if (facts.usesFloat) {
      warnings.push(
        warn(
          'outlook-float',
          'warning',
          'CSS float is unreliable',
          'float:left/right behaves inconsistently in the Word engine and frequently ' +
            'breaks multi-column layouts.',
          'Replace floated columns with side-by-side table cells.',
        ),
      )
    }
    if (facts.usesMarginOnBlock) {
      warnings.push(
        warn(
          'outlook-margin',
          'warning',
          'Margins on block elements are inconsistent',
          'Outlook Desktop ignores or collapses margins on many block elements ' +
            '(p, div, h1–h3). Vertical rhythm will differ from other clients.',
          'Use cell padding (<td style="padding:…">) or spacer rows instead of margins for spacing.',
        ),
      )
    }
    if (facts.usesBorderRadius) {
      warnings.push(
        warn(
          'outlook-border-radius',
          'info',
          'Rounded corners flatten to squares',
          'border-radius is ignored by the Word engine — buttons and cards render with square corners.',
          'Acceptable degradation. For pixel-perfect buttons, add a VML <v:roundrect> fallback (the builder already does this for button blocks).',
        ),
      )
    }
    if (facts.usesBackgroundImage && !facts.hasVmlFallback) {
      warnings.push(
        warn(
          'outlook-bg-image',
          'warning',
          'CSS background-image will not show',
          'The Word engine does not paint CSS background-image. Without a VML ' +
            '<v:rect>/<v:fill> fallback the background is blank in Outlook Desktop.',
          'Add a VML background fallback, or use a solid background-color and a foreground <img>.',
        ),
      )
    }
    if (facts.usesWebFont) {
      warnings.push(
        warn(
          'outlook-webfont',
          'info',
          'Web fonts fall back to a system font',
          'Outlook Desktop does not load @font-face / Google Fonts. Text renders ' +
            'in the declared fallback font (or Times New Roman if none).',
          'Always declare a robust font-family fallback stack (e.g. Arial, Helvetica, sans-serif).',
        ),
      )
    }
  }

  // ── Gmail-family clients (head <style> stripping + clipping) ─────────────
  if (client.stripsHeadStyles) {
    if (facts.headStyleBlocks > 0) {
      warnings.push(
        warn(
          'gmail-strips-style',
          'warning',
          '<style> in <head> is partially stripped',
          `${client.label} removes <head> <style> blocks in many ` +
            'contexts (notably forwarded mail and non-clipped large messages), so ' +
            'media queries and class-based rules may not apply. Inline styles always survive.',
          'Keep all critical styling inline. Treat <style> rules (media queries, dark-mode) as progressive enhancement only.',
        ),
      )
    }
    if (client.clipBytes > 0 && facts.bytes > client.clipBytes) {
      warnings.push(
        warn(
          'gmail-clip',
          'error',
          'Message exceeds the 102KB Gmail clip limit',
          `HTML is ${(facts.bytes / 1024).toFixed(1)} KB. Gmail clips everything past ` +
            `${(client.clipBytes / 1024).toFixed(0)} KB behind a "[Message clipped] View entire message" ` +
            'link — which usually hides the footer and unsubscribe link.',
          'Trim repeated inline styles / structure, or split into multiple emails, to get under 102KB.',
        ),
      )
    }
  }

  // ── Universal checks (apply to every client, severity varies) ────────────
  if (facts.imagesMissingAlt > 0) {
    // Gmail/Outlook block images by default → alt text is what the recipient sees.
    const blockingClient = client.id === 'gmail-web' || client.id === 'android-gmail' || client.wordEngine
    warnings.push(
      warn(
        'missing-alt-text',
        blockingClient ? 'warning' : 'info',
        'Images missing alt text',
        `${facts.imagesMissingAlt} of ${facts.imageCount} <img> tags have no alt attribute. ` +
          `${client.label} blocks remote images until the recipient opts in; with no alt text those ` +
          'regions render blank.',
        'Add a short descriptive alt to every image.',
      ),
    )
  }

  if (facts.externalStylesheet) {
    warnings.push(
      warn(
        'external-stylesheet',
        'error',
        'External stylesheet is stripped',
        `<link rel="stylesheet"> is removed by ${client.label} (and every major ` +
          'email client). Any styles it carried will be lost.',
        'Inline the styles directly on each element.',
      ),
    )
  }

  if (facts.usesNegativeMargin && !client.wordEngine) {
    warnings.push(
      warn(
        'negative-margin',
        'info',
        'Negative margins are risky',
        'Negative margins are clipped or ignored in several clients and can push ' +
          'content outside the visible area.',
        'Avoid negative margins; use padding and spacer rows for offsets.',
      ),
    )
  }

  const hasBlocking = warnings.some((w) => w.severity === 'error')
  return { clientId: client.id, label: client.label, hasBlocking, warnings }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Analyse a finished email HTML string and return per-client compatibility
 * warnings. Deterministic and side-effect-free.
 */
export function analyzeInboxCompat(html: string): InboxCompatReport {
  const safeHtml = html ?? ''
  const facts = computeFacts(safeHtml)
  return {
    htmlBytes: facts.bytes,
    clients: INBOX_CLIENTS.map((c) => analyzeClient(c, facts)),
    scannedAt: new Date().toISOString(),
  }
}

/** Convenience: warnings for a single client only. */
export function analyzeInboxCompatForClient(
  html: string,
  clientId: InboxClientId,
): InboxClientReport {
  const facts = computeFacts(html ?? '')
  return analyzeClient(getInboxClient(clientId), facts)
}

// ─── Client-specific HTML normalisation (for the visual preview) ─────────────
//
// Wraps the email HTML in a deterministic, client-approximating shell. This is
// a heuristic visual aid, NOT a faithful render. Each variant injects a small
// CSS reset that mimics the named client's most visible quirks.

export interface WrapOptions {
  /** Force-strip <style> blocks from <head> (Gmail emulation). */
  stripHeadStyles?: boolean
}

/**
 * Produce an iframe-ready srcDoc string for a given client that approximates
 * that client's rendering quirks around the supplied email HTML.
 *
 * Deterministic. Does not fabricate chrome/screenshots — it just normalises
 * the email body the way the client's engine would.
 */
export function wrapHtmlForClient(html: string, clientId: InboxClientId): string {
  const client = getInboxClient(clientId)
  let body = html ?? ''

  // Gmail emulation: strip <style> blocks (class/media-query rules are dropped).
  if (client.stripsHeadStyles) {
    body = body.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    // Gmail clips past 102KB — emulate by truncating and appending a clip marker.
    const bytes = new TextEncoder().encode(body).length
    if (client.clipBytes > 0 && bytes > client.clipBytes) {
      // Truncate on a byte budget (approx — slice by chars, good enough for the marker).
      const ratio = client.clipBytes / bytes
      const cut = Math.floor(body.length * ratio)
      body =
        body.slice(0, cut) +
        `<div style="padding:16px;text-align:center;font-family:sans-serif;font-size:13px;color:#5f6368;background:#f1f3f4;border-top:1px solid #dadce0;">[Message clipped]&nbsp; View entire message</div>`
    }
  }

  // Word-engine emulation: neutralise unsupported layout CSS so the preview
  // approximates Outlook's collapse-to-block-flow behaviour.
  const normalizeCss = client.wordEngine
    ? `
    *, *::before, *::after {
      /* Outlook ignores these — flatten them in the preview */
      display: revert;
    }
    [style*="display:flex" i], [style*="display: flex" i],
    [style*="display:grid" i], [style*="display: grid" i] { display: block !important; }
    [style*="position:absolute" i], [style*="position: absolute" i],
    [style*="position:fixed" i], [style*="position: fixed" i],
    [style*="position:relative" i], [style*="position: relative" i] { position: static !important; }
    [style*="float:" i] { float: none !important; }
    * { border-radius: 0 !important; }
    body { font-family: 'Times New Roman', Times, serif; }
  `
    : ''

  const viewportCss =
    client.device === 'mobile'
      ? `html, body { width: ${client.viewportWidth}px; max-width: ${client.viewportWidth}px; overflow-x: hidden; }`
      : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${client.viewportWidth}, initial-scale=1" />
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  ${viewportCss}
  ${normalizeCss}
</style>
</head>
<body>
${body}
</body>
</html>`
}
