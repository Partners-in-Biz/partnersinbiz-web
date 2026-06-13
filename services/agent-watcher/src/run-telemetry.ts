export type AgentRunTelemetrySource = 'upstream' | 'unavailable'

export interface AgentRunTelemetry {
  model: string | null
  reasoningEffort: string | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  costUsd: number | null
  durationMs: number | null
  retryCount: number
  toolCallCount: number | null
  tokenSource: AgentRunTelemetrySource
  costSource: AgentRunTelemetrySource
  exactTokenUsageAvailable: boolean
  exactCostAvailable: boolean
  exactUsageAvailable: boolean
  missing: string[]
}

type BuildAgentRunTelemetryInput = {
  requestedModel?: string | null
  requestedReasoningEffort?: string | null
  startedAtMs: number
  completedAtMs: number
  payloads: Array<Record<string, unknown> | null | undefined>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function recordAt(source: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!source) return null
  const value = source[key]
  return isRecord(value) ? value : null
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function telemetrySources(payloads: Array<Record<string, unknown> | null | undefined>): Array<Record<string, unknown> | null> {
  const out: Array<Record<string, unknown> | null> = []
  for (const payload of payloads) {
    if (!payload) continue
    const result = recordAt(payload, 'result')
    const response = recordAt(payload, 'response')
    const data = recordAt(payload, 'data')
    const billing = recordAt(payload, 'billing')
    out.push(
      recordAt(payload, 'usage'),
      recordAt(payload, 'telemetry'),
      recordAt(payload, 'metrics'),
      billing,
      result ? recordAt(result, 'usage') : null,
      result ? recordAt(result, 'telemetry') : null,
      result ? recordAt(result, 'metrics') : null,
      response ? recordAt(response, 'usage') : null,
      response ? recordAt(response, 'telemetry') : null,
      response ? recordAt(response, 'metrics') : null,
      data ? recordAt(data, 'usage') : null,
      data ? recordAt(data, 'telemetry') : null,
      data ? recordAt(data, 'metrics') : null,
      payload,
    )
  }
  return out
}

function firstString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = cleanString(source[key])
      if (value) return value
    }
  }
  return null
}

function firstNumber(sources: Array<Record<string, unknown> | null>, keys: string[]): number | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = cleanNumber(source[key])
      if (value !== null) return value
    }
  }
  return null
}

function nestedNumber(sources: Array<Record<string, unknown> | null>, recordKeys: string[], numberKeys: string[]): number | null {
  for (const source of sources) {
    if (!source) continue
    for (const recordKey of recordKeys) {
      const record = recordAt(source, recordKey)
      if (!record) continue
      for (const numberKey of numberKeys) {
        const value = cleanNumber(record[numberKey])
        if (value !== null) return value
      }
    }
  }
  return null
}

function costUsdFromSources(sources: Array<Record<string, unknown> | null>): number | null {
  const direct = firstNumber(sources, ['costUsd', 'cost_usd', 'totalCostUsd', 'total_cost_usd', 'estimatedCostUsd', 'usdCost'])
  if (direct !== null) return direct
  const nested = nestedNumber(sources, ['cost', 'billing', 'charges'], ['usd', 'costUsd', 'cost_usd', 'totalUsd'])
  if (nested !== null) return nested
  const cents = firstNumber(sources, ['costCents', 'cost_cents', 'totalCostCents', 'total_cost_cents'])
  return cents !== null ? cents / 100 : null
}

export function buildAgentRunTelemetry(input: BuildAgentRunTelemetryInput): AgentRunTelemetry {
  const sources = telemetrySources(input.payloads)
  const model = firstString(sources, ['model', 'agentModel', 'modelId', 'model_id']) ?? input.requestedModel ?? null
  const reasoningEffort = firstString(sources, ['reasoningEffort', 'reasoning_effort', 'agentEffort']) ?? input.requestedReasoningEffort ?? null
  const inputTokens = firstNumber(sources, ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'])
  const outputTokens = firstNumber(sources, ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens'])
  const reasoningTokens = firstNumber(sources, ['reasoningTokens', 'reasoning_tokens'])
    ?? nestedNumber(sources, ['outputTokensDetails', 'output_tokens_details', 'completionTokensDetails', 'completion_tokens_details'], ['reasoningTokens', 'reasoning_tokens'])
  const directTotal = firstNumber(sources, ['totalTokens', 'total_tokens', 'tokensTotal', 'tokenCount', 'tokens'])
  const summedTotal = [inputTokens, outputTokens, reasoningTokens]
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0)
  const totalTokens = directTotal ?? (summedTotal > 0 ? summedTotal : null)
  const costUsd = costUsdFromSources(sources)
  const toolCallCount = firstNumber(sources, ['toolCallCount', 'toolCalls', 'tool_call_count'])
  const retryCount = firstNumber(sources, ['retryCount', 'retries', 'attempts'])
  const exactTokenUsageAvailable = totalTokens !== null || inputTokens !== null || outputTokens !== null || reasoningTokens !== null
  const exactCostAvailable = costUsd !== null
  const missing = [
    exactTokenUsageAvailable ? null : 'token_usage',
    exactCostAvailable ? null : 'cost_usd',
  ].filter((value): value is string => Boolean(value))

  return {
    model,
    reasoningEffort,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
    durationMs: Math.max(0, input.completedAtMs - input.startedAtMs),
    retryCount: retryCount ?? 0,
    toolCallCount,
    tokenSource: exactTokenUsageAvailable ? 'upstream' : 'unavailable',
    costSource: exactCostAvailable ? 'upstream' : 'unavailable',
    exactTokenUsageAvailable,
    exactCostAvailable,
    exactUsageAvailable: exactTokenUsageAvailable && exactCostAvailable,
    missing,
  }
}
