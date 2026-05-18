/**
 * AI Lead Scoring via Vercel AI Gateway
 *
 * Uses the same `generateText` pattern as lib/ai/email-generators.ts and
 * lib/seo/tools/ai-generators.ts — model strings are "provider/model" and
 * route automatically through the gateway via the `ai` SDK (v6).
 *
 * Results are cached in `scoringCache/{orgId}_{contactId}` for
 * `config.aiCacheHours` (default 24) hours. Returns null on any failure
 * so score writes are never blocked by AI errors.
 */

import { generateText } from 'ai'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { Contact } from '@/lib/crm/types'
import type { Company } from '@/lib/companies/types'
import type { ScoringConfig } from './types'

const CACHE_COLL = 'scoringCache'

/** Default AI model — cheap + fast, good for classification tasks */
const DEFAULT_AI_MODEL = 'anthropic/claude-haiku-4.5'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AiScoreResult {
  score: number
  rationale: string
}

export interface AiScoreContext {
  contact: Contact
  company?: Company | null
  config: ScoringConfig
  formulaLeadScore?: number
  formulaIcpScore?: number
  /** Optional pre-aggregated recent-activity summary string */
  recentActivitySummary?: string
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Returns a cached AI score if fresh, else fetches a new one from the gateway.
 * Returns null if aiEnabled is false, or on any AI / network failure.
 */
export async function computeAiLeadScore(ctx: AiScoreContext): Promise<AiScoreResult | null> {
  if (!ctx.config.aiEnabled) return null

  const cacheKey = `${ctx.config.orgId}_${ctx.contact.id}`
  const cacheHours = ctx.config.aiCacheHours ?? 24

  // Cache check — best-effort
  try {
    const cached = await adminDb.collection(CACHE_COLL).doc(cacheKey).get()
    if (cached.exists) {
      const data = cached.data() as {
        score: number
        rationale: string
        computedAt: Timestamp
      }
      const ageMs = Date.now() - data.computedAt.toMillis()
      if (ageMs < cacheHours * 3_600_000) {
        return { score: data.score, rationale: data.rationale }
      }
    }
  } catch (e) {
    console.warn('[aiLeadScore] cache read failed', e)
  }

  // Fetch from AI Gateway
  const prompt = buildPrompt(ctx)
  let result: AiScoreResult | null = null

  try {
    result = await callAiGateway(prompt, ctx.config.aiModel ?? DEFAULT_AI_MODEL)
  } catch (e) {
    console.error('[aiLeadScore] AI Gateway call failed', e)
    return null
  }

  if (!result) return null

  // Write cache — best-effort
  try {
    await adminDb.collection(CACHE_COLL).doc(cacheKey).set({
      orgId: ctx.config.orgId,
      contactId: ctx.contact.id,
      score: result.score,
      rationale: result.rationale,
      computedAt: Timestamp.now(),
    })
  } catch (e) {
    console.warn('[aiLeadScore] cache write failed', e)
  }

  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPrompt(ctx: AiScoreContext): string {
  const c = ctx.contact
  const co = ctx.company
  const icp = ctx.config.icp

  const lines: string[] = [
    'You are a B2B sales lead scoring assistant. Rate this lead 0-100 based on likelihood to become a customer.',
    `Contact: ${c.name || '(no name)'} <${c.email || '(no email)'}> at ${co?.name ?? c.company ?? '(no company)'}`,
  ]

  if (c.notes) lines.push(`Notes: ${c.notes.slice(0, 500)}`)

  if (co) {
    lines.push(
      `Company: industry=${co.industry ?? '?'}, size=${co.size ?? '?'}, tier=${co.tier ?? '?'}, employees=${co.employeeCount ?? '?'}`,
    )
  }

  lines.push(
    `ICP target: industries=${icp.industries?.join(',') ?? 'any'}, sizes=${icp.sizes?.join(',') ?? 'any'}, tiers=${icp.tiers?.join(',') ?? 'any'}`,
  )

  if (ctx.formulaLeadScore !== undefined)
    lines.push(`Engagement score (formula): ${ctx.formulaLeadScore}/100`)
  if (ctx.formulaIcpScore !== undefined)
    lines.push(`ICP match score (formula): ${ctx.formulaIcpScore}/100`)
  if (ctx.recentActivitySummary) lines.push(`Recent activity: ${ctx.recentActivitySummary}`)

  lines.push('')
  lines.push('Respond with JSON only: { "score": <0-100 integer>, "rationale": "<1-3 sentences>" }')

  return lines.join('\n')
}

/**
 * Calls the Vercel AI Gateway via the `ai` SDK's generateText, which routes
 * the "provider/model" string automatically through the gateway.
 * Returns null on any parse / network failure.
 */
async function callAiGateway(prompt: string, model: string): Promise<AiScoreResult | null> {
  const { text } = await generateText({
    // The ai SDK resolves gateway routing via env — same approach as email/seo generators
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: model as any,
    prompt,
    temperature: 0.2,
    maxOutputTokens: 200,
  })

  if (!text) return null

  try {
    // Extract JSON from the model response (may include surrounding text on some models)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as { score?: unknown; rationale?: unknown }
    if (typeof parsed.score !== 'number') return null
    return {
      score: Math.round(Math.max(0, Math.min(100, parsed.score))),
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    }
  } catch {
    return null
  }
}
