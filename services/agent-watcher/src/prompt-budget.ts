import { get_encoding, type Tiktoken } from '@dqbd/tiktoken'

export type WatcherPromptBlockPriority = 'critical' | 'high' | 'normal' | 'optional'

export interface WatcherPromptBlock {
  id: string
  content: string
  priority: WatcherPromptBlockPriority
}

export interface WatcherPromptLedger {
  limitTokens: number
  inputTokens: number
  blocks: Array<{ id: string; inputTokens: number; includedTokens: number; included: boolean }>
  omitted: Array<{ id: string; reason: 'empty' | 'duplicate' | 'budget'; inputTokens: number }>
}

let encoder: Tiktoken | null = null

function tokenize(value: string): number {
  if (!value) return 0
  if (!encoder) encoder = get_encoding('o200k_base')
  return encoder.encode(value).length
}

function fit(value: string, limitTokens: number): string {
  if (limitTokens <= 0 || !value) return ''
  if (tokenize(value) <= limitTokens) return value
  const suffix = '\n…[task prompt budget truncated; fetch task-scoped context if needed]'
  if (tokenize(suffix) >= limitTokens) return ''
  let low = 0
  let high = value.length
  let best = ''
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = `${value.slice(0, middle).trimEnd()}${suffix}`
    if (tokenize(candidate) <= limitTokens) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

/** Build a bounded task prompt and durable, inspectable token ledger. */
export function buildWatcherPromptBudget(
  blocks: WatcherPromptBlock[],
  limitTokens = 20_000,
): { content: string; ledger: WatcherPromptLedger } {
  const rank: Record<WatcherPromptBlockPriority, number> = { critical: 0, high: 1, normal: 2, optional: 3 }
  const ordered = [...blocks].sort((a, b) => rank[a.priority] - rank[b.priority])
  const seen = new Set<string>()
  const included: string[] = []
  const ledger: WatcherPromptLedger = { limitTokens, inputTokens: 0, blocks: [], omitted: [] }
  let remaining = limitTokens

  for (const block of ordered) {
    const content = block.content.trim()
    const originalTokens = tokenize(content)
    if (!content) {
      ledger.blocks.push({ id: block.id, inputTokens: 0, includedTokens: 0, included: false })
      ledger.omitted.push({ id: block.id, reason: 'empty', inputTokens: 0 })
      continue
    }
    if (seen.has(content)) {
      ledger.blocks.push({ id: block.id, inputTokens: originalTokens, includedTokens: 0, included: false })
      ledger.omitted.push({ id: block.id, reason: 'duplicate', inputTokens: originalTokens })
      continue
    }
    seen.add(content)
    const separatorTokens = included.length > 0 ? tokenize('\n\n') : 0
    const selected = fit(content, Math.max(0, remaining - separatorTokens))
    const includedTokens = tokenize(selected)
    ledger.blocks.push({ id: block.id, inputTokens: originalTokens, includedTokens, included: Boolean(selected) })
    if (!selected) {
      ledger.omitted.push({ id: block.id, reason: 'budget', inputTokens: originalTokens })
      continue
    }
    included.push(selected)
    remaining -= separatorTokens + includedTokens
    if (includedTokens < originalTokens) {
      ledger.omitted.push({ id: block.id, reason: 'budget', inputTokens: originalTokens - includedTokens })
    }
  }

  const content = included.join('\n\n')
  ledger.inputTokens = tokenize(content)
  return { content, ledger }
}
