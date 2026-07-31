import type { BatchItemResult, BatchJobResult } from './types'

/**
 * Run a batch of prompts with structured per-item results (PiB product path).
 * Does not export ShareGPT training trajectories (deferred non-goal).
 */
export function runBatchPrompts(input: {
  orgId: string
  agentId: string
  prompts: string[]
  /** Optional per-prompt handler; default echoes a structured stub. */
  runner?: (prompt: string, index: number) => { status: 'ok' | 'error'; output: string }
  id?: string
}): BatchJobResult {
  if (!input.prompts.length) throw new Error('At least one prompt is required')
  const runner =
    input.runner ||
    ((prompt: string, index: number) => ({
      status: 'ok' as const,
      output: `batch_item_${index}: ${prompt.slice(0, 200)}`,
    }))

  const items: BatchItemResult[] = input.prompts.map((prompt, index) => {
    try {
      const result = runner(prompt, index)
      return {
        index,
        prompt,
        status: result.status,
        output: result.output,
      }
    } catch (err) {
      return {
        index,
        prompt,
        status: 'error',
        output: err instanceof Error ? err.message : String(err),
      }
    }
  })

  return {
    id: input.id || `batch_${Date.now()}`,
    orgId: input.orgId,
    agentId: input.agentId,
    createdAt: new Date().toISOString(),
    items,
  }
}
