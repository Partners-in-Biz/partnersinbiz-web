/**
 * AI Email Generators
 *
 * Generators for email content used inside the Partners in Biz email platform.
 * Backed by Vercel AI Gateway via the `ai` package's `generateText` — same
 * call pattern as `lib/seo/tools/ai-generators.ts`.
 *
 * Generators ALWAYS return a usable result. When the model returns garbage
 * for JSON-structured outputs, the helpers parse-retry once and then fall
 * back to a salvaged inline shape so the caller never gets undefined.
 */
import { generateText } from 'ai'
import { BRIEF_MODEL, DRAFT_MODEL } from '@/lib/ai/client'
import { validateDocument } from '@/lib/email-builder/validate'
import { DEFAULT_THEME, makeBlockId } from '@/lib/email-builder/types'
import type {
  Block,
  EmailDocument,
  FooterBlockProps,
  HeroBlockProps,
} from '@/lib/email-builder/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BrandVoice {
  tone: 'professional' | 'friendly' | 'bold' | 'playful' | 'authoritative' | 'founder-led'
  audience: string
  doNotUseWords: string[]
  sampleLines: string[]
  signOff?: string
  ctaStyle?: 'soft' | 'direct'
}

export interface GenerateEmailInput {
  goal: string
  voice: BrandVoice
  audienceDescription?: string
  context?: string
  contentLength?: 'short' | 'medium' | 'long'
  cta?: { text: string; url: string }
  outputMode?: 'document' | 'inline'
}

export interface GenerateEmailResult {
  subject: string
  preheader: string
  bodyHtml: string
  bodyText: string
  document?: EmailDocument
  modelUsed: string
  generatedAt: string
}

export interface GenerateSequenceInput {
  name: string
  goal: string
  voice: BrandVoice
  steps: number
  cadence: 'aggressive' | 'normal' | 'patient'
  audienceDescription?: string
  context?: string
}

export interface GeneratedSequenceStep {
  stepNumber: number
  delayDays: number
  subject: string
  bodyHtml: string
  bodyText: string
}

export interface GenerateNewsletterInput {
  topic: string
  voice: BrandVoice
  stories: Array<{
    heading: string
    bodyHint: string
    ctaText?: string
    ctaUrl?: string
    imageUrl?: string
  }>
  orgName: string
  unsubscribeUrl?: string
}

export interface GenerateWinbackInput {
  contactName: string
  contactCompany?: string
  daysSinceLastInteraction: number
  lastTopicOrProduct?: string
  voice: BrandVoice
  offer?: { description: string; ctaText: string; ctaUrl: string }
}

export interface RewriteInput {
  body: string
  voice: BrandVoice
  instruction?: 'tighten' | 'expand' | 'soften' | 'sharpen' | 'translate-sa-english'
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const PIB_BANNED_WORDS = [
  'leverage',
  'supercharge',
  'synergy',
  'unlock',
  'delve',
  'in today’s fast-paced world',
  'game-changer',
  'revolutionise',
  'revolutionize',
  'seamless',
  'cutting-edge',
  'next-level',
]

function lengthToWords(len: GenerateEmailInput['contentLength']): { min: number; target: number; max: number } {
  switch (len) {
    case 'short':
      return { min: 30, target: 50, max: 90 }
    case 'long':
      return { min: 220, target: 300, max: 400 }
    case 'medium':
    default:
      return { min: 100, target: 150, max: 220 }
  }
}

function bannedWordsList(voice: BrandVoice): string[] {
  return Array.from(new Set([...(voice.doNotUseWords ?? []), ...PIB_BANNED_WORDS]))
}

function voiceBlock(voice: BrandVoice): string {
  return [
    `Tone: ${voice.tone}.`,
    `Audience: ${voice.audience}.`,
    voice.ctaStyle ? `CTA style: ${voice.ctaStyle}.` : '',
    voice.signOff ? `Sign-off: "${voice.signOff}".` : '',
    voice.sampleLines.length > 0
      ? `Sample lines you have written before (match this rhythm and word choice):\n${voice.sampleLines
          .map((s, i) => `  ${i + 1}. ${s}`)
          .join('\n')}`
      : '',
    `Banned words/phrases (do NOT use under any circumstance): ${bannedWordsList(voice).join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Extract the first JSON value from a string. Strips ```json fences and prose
 * around the JSON. Returns null if nothing parseable is found.
 */
function extractJson<T = unknown>(raw: string): T | null {
  if (!raw) return null
  // Strip code fences
  let text = raw.trim()
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) text = fenceMatch[1].trim()
  try {
    return JSON.parse(text) as T
  } catch {
    // Find first { ... } or [ ... ] block balanced naively
    const firstBrace = text.indexOf('{')
    const firstBracket = text.indexOf('[')
    let start = -1
    let open = '{'
    let close = '}'
    if (firstBrace === -1 && firstBracket === -1) return null
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      start = firstBracket
      open = '['
      close = ']'
    } else {
      start = firstBrace
    }
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) {
          const slice = text.slice(start, i + 1)
          try {
            return JSON.parse(slice) as T
          } catch {
            return null
          }
        }
      }
    }
    return null
  }
}

/** Strip HTML to plain text — only safe for the small inline-tag subset. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|li|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Take a paragraph-style HTML string and split it into EmailDocument
 * paragraph + heading blocks. Used both as the salvage path for failed
 * document generation and for the inline -> document conversion.
 */
function htmlBodyToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  // Pull headings out as heading blocks; everything else into paragraph blocks.
  // Use a simple tag-aware scanner.
  const regex = /<\s*(h2|h3|p|ul|ol)([^>]*)>([\s\S]*?)<\s*\/\1\s*>/gi
  let match: RegExpExecArray | null
  let lastIndex = 0
  let consumed = false
  while ((match = regex.exec(html)) !== null) {
    consumed = true
    const tag = match[1].toLowerCase()
    const inner = match[3].trim()
    // Capture any text before this match as a paragraph
    const between = html.slice(lastIndex, match.index).trim()
    if (between) {
      blocks.push({
        id: makeBlockId(),
        type: 'paragraph',
        props: { html: between, align: 'left' },
      })
    }
    if (tag === 'h2') {
      blocks.push({
        id: makeBlockId(),
        type: 'heading',
        props: { text: htmlToText(inner), level: 2, align: 'left' },
      })
    } else if (tag === 'h3') {
      blocks.push({
        id: makeBlockId(),
        type: 'heading',
        props: { text: htmlToText(inner), level: 3, align: 'left' },
      })
    } else {
      blocks.push({
        id: makeBlockId(),
        type: 'paragraph',
        props: { html: tag === 'p' ? inner : match[0], align: 'left' },
      })
    }
    lastIndex = regex.lastIndex
  }
  const tail = html.slice(lastIndex).trim()
  if (tail) {
    blocks.push({
      id: makeBlockId(),
      type: 'paragraph',
      props: { html: tail, align: 'left' },
    })
  }
  if (!consumed && !tail) {
    // No tags at all — treat the whole string as one paragraph.
    if (html.trim().length > 0) {
      blocks.push({
        id: makeBlockId(),
        type: 'paragraph',
        props: { html: html.trim(), align: 'left' },
      })
    }
  }
  return blocks
}

// ---------------------------------------------------------------------------
// EmailDocument JSON schema (string baked into prompts)
// ---------------------------------------------------------------------------

const EMAIL_DOCUMENT_SCHEMA = `
EmailDocument JSON shape:
{
  "subject": string,
  "preheader": string,
  "theme": {
    "primaryColor": "#F5A623",
    "textColor": "#0A0A0B",
    "backgroundColor": "#F4F4F5",
    "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "contentWidth": 600
  },
  "blocks": Block[]
}

Block types — pick from these, set "id" to a short unique string (e.g. "b1", "b2"):
  { id, type: "hero",      props: { backgroundColor, headline, subhead?, ctaText?, ctaUrl?, textColor? } }
  { id, type: "heading",   props: { text, level: 2|3, align: "left"|"center"|"right" } }
  { id, type: "paragraph", props: { html, align } }   // html may only contain <b>, <i>, <a>, <br>
  { id, type: "button",    props: { text, url, color, textColor, align, fullWidth: false } }
  { id, type: "image",     props: { src, alt, width?, align } }
  { id, type: "divider",   props: { color: "#E5E7EB", thickness: 1 } }
  { id, type: "spacer",    props: { height: 24 } }
  { id, type: "footer",    props: { orgName, address, unsubscribeUrl, social?: { twitter?, linkedin? } } }

Rules:
  - Always include at least one paragraph block. Always include a footer block last.
  - Do not nest blocks. Do not invent block types.
  - Output VALID JSON only — no markdown fences, no commentary, no preamble.
`

function buildSalvageDocument(opts: {
  subject: string
  preheader: string
  bodyHtml: string
  orgName?: string
  unsubscribeUrl?: string
}): EmailDocument {
  const blocks: Block[] = htmlBodyToBlocks(opts.bodyHtml)
  const footerProps: FooterBlockProps = {
    orgName: opts.orgName ?? '{{orgName}}',
    address: 'Pretoria, Gauteng, South Africa',
    unsubscribeUrl: opts.unsubscribeUrl ?? '{{unsubscribeUrl}}',
  }
  blocks.push({ id: makeBlockId(), type: 'footer', props: footerProps })
  return {
    subject: opts.subject,
    preheader: opts.preheader,
    blocks,
    theme: { ...DEFAULT_THEME },
  }
}

/**
 * Ensure every block has a string id (some models drop ids). Validate the doc;
 * on failure, return a salvaged version built from the JSON's subject/preheader
 * plus a single paragraph holding the JSON as text.
 */
function coerceDocument(
  raw: unknown,
  fallback: { subject: string; preheader: string; bodyHtml: string },
): EmailDocument {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.blocks)) {
      obj.blocks = (obj.blocks as Array<Record<string, unknown>>).map((b, i) => {
        if (!b || typeof b !== 'object') return b
        if (typeof b.id !== 'string' || b.id.length === 0) b.id = `gen_${i}_${makeBlockId()}`
        return b
      })
    }
    if (!obj.theme || typeof obj.theme !== 'object') obj.theme = { ...DEFAULT_THEME }
    if (typeof obj.subject !== 'string') obj.subject = fallback.subject
    if (typeof obj.preheader !== 'string') obj.preheader = fallback.preheader
  }
  const v = validateDocument(raw)
  if (v.ok) return v.doc
  return buildSalvageDocument(fallback)
}

// ---------------------------------------------------------------------------
// generateEmail
// ---------------------------------------------------------------------------

export async function generateEmail(input: GenerateEmailInput): Promise<GenerateEmailResult> {
  const mode = input.outputMode ?? 'document'
  const len = lengthToWords(input.contentLength)
  const now = new Date().toISOString()

  if (mode === 'inline') {
    const result = await generateInlineEmail(input, len)
    return { ...result, modelUsed: DRAFT_MODEL, generatedAt: now }
  }

  // document mode
  const documentPrompt = buildDocumentEmailPrompt(input, len)
  let parsed: unknown = null
  let raw = ''
  try {
    const { text } = await generateText({
      model: DRAFT_MODEL,
      system: documentPrompt.system,
      prompt: documentPrompt.user,
      maxOutputTokens: 2000,
      temperature: 0.75,
    })
    raw = text
    parsed = extractJson(text)
  } catch {
    parsed = null
  }

  if (!parsed) {
    // Retry once with a stricter instruction.
    try {
      const { text } = await generateText({
        model: DRAFT_MODEL,
        system: documentPrompt.system,
        prompt: `${documentPrompt.user}\n\nThe previous attempt produced unparseable output. Return ONLY the JSON object, no surrounding text.`,
        maxOutputTokens: 2000,
        temperature: 0.4,
      })
      raw = text
      parsed = extractJson(text)
    } catch {
      parsed = null
    }
  }

  // Pull subject/preheader/body from JSON if we got one; otherwise fall back to inline.
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const fallbackBody =
      typeof obj.bodyHtml === 'string'
        ? (obj.bodyHtml as string)
        : `<p>${htmlToText(raw).slice(0, 800)}</p>`
    const doc = coerceDocument(parsed, {
      subject: typeof obj.subject === 'string' ? (obj.subject as string) : input.goal,
      preheader: typeof obj.preheader === 'string' ? (obj.preheader as string) : '',
      bodyHtml: fallbackBody,
    })
    const bodyHtml = blocksToHtml(doc.blocks)
    return {
      subject: doc.subject,
      preheader: doc.preheader,
      bodyHtml,
      bodyText: htmlToText(bodyHtml),
      document: doc,
      modelUsed: DRAFT_MODEL,
      generatedAt: now,
    }
  }

  // Total fallback — call the inline generator and wrap it.
  const inline = await generateInlineEmail(input, len)
  const doc = buildSalvageDocument({
    subject: inline.subject,
    preheader: inline.preheader,
    bodyHtml: inline.bodyHtml,
  })
  return {
    ...inline,
    document: doc,
    modelUsed: DRAFT_MODEL,
    generatedAt: now,
  }
}

function buildDocumentEmailPrompt(
  input: GenerateEmailInput,
  len: { min: number; target: number; max: number },
): { system: string; user: string } {
  const ctaLine = input.cta
    ? `Include a button block with text "${input.cta.text}" linking to ${input.cta.url}.`
    : 'Include a single primary CTA button block linking to {{ctaUrl}} (the user will replace it).'

  const system = [
    'You are a senior email copywriter for Partners in Biz, a South African client-growth platform.',
    'You write founder-direct emails in British/SA English. No fluff, no marketing-speak.',
    'You output ONLY a single JSON object matching the EmailDocument schema below — no preamble, no fences, no commentary.',
    EMAIL_DOCUMENT_SCHEMA,
    voiceBlock(input.voice),
    'Length budget for the body paragraphs combined: ' +
      `${len.min}-${len.max} words (target ~${len.target}).`,
    'Structure the email as: 1 hero or heading block, 2-4 paragraph blocks (with maybe 1 heading break), 1 button block, 1 divider, 1 footer.',
    'Subject line: under 60 chars, specific, no clickbait. Preheader: under 90 chars, complements the subject without repeating it.',
  ].join('\n\n')

  const user = [
    `Goal: ${input.goal}`,
    input.audienceDescription ? `Recipient: ${input.audienceDescription}` : '',
    input.context ? `Context:\n${input.context}` : '',
    ctaLine,
    'Write the EmailDocument JSON now.',
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}

async function generateInlineEmail(
  input: GenerateEmailInput,
  len: { min: number; target: number; max: number },
): Promise<Omit<GenerateEmailResult, 'modelUsed' | 'generatedAt'>> {
  const ctaLine = input.cta
    ? `Close with a clear call to action linking to ${input.cta.url} using the anchor text "${input.cta.text}".`
    : 'Close with a single soft CTA line.'

  const system = [
    'You are a senior email copywriter for Partners in Biz, a South African client-growth platform.',
    'You write founder-direct, specific, no-fluff emails in British/SA English.',
    'Output JSON ONLY with keys: subject (string), preheader (string), bodyHtml (string).',
    'bodyHtml may use ONLY these inline tags: <h2>, <h3>, <p>, <ul>, <li>, <a>, <b>, <i>, <br>, <hr>.',
    'No <html>/<head>/<body> wrappers. No <style> or <script>. No tables.',
    voiceBlock(input.voice),
    `Length: ${len.min}-${len.max} words of body copy (target ~${len.target}).`,
    'Subject under 60 chars. Preheader under 90 chars. Do NOT repeat the subject in the preheader.',
  ].join('\n\n')

  const user = [
    `Goal: ${input.goal}`,
    input.audienceDescription ? `Recipient: ${input.audienceDescription}` : '',
    input.context ? `Context:\n${input.context}` : '',
    ctaLine,
    'Return the JSON now.',
  ]
    .filter(Boolean)
    .join('\n\n')

  let raw = ''
  let parsed: { subject?: string; preheader?: string; bodyHtml?: string } | null = null
  try {
    const { text } = await generateText({
      model: DRAFT_MODEL,
      system,
      prompt: user,
      maxOutputTokens: 1500,
      temperature: 0.75,
    })
    raw = text
    parsed = extractJson<{ subject?: string; preheader?: string; bodyHtml?: string }>(text)
  } catch {
    parsed = null
  }

  if (!parsed || typeof parsed.bodyHtml !== 'string') {
    // Plain text fallback — wrap raw model output as a single paragraph.
    const fallbackBody = raw.trim()
      ? `<p>${htmlToText(raw).replace(/\n+/g, '</p><p>')}</p>`
      : `<p>${input.goal}</p>`
    return {
      subject:
        (parsed?.subject && typeof parsed.subject === 'string' && parsed.subject) ||
        input.goal.slice(0, 60),
      preheader:
        (parsed?.preheader && typeof parsed.preheader === 'string' && parsed.preheader) || '',
      bodyHtml: fallbackBody,
      bodyText: htmlToText(fallbackBody),
    }
  }
  const subject = (parsed.subject ?? '').toString().slice(0, 120) || input.goal.slice(0, 60)
  const preheader = (parsed.preheader ?? '').toString().slice(0, 200)
  return {
    subject,
    preheader,
    bodyHtml: parsed.bodyHtml,
    bodyText: htmlToText(parsed.bodyHtml),
  }
}

// ---------------------------------------------------------------------------
// Inline reverse-render: turn a list of blocks into a compact HTML body.
// ---------------------------------------------------------------------------

function blocksToHtml(blocks: Block[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'hero': {
        const p = b.props as HeroBlockProps
        parts.push(`<h2>${escapeHtml(p.headline)}</h2>`)
        if (p.subhead) parts.push(`<p>${escapeHtml(p.subhead)}</p>`)
        if (p.ctaText && p.ctaUrl)
          parts.push(`<p><a href="${escapeAttr(p.ctaUrl)}">${escapeHtml(p.ctaText)}</a></p>`)
        break
      }
      case 'heading':
        parts.push(`<h${b.props.level}>${escapeHtml(b.props.text)}</h${b.props.level}>`)
        break
      case 'paragraph':
        parts.push(`<p>${b.props.html}</p>`)
        break
      case 'button':
        parts.push(
          `<p><a href="${escapeAttr(b.props.url)}">${escapeHtml(b.props.text)}</a></p>`,
        )
        break
      case 'image':
        parts.push(
          `<p><img src="${escapeAttr(b.props.src)}" alt="${escapeAttr(b.props.alt)}" /></p>`,
        )
        break
      case 'divider':
        parts.push('<hr />')
        break
      case 'spacer':
        parts.push('<br />')
        break
      case 'columns':
        // Flatten columns: left blocks then right blocks.
        parts.push(blocksToHtml(b.props.columns[0]))
        parts.push(blocksToHtml(b.props.columns[1]))
        break
      case 'footer':
        // Footer is rendered by the email renderer; in the inline body we skip it.
        break
    }
  }
  return parts.join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// generateSubjectLines
// ---------------------------------------------------------------------------

export async function generateSubjectLines(input: {
  topic: string
  voice: BrandVoice
  count?: number
  body?: string
}): Promise<{ subjects: string[]; modelUsed: string }> {
  const count = Math.max(2, Math.min(10, input.count ?? 5))
  const system = [
    'You write email subject lines for a South African client-growth platform.',
    'You output ONLY a JSON array of strings — no explanations, no fences.',
    `Generate exactly ${count} subject lines, each under 60 characters.`,
    'Mix angles: a curiosity gap, a clear benefit, a question, a number/specific, and a low-key direct version.',
    voiceBlock(input.voice),
    'No clickbait. No emoji unless the brand sample lines use emoji.',
  ].join('\n\n')

  const user = [
    `Topic: ${input.topic}`,
    input.body ? `Existing body (write subjects that match this content):\n${input.body.slice(0, 4000)}` : '',
    `Return a JSON array of ${count} strings now.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  let subjects: string[] = []
  try {
    const { text } = await generateText({
      model: BRIEF_MODEL,
      system,
      prompt: user,
      maxOutputTokens: 600,
      temperature: 0.85,
    })
    const parsed = extractJson<unknown>(text)
    if (Array.isArray(parsed)) {
      subjects = parsed
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.length > 80 ? s.slice(0, 77) + '…' : s))
    }
    // Fall through to text parsing if array extraction failed
    if (subjects.length < Math.min(3, count)) {
      subjects = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.\s"]+/, '').replace(/"$/, '').trim())
        .filter((l) => l.length > 0 && l.length < 100)
    }
  } catch {
    subjects = []
  }

  if (subjects.length < 2) {
    subjects = [
      input.topic.slice(0, 60),
      `Re: ${input.topic}`.slice(0, 60),
      `A quick note about ${input.topic}`.slice(0, 60),
    ]
  }

  return { subjects: subjects.slice(0, count), modelUsed: BRIEF_MODEL }
}

// ---------------------------------------------------------------------------
// generateSequence
// ---------------------------------------------------------------------------

function cadenceOffsets(cadence: GenerateSequenceInput['cadence'], steps: number): number[] {
  const offsets: number[] = []
  for (let i = 0; i < steps; i++) {
    if (i === 0) {
      offsets.push(0)
      continue
    }
    if (cadence === 'aggressive') offsets.push(i === 1 ? 1 : 2)
    else if (cadence === 'patient') offsets.push(i === 1 ? 3 : 5)
    else offsets.push(i === 1 ? 2 : 3)
  }
  return offsets
}

export async function generateSequence(
  input: GenerateSequenceInput,
): Promise<{
  name: string
  description: string
  steps: GeneratedSequenceStep[]
  modelUsed: string
}> {
  const steps = Math.max(2, Math.min(10, input.steps))
  const offsets = cadenceOffsets(input.cadence, steps)

  const system = [
    'You design email nurture sequences for a South African client-growth platform.',
    'You output ONLY a JSON object with shape: { description: string, steps: Array<{ subject: string, bodyHtml: string }> }',
    'No code fences, no commentary.',
    'Each step\'s bodyHtml may use ONLY: <h2>, <h3>, <p>, <ul>, <li>, <a>, <b>, <i>, <br>, <hr>. No tables, no inline styles.',
    voiceBlock(input.voice),
    `Build a ${steps}-step sequence. Each subject under 60 chars, each body 80-180 words.`,
    'Each step must build on the previous (do not repeat the same opener). Step 1 sets the hook. Final step is a clear, low-pressure ask.',
    'Vary structure: questions, short stories, single-image-of-words emails, and lists. Avoid every step starting with "Hi {{firstName}}".',
  ].join('\n\n')

  const user = [
    `Sequence goal: ${input.goal}`,
    input.audienceDescription ? `Audience: ${input.audienceDescription}` : '',
    input.context ? `Context:\n${input.context}` : '',
    `Cadence: ${input.cadence}.`,
    `Step delays (days from enrollment) — bake the timing into the copy: ${offsets.map((d, i) => `step ${i + 1} → day ${d}`).join(', ')}.`,
    `Return JSON with ${steps} steps.`,
  ]
    .filter(Boolean)
    .join('\n\n')

  let parsed: { description?: string; steps?: Array<{ subject?: string; bodyHtml?: string }> } | null = null
  try {
    const { text } = await generateText({
      model: DRAFT_MODEL,
      system,
      prompt: user,
      maxOutputTokens: 4000,
      temperature: 0.75,
    })
    parsed = extractJson(text)
  } catch {
    parsed = null
  }

  const description = parsed?.description ?? `${input.name} — ${steps}-step nurture for ${input.audienceDescription ?? 'leads'}.`
  const rawSteps = Array.isArray(parsed?.steps) ? parsed!.steps : []
  const out: GeneratedSequenceStep[] = []
  for (let i = 0; i < steps; i++) {
    const r = rawSteps[i] ?? {}
    const subject = typeof r.subject === 'string' && r.subject.trim()
      ? r.subject.trim().slice(0, 120)
      : `${input.name} — step ${i + 1}`
    const bodyHtml = typeof r.bodyHtml === 'string' && r.bodyHtml.trim()
      ? r.bodyHtml.trim()
      : `<p>Step ${i + 1} of ${steps}. Goal: ${escapeHtml(input.goal)}.</p>`
    out.push({
      stepNumber: i + 1,
      delayDays: offsets[i] ?? 0,
      subject,
      bodyHtml,
      bodyText: htmlToText(bodyHtml),
    })
  }

  return { name: input.name, description, steps: out, modelUsed: DRAFT_MODEL }
}

// ---------------------------------------------------------------------------
// generateNewsletter
// ---------------------------------------------------------------------------

export async function generateNewsletter(input: GenerateNewsletterInput): Promise<{
  document: EmailDocument
  subject: string
  preheader: string
  modelUsed: string
}> {
  const storySchema = input.stories
    .map(
      (s, i) =>
        `Story ${i + 1}: heading="${s.heading}", hint="${s.bodyHint}"${s.ctaText ? `, ctaText="${s.ctaText}", ctaUrl="${s.ctaUrl ?? ''}"` : ''}${s.imageUrl ? `, image="${s.imageUrl}"` : ''}`,
    )
    .join('\n')

  const system = [
    'You write newsletters for a South African client-growth platform.',
    'You output ONLY a single JSON object matching the EmailDocument schema — no fences, no commentary.',
    EMAIL_DOCUMENT_SCHEMA,
    voiceBlock(input.voice),
    'Structure: hero block with the newsletter masthead, then for each story: heading (h2) → paragraph (60-90 words) → optional button (if ctaText supplied) → optional image (if image supplied) → divider. End with a footer block.',
    'Subject under 60 chars. Preheader under 90 chars. Each paragraph in plain prose, no bullet-lists unless natural.',
  ].join('\n\n')

  const user = [
    `Newsletter topic: ${input.topic}`,
    `Organisation: ${input.orgName}`,
    `Stories (write the body copy for each based on the hint):\n${storySchema}`,
    input.unsubscribeUrl
      ? `Footer unsubscribeUrl: ${input.unsubscribeUrl}`
      : 'Footer unsubscribeUrl: {{unsubscribeUrl}}',
    'Return the EmailDocument JSON now.',
  ].join('\n\n')

  let parsed: unknown = null
  try {
    const { text } = await generateText({
      model: DRAFT_MODEL,
      system,
      prompt: user,
      maxOutputTokens: 3000,
      temperature: 0.75,
    })
    parsed = extractJson(text)
  } catch {
    parsed = null
  }

  if (!parsed) {
    // Retry once.
    try {
      const { text } = await generateText({
        model: DRAFT_MODEL,
        system,
        prompt: `${user}\n\nThe previous attempt produced unparseable output. Return ONLY the JSON object.`,
        maxOutputTokens: 3000,
        temperature: 0.4,
      })
      parsed = extractJson(text)
    } catch {
      parsed = null
    }
  }

  const fallbackSubject = `${input.orgName}: ${input.topic}`.slice(0, 60)
  const fallbackPre = input.stories
    .map((s) => s.heading)
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ')
    .slice(0, 90)
  const fallbackBody = input.stories
    .map(
      (s) =>
        `<h2>${escapeHtml(s.heading)}</h2><p>${escapeHtml(s.bodyHint)}</p>${
          s.ctaText && s.ctaUrl
            ? `<p><a href="${escapeAttr(s.ctaUrl)}">${escapeHtml(s.ctaText)}</a></p>`
            : ''
        }`,
    )
    .join('<hr />')

  const doc = coerceDocument(parsed ?? null, {
    subject: fallbackSubject,
    preheader: fallbackPre,
    bodyHtml: fallbackBody,
  })

  // Ensure a footer exists at the end with the right orgName / unsubscribe URL.
  const hasFooter = doc.blocks.some((b) => b.type === 'footer')
  if (!hasFooter) {
    doc.blocks.push({
      id: makeBlockId(),
      type: 'footer',
      props: {
        orgName: input.orgName,
        address: 'Pretoria, Gauteng, South Africa',
        unsubscribeUrl: input.unsubscribeUrl ?? '{{unsubscribeUrl}}',
      },
    })
  }

  return {
    document: doc,
    subject: doc.subject,
    preheader: doc.preheader,
    modelUsed: DRAFT_MODEL,
  }
}

// ---------------------------------------------------------------------------
// generateWinback
// ---------------------------------------------------------------------------

export async function generateWinback(input: GenerateWinbackInput): Promise<GenerateEmailResult> {
  const goalParts = [
    `Win back ${input.contactName}${input.contactCompany ? ` at ${input.contactCompany}` : ''}.`,
    `They haven't engaged in ${input.daysSinceLastInteraction} days.`,
    input.lastTopicOrProduct ? `Last touchpoint was about ${input.lastTopicOrProduct}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const ctxLines: string[] = []
  if (input.offer) {
    ctxLines.push(
      `Offer to mention: ${input.offer.description}. CTA: "${input.offer.ctaText}" → ${input.offer.ctaUrl}.`,
    )
  }
  ctxLines.push(
    'Tone for winbacks: warm, low-pressure, acknowledge the gap honestly without grovelling. Skip "We miss you" — give a real reason to come back.',
  )

  return generateEmail({
    goal: goalParts,
    voice: input.voice,
    audienceDescription: `${input.contactName}${input.contactCompany ? `, ${input.contactCompany}` : ''}`,
    context: ctxLines.join('\n'),
    contentLength: 'short',
    cta: input.offer ? { text: input.offer.ctaText, url: input.offer.ctaUrl } : undefined,
    outputMode: 'document',
  })
}

// ---------------------------------------------------------------------------
// rewriteEmail
// ---------------------------------------------------------------------------

export async function rewriteEmail(
  input: RewriteInput,
): Promise<{ bodyHtml: string; bodyText: string; modelUsed: string }> {
  const instructionMap: Record<NonNullable<RewriteInput['instruction']>, string> = {
    tighten: 'Cut filler. Aim for 30-50% shorter. Keep the meaning. Combine short paragraphs only when it improves flow.',
    expand: 'Add 1-2 concrete details, examples, or supporting points. Do not pad with adjectives.',
    soften: 'Reduce urgency and pressure. Replace command verbs with invitations. Keep the structure.',
    sharpen: 'Make every sentence carry weight. Cut hedge words ("maybe", "perhaps", "I think"). Use stronger verbs.',
    'translate-sa-english':
      'Convert spellings and idioms to South African English. Use "organise", "colour", "centre". Use "boet" or "lekker" only if voice is playful.',
  }
  const instruction = input.instruction
    ? instructionMap[input.instruction]
    : 'Rewrite this email so it sounds like the brand voice below. Keep all key information and structure.'

  const system = [
    'You are a senior email copywriter. You rewrite the user-supplied body and return JSON only.',
    'Output JSON shape: { bodyHtml: string }. bodyHtml may use ONLY <h2>, <h3>, <p>, <ul>, <li>, <a>, <b>, <i>, <br>, <hr>.',
    'No commentary, no explanation of changes — only the rewritten body.',
    voiceBlock(input.voice),
    instruction,
  ].join('\n\n')

  const user = `Original email body:\n\n${input.body.slice(0, 6000)}\n\nReturn the rewritten { bodyHtml } JSON now.`

  let parsed: { bodyHtml?: string } | null = null
  let raw = ''
  try {
    const { text } = await generateText({
      model: DRAFT_MODEL,
      system,
      prompt: user,
      maxOutputTokens: 1500,
      temperature: 0.6,
    })
    raw = text
    parsed = extractJson(text)
  } catch {
    parsed = null
  }

  const bodyHtml =
    parsed && typeof parsed.bodyHtml === 'string' && parsed.bodyHtml.trim().length > 0
      ? parsed.bodyHtml
      : raw.trim().length > 0
        ? `<p>${escapeHtml(htmlToText(raw))}</p>`
        : input.body

  return { bodyHtml, bodyText: htmlToText(bodyHtml), modelUsed: DRAFT_MODEL }
}
