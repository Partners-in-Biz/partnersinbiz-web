/**
 * AI content-brief generator (US-121).
 *
 * Takes a target keyword (+ optional URL and competitor) and produces a
 * structured SEO content brief: title, meta description, H2 outline, semantic
 * keywords, recommended word count, and FAQ questions.
 *
 * Uses the Vercel AI Gateway (Claude Haiku). Falls back to a deterministic
 * brief if the AI call fails or returns unparseable JSON, so the endpoint never
 * hard-fails. Server-safe (no Firebase, no Node-only imports) — edge compatible.
 */
import { generateText } from 'ai'
import { BRIEF_MODEL } from '@/lib/ai/client'

export interface ContentBrief {
  keyword: string
  targetUrl?: string
  competitor?: string
  title: string
  metaDescription: string
  searchIntent: string
  recommendedWordCount: number
  h2Outline: { heading: string; talkingPoints: string[] }[]
  semanticKeywords: string[]
  faqs: { question: string; answerHint: string }[]
  internalLinkIdeas: string[]
  generatedBy: 'ai' | 'template'
  generatedAt: string
}

function extractJson(raw: string): unknown | null {
  // Strip code fences and grab the first {...} block
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function templateBrief(keyword: string, targetUrl?: string, competitor?: string): ContentBrief {
  const titleCaseKw = keyword.replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    keyword,
    targetUrl,
    competitor,
    title: `${titleCaseKw}: The Complete Guide (2026)`.slice(0, 60),
    metaDescription: `Everything you need to know about ${keyword}. Practical, no-fluff guidance with examples and a clear next step.`.slice(0, 160),
    searchIntent: 'Informational with commercial follow-through — readers want to understand the topic and then act.',
    recommendedWordCount: 1500,
    h2Outline: [
      { heading: `What is ${keyword}?`, talkingPoints: ['Plain-language definition', 'Why it matters now', 'Common misconceptions'] },
      { heading: `How ${keyword} works`, talkingPoints: ['Step-by-step breakdown', 'A concrete example', 'Tools or methods involved'] },
      { heading: `Common mistakes with ${keyword}`, talkingPoints: ['Top 3 pitfalls', 'How to avoid each', 'Real-world consequences'] },
      { heading: `Best practices for ${keyword}`, talkingPoints: ['Actionable checklist', 'What "good" looks like', 'Quick wins'] },
      { heading: 'Next steps', talkingPoints: ['Summary recap', 'Clear call to action', targetUrl ? `Link to ${targetUrl}` : 'Internal resource link'] },
    ],
    semanticKeywords: [
      `${keyword} guide`, `${keyword} examples`, `${keyword} best practices`, `how to ${keyword}`, `${keyword} tips`, `${keyword} checklist`,
    ],
    faqs: [
      { question: `What is ${keyword}?`, answerHint: 'One-sentence definition then expand.' },
      { question: `How do I get started with ${keyword}?`, answerHint: 'First three actionable steps.' },
      { question: `How much does ${keyword} cost?`, answerHint: 'Ranges + what drives the price.' },
    ],
    internalLinkIdeas: targetUrl ? [targetUrl] : [`Related pillar page on ${keyword}`],
    generatedBy: 'template',
    generatedAt: new Date().toISOString(),
  }
}

export async function generateContentBrief(opts: {
  keyword: string
  targetUrl?: string
  competitor?: string
}): Promise<ContentBrief> {
  const { keyword, targetUrl, competitor } = opts

  try {
    const { text } = await generateText({
      model: BRIEF_MODEL,
      system:
        'You are a senior SEO content strategist. Produce a structured content brief as STRICT JSON only — no prose, no code fences. ' +
        'The JSON must match exactly this shape: {' +
        '"title": string (<=60 chars, includes the keyword), ' +
        '"metaDescription": string (<=160 chars, includes the keyword), ' +
        '"searchIntent": string (1-2 sentences), ' +
        '"recommendedWordCount": number (800-2500), ' +
        '"h2Outline": [{"heading": string, "talkingPoints": string[3-4]}] (5-7 sections), ' +
        '"semanticKeywords": string[8-12] (LSI / related terms), ' +
        '"faqs": [{"question": string, "answerHint": string}] (4-6), ' +
        '"internalLinkIdeas": string[3-5]}. ' +
        'Write in British/SA English. Be specific, avoid buzzwords.',
      prompt:
        `Target keyword: ${keyword}\n` +
        (targetUrl ? `Target URL: ${targetUrl}\n` : '') +
        (competitor ? `Top competitor: ${competitor}\n` : '') +
        `\nProduce the content brief JSON now.`,
      maxOutputTokens: 1600,
    })

    const parsed = extractJson(text) as Record<string, unknown> | null
    if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.h2Outline)) {
      const h2Outline = (parsed.h2Outline as unknown[])
        .map((s) => {
          const sec = s as Record<string, unknown>
          return {
            heading: typeof sec.heading === 'string' ? sec.heading : '',
            talkingPoints: asStringArray(sec.talkingPoints),
          }
        })
        .filter((s) => s.heading)

      const faqs = (Array.isArray(parsed.faqs) ? parsed.faqs : [])
        .map((f) => {
          const faq = f as Record<string, unknown>
          return {
            question: typeof faq.question === 'string' ? faq.question : '',
            answerHint: typeof faq.answerHint === 'string' ? faq.answerHint : '',
          }
        })
        .filter((f) => f.question)

      if (h2Outline.length >= 3) {
        return {
          keyword,
          targetUrl,
          competitor,
          title: String(parsed.title).slice(0, 60),
          metaDescription: typeof parsed.metaDescription === 'string' ? parsed.metaDescription.slice(0, 160) : '',
          searchIntent: typeof parsed.searchIntent === 'string' ? parsed.searchIntent : '',
          recommendedWordCount: typeof parsed.recommendedWordCount === 'number' ? Math.round(parsed.recommendedWordCount) : 1500,
          h2Outline,
          semanticKeywords: asStringArray(parsed.semanticKeywords),
          faqs,
          internalLinkIdeas: asStringArray(parsed.internalLinkIdeas),
          generatedBy: 'ai',
          generatedAt: new Date().toISOString(),
        }
      }
    }
  } catch {
    // fall through to template
  }

  return templateBrief(keyword, targetUrl, competitor)
}

/** Render a brief as plain text / Markdown for clipboard copy. */
export function briefToMarkdown(brief: ContentBrief): string {
  const lines: string[] = []
  lines.push(`# Content Brief: ${brief.keyword}`, '')
  lines.push(`**Title tag:** ${brief.title}`)
  lines.push(`**Meta description:** ${brief.metaDescription}`)
  lines.push(`**Search intent:** ${brief.searchIntent}`)
  lines.push(`**Recommended word count:** ${brief.recommendedWordCount}`)
  if (brief.targetUrl) lines.push(`**Target URL:** ${brief.targetUrl}`)
  if (brief.competitor) lines.push(`**Competitor:** ${brief.competitor}`)
  lines.push('', '## H2 Outline', '')
  for (const sec of brief.h2Outline) {
    lines.push(`### ${sec.heading}`)
    for (const p of sec.talkingPoints) lines.push(`- ${p}`)
    lines.push('')
  }
  lines.push('## Semantic keywords', '', brief.semanticKeywords.map((k) => `- ${k}`).join('\n'), '')
  lines.push('## FAQs', '')
  for (const f of brief.faqs) lines.push(`**${f.question}**`, `> ${f.answerHint}`, '')
  if (brief.internalLinkIdeas.length) {
    lines.push('## Internal link ideas', '', brief.internalLinkIdeas.map((l) => `- ${l}`).join('\n'), '')
  }
  return lines.join('\n')
}
