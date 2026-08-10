import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'

export type PromptProfile = 'read_only' | 'draft' | 'execution'

export type PromptBlockPriority = 'critical' | 'high' | 'normal' | 'optional'

export interface PromptBudgetBlock {
  id: string
  content: string
  priority?: PromptBlockPriority
  required?: boolean
  /** Hard per-block cap in tokens; the block is truncated to this even when the profile limit has headroom. */
  maxTokens?: number
}

export interface PromptBudgetOmission {
  id: string
  reason: 'empty' | 'duplicate' | 'budget'
  inputTokens: number
}

export interface PromptBudgetLedger {
  profile: PromptProfile
  limitTokens: number
  inputTokens: number
  blocks: Array<{ id: string; inputTokens: number; includedTokens: number; included: boolean; capTokens?: number }>
  omitted: PromptBudgetOmission[]
}

export interface PromptBudgetResult {
  content: string
  ledger: PromptBudgetLedger
}

const PROFILE_LIMITS: Record<PromptProfile, number> = {
  read_only: 12_000,
  draft: 20_000,
  execution: 32_000,
}

let encoder: Tiktoken | null = null

function tokenizer(): Tiktoken {
  if (!encoder) encoder = get_encoding('o200k_base')
  return encoder
}

/** Uses the o200k_base tokenizer, the closest stable public tokenizer for the PiB default OpenAI models. */
export function countPromptTokens(value: string): number {
  if (!value) return 0
  return tokenizer().encode(value).length
}

function fitToTokenLimit(value: string, tokens: number): string {
  if (tokens <= 0 || !value) return ''
  if (countPromptTokens(value) <= tokens) return value
  const suffix = '\n…[prompt budget truncated]'
  const suffixTokens = countPromptTokens(suffix)
  if (suffixTokens >= tokens) return ''
  let low = 0
  let high = value.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${value.slice(0, middle).trimEnd()}${suffix}`
    if (countPromptTokens(candidate) <= tokens) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

/**
 * Allocates an absolute prompt budget in caller-supplied priority order.
 * Exact duplicate blocks are skipped, and the ledger records every omission so
 * /context and run evidence can explain the final prompt.
 */
export function buildPromptBudget(input: {
  profile: PromptProfile
  blocks: PromptBudgetBlock[]
  limitTokens?: number
}): PromptBudgetResult {
  const limitTokens = input.limitTokens ?? PROFILE_LIMITS[input.profile]
  let remaining = limitTokens
  const seen = new Set<string>()
  const included: string[] = []
  const omitted: PromptBudgetOmission[] = []
  const blockLedger: PromptBudgetLedger['blocks'] = []

  const rank: Record<PromptBlockPriority, number> = { critical: 0, high: 1, normal: 2, optional: 3 }
  const orderedBlocks = [...input.blocks].sort((left, right) => rank[left.priority ?? 'normal'] - rank[right.priority ?? 'normal'])
  for (const block of orderedBlocks) {
    const content = block.content.trim()
    const inputTokens = countPromptTokens(content)
    if (!content) {
      omitted.push({ id: block.id, reason: 'empty', inputTokens: 0 })
      blockLedger.push({ id: block.id, inputTokens: 0, includedTokens: 0, included: false })
      continue
    }
    if (seen.has(content)) {
      omitted.push({ id: block.id, reason: 'duplicate', inputTokens })
      blockLedger.push({ id: block.id, inputTokens, includedTokens: 0, included: false })
      continue
    }
    seen.add(content)

    const separatorTokens = included.length > 0 ? countPromptTokens('\n\n') : 0
    const allowed = Math.max(0, remaining - separatorTokens)
    const capTokens = block.maxTokens && block.maxTokens > 0 ? Math.min(inputTokens, block.maxTokens) : inputTokens
    const chosen = inputTokens <= allowed && capTokens === inputTokens
      ? content
      : fitToTokenLimit(content, Math.min(allowed, capTokens))
    const includedTokens = countPromptTokens(chosen)
    if (!chosen) {
      omitted.push({ id: block.id, reason: 'budget', inputTokens })
      blockLedger.push({ id: block.id, inputTokens, includedTokens: 0, included: false })
      continue
    }
    included.push(chosen)
    remaining -= separatorTokens + includedTokens
    blockLedger.push({
      id: block.id,
      inputTokens,
      includedTokens,
      included: true,
      ...(block.maxTokens && block.maxTokens > 0 ? { capTokens } : {}),
    })
    if (includedTokens < inputTokens) omitted.push({ id: block.id, reason: 'budget', inputTokens: inputTokens - includedTokens })
  }

  const content = included.join('\n\n')
  return {
    content,
    ledger: {
      profile: input.profile,
      limitTokens,
      inputTokens: countPromptTokens(content),
      blocks: blockLedger,
      omitted,
    },
  }
}
