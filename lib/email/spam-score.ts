// lib/email/spam-score.ts
//
// Rule-based, SpamAssassin-style spam-likelihood analyzer for marketing email.
//
// Pure string/structural — no Firestore, no network, no template rendering.
// Callers render the email document to subject + HTML + text first and hand
// the finished strings here.
//
// Scoring model (documented intent):
//   - Higher score = spammier. Range is clamped to 0–10.
//   - Each rule contributes a positive weight when it HITS. A couple of rules
//     are "good signals" with NEGATIVE weight (e.g. an unsubscribe link), so a
//     clean, compliant email can pull its score back toward 0 even if a single
//     borderline rule fired.
//   - The raw weighted sum is clamped into [0, 10]. We never go below 0.
//
// The rule set mirrors classic SpamAssassin heuristics adapted to a small,
// deterministic subset that we can reason about offline.

export type SpamVerdict = 'clean' | 'low-risk' | 'spammy' | 'high-risk'

export interface SpamRuleResult {
  id: string
  label: string
  /** Weight contributed when `hit` is true. May be negative (good signal). */
  points: number
  hit: boolean
  /** Human explanation shown only when hit. */
  detail?: string
}

export interface SpamScoreResult {
  /** 0–10, higher = spammier. */
  score: number
  verdict: SpamVerdict
  rules: SpamRuleResult[]
  scannedAt: string
}

export interface SpamScoreInput {
  subject: string
  html: string
  /** Plain-text alternative. Empty string if none provided. */
  text?: string
}

// ─── Lexicons ────────────────────────────────────────────────────────────────

// Classic high-signal spam words/phrases (matched case-insensitively, word-ish).
const SPAM_PHRASES: string[] = [
  'free',
  'act now',
  'limited time',
  '100% free',
  '100% guaranteed',
  'guarantee',
  'click here',
  'buy now',
  'buy direct',
  'order now',
  'cash bonus',
  'cash',
  'congratulations',
  'earn money',
  'earn $',
  'extra income',
  'double your income',
  'make money',
  'lowest price',
  'best price',
  'risk free',
  'risk-free',
  'no obligation',
  'no fees',
  'no cost',
  'no credit check',
  'winner',
  'you have been selected',
  "you're a winner",
  'cheap',
  'discount',
  'special promotion',
  'this is not spam',
  'not spam',
  'increase sales',
  'work from home',
  'weight loss',
  'viagra',
  'pharmacy',
  'casino',
  'crypto',
  'investment',
  'urgent',
  'final notice',
  'expires',
  'limited offer',
]

// Particularly aggressive money/financial markers (weighted higher when in subject).
const MONEY_MARKERS = /\$\$+|\$[0-9]|€[0-9]|£[0-9]|\b\d+%\s*(off|free|guaranteed)\b/i

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function countLinks(html: string): number {
  const m = html.match(/<a\b[^>]*\bhref\s*=/gi)
  return m ? m.length : 0
}

function countImages(html: string): number {
  const m = html.match(/<img\b/gi)
  return m ? m.length : 0
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  const lower = haystack
  while ((idx = lower.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

function exclamationCount(s: string): number {
  return (s.match(/!/g) ?? []).length
}

function allCapsWordCount(s: string): number {
  // Words of 3+ chars that are entirely uppercase letters.
  const words = s.split(/\s+/)
  let n = 0
  for (const w of words) {
    const clean = w.replace(/[^A-Za-z]/g, '')
    if (clean.length >= 3 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) n++
  }
  return n
}

function capsRatio(s: string): number {
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (letters.length < 5) return 0
  const upper = s.replace(/[^A-Z]/g, '').length
  return upper / letters.length
}

// ─── Rule definitions ────────────────────────────────────────────────────────

function buildRules(input: SpamScoreInput): SpamRuleResult[] {
  const subject = (input.subject ?? '').trim()
  const html = input.html ?? ''
  const text = (input.text ?? '').trim()
  const visibleText = stripTags(html)
  const lowerSubject = subject.toLowerCase()
  const lowerBody = visibleText.toLowerCase()
  const linkCount = countLinks(html)
  const imageCount = countImages(html)
  const bodyLen = visibleText.length

  const rules: SpamRuleResult[] = []

  // 1. Spammy words in SUBJECT (weighted per match, capped).
  {
    const matched = SPAM_PHRASES.filter((p) => lowerSubject.includes(p))
    const points = Math.min(matched.length * 0.6, 2.0)
    rules.push({
      id: 'subject-spam-words',
      label: 'Spam-trigger words in subject',
      points: Number(points.toFixed(2)),
      hit: matched.length > 0,
      detail: matched.length
        ? `Subject contains ${matched.length} trigger phrase(s): ${matched.slice(0, 5).map((w) => `"${w}"`).join(', ')}.`
        : undefined,
    })
  }

  // 2. Spammy words in BODY (lower weight per match — bodies are longer).
  {
    const matched = SPAM_PHRASES.filter((p) => lowerBody.includes(p))
    const points = Math.min(matched.length * 0.25, 1.5)
    rules.push({
      id: 'body-spam-words',
      label: 'Spam-trigger words in body',
      points: Number(points.toFixed(2)),
      hit: matched.length > 0,
      detail: matched.length
        ? `Body contains ${matched.length} trigger phrase(s): ${matched.slice(0, 6).map((w) => `"${w}"`).join(', ')}.`
        : undefined,
    })
  }

  // 3. ALL-CAPS / SHOUTING subject.
  {
    const ratio = capsRatio(subject)
    const hit = ratio > 0.6
    rules.push({
      id: 'subject-all-caps',
      label: 'Shouting (ALL-CAPS) subject',
      points: hit ? 1.2 : 0,
      hit,
      detail: hit ? `${Math.round(ratio * 100)}% of subject letters are uppercase.` : undefined,
    })
  }

  // 4. Excessive exclamation marks (subject + body).
  {
    const subjBang = exclamationCount(subject)
    const bodyBang = exclamationCount(visibleText)
    const total = subjBang + bodyBang
    // Subject !!! is a strong signal; multiple !!! in body adds up.
    let points = 0
    if (subjBang >= 2) points += 0.8
    if (subjBang >= 3) points += 0.4
    if (bodyBang >= 4) points += 0.5
    points = Math.min(points, 1.5)
    const hit = points > 0
    rules.push({
      id: 'excessive-exclamation',
      label: 'Excessive exclamation marks',
      points: Number(points.toFixed(2)),
      hit,
      detail: hit
        ? `Found ${subjBang} "!" in subject and ${bodyBang} in body. Multiple exclamation marks are a classic spam signal.`
        : undefined,
    })
  }

  // 5. Money / dollar markers ($$$, $5,000, 90% OFF).
  {
    const subjHit = MONEY_MARKERS.test(subject) || /\${2,}/.test(subject)
    const bodyHit = /\${3,}/.test(visibleText) || countOccurrences(lowerBody, '$$$') > 0
    let points = 0
    if (subjHit) points += 1.0
    if (bodyHit) points += 0.6
    points = Math.min(points, 1.6)
    const hit = points > 0
    rules.push({
      id: 'money-markers',
      label: 'Money / price hype ($$$, % off)',
      points: Number(points.toFixed(2)),
      hit,
      detail: hit ? 'Aggressive money/discount markers ($$$, large prices, "% off") detected.' : undefined,
    })
  }

  // 6. ALL-CAPS words in body (3+ uppercase words is a shouting signal).
  {
    const n = allCapsWordCount(visibleText)
    const hit = n >= 4
    rules.push({
      id: 'body-all-caps-words',
      label: 'Many ALL-CAPS words in body',
      points: hit ? Math.min(0.4 + (n - 4) * 0.1, 1.0) : 0,
      hit,
      detail: hit ? `${n} fully-uppercase words in the body.` : undefined,
    })
  }

  // 7. Missing unsubscribe link (compliance + strong spam signal).
  {
    const hasUnsub = /unsubscribe/i.test(html) || /unsubscribe/i.test(text) || /\{\{\s*unsubscribeurl\s*\}\}/i.test(html)
    const hit = !hasUnsub
    rules.push({
      id: 'missing-unsubscribe',
      label: 'No unsubscribe link',
      points: hit ? 2.0 : 0,
      hit,
      detail: hit ? 'No unsubscribe link found. Required by CAN-SPAM/GDPR and heavily penalised by filters.' : undefined,
    })
  }

  // 8. Too many links.
  {
    let points = 0
    if (linkCount > 30) points = 1.2
    else if (linkCount > 20) points = 0.8
    else if (linkCount > 12) points = 0.4
    const hit = points > 0
    rules.push({
      id: 'too-many-links',
      label: 'Too many links',
      points,
      hit,
      detail: hit ? `Body has ${linkCount} links. A high link count correlates with spam.` : undefined,
    })
  }

  // 9. High image-to-text ratio / image-heavy with little text.
  {
    // Spammers hide text inside images to dodge content filters.
    const lowText = bodyLen < 120
    let points = 0
    if (imageCount >= 1 && lowText) {
      points = imageCount >= 3 ? 1.2 : 0.7
    }
    const hit = points > 0
    rules.push({
      id: 'image-heavy-low-text',
      label: 'Image-heavy with little text',
      points,
      hit,
      detail: hit
        ? `${imageCount} image(s) but only ${bodyLen} characters of visible text. Filters treat image-only emails as suspicious.`
        : undefined,
    })
  }

  // 10. Missing plain-text part (multipart best practice).
  {
    const hit = text.length === 0 && html.trim().length > 0
    rules.push({
      id: 'missing-text-part',
      label: 'Missing plain-text alternative',
      points: hit ? 0.8 : 0,
      hit,
      detail: hit ? 'No plain-text alternative. Filters compare text vs HTML; a missing text part raises suspicion.' : undefined,
    })
  }

  // 11. Subject contains money/urgency + caps combo (compound penalty).
  {
    const urgency = /\b(urgent|act now|final notice|expires|last chance|limited time)\b/i.test(subject)
    const hit = urgency
    rules.push({
      id: 'subject-urgency',
      label: 'Urgency / pressure language in subject',
      points: hit ? 0.7 : 0,
      hit,
      detail: hit ? 'Subject uses urgency/pressure phrasing ("act now", "final notice", "expires").' : undefined,
    })
  }

  // 12. Suspicious / hidden-text styling (white-on-white, font-size:0).
  {
    const zeroFont = /font-size\s*:\s*0(px|pt|em)?\b/i.test(html)
    const whiteOnWhite = /color\s*:\s*#fff(fff)?\b[^}"']*background[^}"']*#fff/i.test(html)
    // A display:none element carrying a large chunk of real text is a hide trick.
    const hiddenChunk = /<[^>]+style="[^"]*display\s*:\s*none[^"]*"[^>]*>[^<]{40,}/i.test(html)
    const hit = zeroFont || whiteOnWhite || hiddenChunk
    rules.push({
      id: 'hidden-text',
      label: 'Hidden / invisible text',
      points: hit ? 1.5 : 0,
      hit,
      detail: hit ? 'Possible hidden text (font-size:0, white-on-white, or large display:none content) — a strong spam signal.' : undefined,
    })
  }

  // 13. GOOD SIGNAL — has a clear unsubscribe AND a physical-address-ish footer.
  //     Negative weight rewards a compliant, well-formed email.
  {
    const hasUnsub = /unsubscribe/i.test(html) || /\{\{\s*unsubscribeurl\s*\}\}/i.test(html)
    const hasText = text.length > 40
    const good = hasUnsub && hasText && bodyLen >= 120
    rules.push({
      id: 'compliant-structure',
      label: 'Compliant structure (unsubscribe + real text)',
      points: good ? -1.0 : 0,
      hit: good,
      detail: good ? 'Has an unsubscribe link, a plain-text part, and substantive body text — pulls the score down.' : undefined,
    })
  }

  return rules
}

function verdictForScore(score: number): SpamVerdict {
  if (score < 2) return 'clean'
  if (score < 4) return 'low-risk'
  if (score < 7) return 'spammy'
  return 'high-risk'
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Score an email's spam likelihood. Returns 0–10 (higher = spammier),
 * a verdict, and the full list of rules with per-rule weights and hit flags.
 * Deterministic and side-effect-free.
 */
export function scoreSpam(input: SpamScoreInput): SpamScoreResult {
  const rules = buildRules(input)
  const raw = rules.reduce((sum, r) => (r.hit ? sum + r.points : sum), 0)
  const score = Math.max(0, Math.min(10, Number(raw.toFixed(2))))
  return {
    score,
    verdict: verdictForScore(score),
    rules,
    scannedAt: new Date().toISOString(),
  }
}
