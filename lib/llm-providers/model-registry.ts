/**
 * Canonical model registry — single source of truth for model ids across the
 * product (Messages chat picker, Kanban agent-task routing, workflow-graph
 * per-node routing, task API validation).
 *
 * Do NOT maintain a second copied model-name allowlist anywhere else. The chat
 * picker's per-provider curated fallback lists (lib/llm-providers/providers.ts)
 * and the agent-task allowlist/options (lib/agents/runRouting.ts) are both
 * derived from this registry, so a model selectable in Messages (e.g.
 * gpt-5.6-terra) is automatically accepted for agent-task routing when it is
 * runtime-compatible and policy-permitted; otherwise the resolver returns a
 * precise eligibility error.
 *
 * Provider/user availability is NOT stored here — it is passed through the
 * caller context (resolveAgentTaskModelEligibility). The agent-watcher daemon
 * is a separate CommonJS service that cannot import this module; the boundary
 * and dependency contract are documented in
 * services/agent-watcher/src/watcher.ts (see "model stamp" pairing rule).
 */
import type { LlmProviderKey } from './providers'

/** Why a catalogue model is not permitted for agent-task dispatch. */
export type AgentTaskRestrictionCode = 'policy-restricted' | 'chat-only'

export interface CanonicalModelEntry {
  id: string
  /** Human label used in agent model pickers (Kanban, workflow graph). */
  label: string
  /** Hermes provider family the model belongs to (matches hermesProvider). */
  provider: string
  /** App provider keys whose chat curated catalogue includes this model. */
  providerKeys: LlmProviderKey[]
  /**
   * True when the Hermes agent runtime run allowlist supports this model id.
   * When false the model can still appear in the chat picker but can never be
   * dispatched as an agent-task model (fail-closed 'runtime-unsupported').
   */
  runtimeCompatible: boolean
  /**
   * When present the model is catalogued for chat but NOT permitted for
   * agent-task dispatch; the reason is returned verbatim by the resolver.
   * Absent => agent-task dispatch allowed.
   */
  agentTaskRestriction?: {
    code: AgentTaskRestrictionCode
    reason: string
  }
}

export type AgentModelEligibilityResult =
  | { ok: true; model: CanonicalModelEntry }
  | {
      ok: false
      status: number
      code:
        | 'unknown-model'
        | 'runtime-unsupported'
        | 'policy-restricted'
        | 'chat-only'
        | 'provider-unavailable'
      reason: string
    }

/**
 * The one maintained model catalogue. Grouped by provider family in the same
 * order as the historical chat curated lists so derived lists stay stable.
 *
 * Agent-task eligible (no agentTaskRestriction):
 *   grok-4.5, claude-sonnet-4-6, gpt-5.5, gpt-5.4, gpt-5.4-mini,
 *   gpt-5.3-codex-spark, gpt-5.6-terra
 */
export const MODEL_REGISTRY: CanonicalModelEntry[] = [
  // xAI Grok (SuperGrok OAuth + API key share one catalogue)
  { id: 'grok-build-0.1', label: 'Grok Build 0.1', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Grok Build 0.1 is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'grok-4.5', label: 'Grok 4.5 (SuperGrok)', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true },
  { id: 'grok-4.3', label: 'Grok 4.3', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Grok 4.3 is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'grok-composer-2.5-fast', label: 'Grok Composer 2.5 Fast', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Grok Composer 2.5 Fast is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'grok-4.20-0309-reasoning', label: 'Grok 4.20 Reasoning', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Grok 4.20 Reasoning is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'grok-4.20-0309-non-reasoning', label: 'Grok 4.20', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Grok 4.20 is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'grok-4.20-multi-agent-0309', label: 'Grok 4.20 Multi-Agent', provider: 'xai-oauth', providerKeys: ['xai-oauth', 'xai'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Grok 4.20 Multi-Agent is available for chat selection but is not offered for agent-task dispatch.' } },

  // Anthropic Claude (kept before OpenAI so the agent picker keeps the
  // historical Grok → Claude → GPT ordering).
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', providerKeys: ['anthropic'], runtimeCompatible: true },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', providerKeys: ['anthropic'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Claude Opus 4.6 is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', providerKeys: ['anthropic'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Claude Haiku 4.5 is available for chat selection but is not offered for agent-task dispatch.' } },

  // OpenAI Codex / ChatGPT
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true, agentTaskRestriction: { code: 'policy-restricted', reason: 'GPT-5.6 Luna is not permitted for agent-task dispatch by platform model policy (chat selection only).' } },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true, agentTaskRestriction: { code: 'policy-restricted', reason: 'GPT-5.6 Sol is not permitted for agent-task dispatch by platform model policy (chat selection only).' } },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai-codex', providerKeys: ['openai-codex', 'openai-api', 'copilot'], runtimeCompatible: true },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai-codex', providerKeys: ['openai-codex', 'openai-api', 'copilot'], runtimeCompatible: true },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'GPT-5.3 Codex is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Spark', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', provider: 'openai-codex', providerKeys: ['openai-codex'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'GPT-5.2 Codex is available for chat selection but is not offered for agent-task dispatch.' } },

  // OpenAI API (pay-per-token; chat-only — not in the Hermes agent-task run allowlist)
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai-api', providerKeys: ['openai-api'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'GPT-4.1 is not supported by Hermes agent runtimes.' } },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai-api', providerKeys: ['openai-api'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'GPT-4o is not supported by Hermes agent runtimes.' } },

  // Google Gemini
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', providerKeys: ['gemini'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Gemini 2.5 Pro is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', providerKeys: ['gemini'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Gemini 2.5 Flash is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', provider: 'gemini', providerKeys: ['gemini'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'Gemini 3 Flash Preview is available for chat selection but is not offered for agent-task dispatch.' } },

  // DeepSeek (API key)
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', providerKeys: ['deepseek'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'DeepSeek V4 Flash is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', providerKeys: ['deepseek'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'DeepSeek V4 Pro is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', providerKeys: ['deepseek'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'DeepSeek Chat is available for chat selection but is not offered for agent-task dispatch.' } },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', providerKeys: ['deepseek'], runtimeCompatible: true, agentTaskRestriction: { code: 'chat-only', reason: 'DeepSeek Reasoner is available for chat selection but is not offered for agent-task dispatch.' } },

  // OpenRouter (aggregator; prefixed ids are not Hermes agent-task run models)
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (OpenRouter)', provider: 'openrouter', providerKeys: ['openrouter'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'OpenRouter-prefixed models are not supported by Hermes agent runtimes.' } },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (OpenRouter)', provider: 'openrouter', providerKeys: ['openrouter'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'OpenRouter-prefixed models are not supported by Hermes agent runtimes.' } },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5 (OpenRouter / Nous Portal)', provider: 'openrouter', providerKeys: ['openrouter', 'nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Provider-qualified aggregator models are not supported by Hermes agent runtimes.' } },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4 (OpenRouter)', provider: 'openrouter', providerKeys: ['openrouter'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'OpenRouter-prefixed models are not supported by Hermes agent runtimes.' } },

  // GitHub Copilot (chat-only; claude-sonnet-4 is not in the Hermes agent-task run allowlist)
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4 (Copilot)', provider: 'copilot', providerKeys: ['copilot'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Claude Sonnet 4 is not supported by Hermes agent runtimes.' } },

  // Nous Portal (aggregator; prefixed ids are not platform agent-task dispatch models)
  { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'anthropic/claude-opus-4.8', label: 'Claude Opus 4.8 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash 0731 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: true },
  { id: 'qwen/qwen3.8-max', label: 'Qwen 3.8 Max (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'z-ai/glm-5.1', label: 'GLM 5.1 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'xiaomi/mimo-v2.5-pro', label: 'MiMo V2.5 Pro (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'tencent/hy3', label: 'Tencent Hunyuan 3 (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'stepfun/step-3.7-flash', label: 'Step 3.7 Flash (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
  { id: 'sakana/fugu-ultra', label: 'Fugu Ultra (Nous Portal)', provider: 'nous', providerKeys: ['nous'], runtimeCompatible: false, agentTaskRestriction: { code: 'chat-only', reason: 'Nous Portal models are available for chat selection but are not offered for agent-task dispatch.' } },
]

const BY_ID = new Map(MODEL_REGISTRY.map((entry) => [entry.id, entry]))

export function getCanonicalModel(id: string): CanonicalModelEntry | null {
  return BY_ID.get(id) ?? null
}

/** Chat curated fallback list for an app provider key (order-preserving). */
export function curatedModelsForProvider(key: LlmProviderKey): string[] {
  return MODEL_REGISTRY
    .filter((entry) => entry.providerKeys.includes(key))
    .map((entry) => entry.id)
}

/** Agent-task eligible model ids (the maintained allowlist, derived). */
export function agentTaskModelIds(): readonly string[] {
  return MODEL_REGISTRY
    .filter((entry) => !entry.agentTaskRestriction && entry.runtimeCompatible)
    .map((entry) => entry.id)
}

/** Agent-task picker options (Kanban / workflow graph), derived from the registry. */
export function agentTaskModelOptions(): Array<{ value: string; label: string }> {
  return MODEL_REGISTRY
    .filter((entry) => !entry.agentTaskRestriction && entry.runtimeCompatible)
    .map((entry) => ({ value: entry.id, label: entry.label }))
}

/** True when the id is in the agent-task eligible set. */
export function isAgentTaskModel(id: string): boolean {
  const entry = BY_ID.get(id)
  return Boolean(entry && !entry.agentTaskRestriction && entry.runtimeCompatible)
}

/** Trim + membership check; returns the clean id or null (backward compatible with cleanAgentModel). */
export function cleanAgentTaskModel(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return isAgentTaskModel(cleaned) ? cleaned : null
}

/**
 * Precise, fail-closed eligibility for agent-task routing.
 *
 * Caller context:
 * - providerAvailable — true when the acting user/provider has a live-verified
 *   credential for the model's provider family. Defaults to true so callers
 *   without credential context (task API validation) preserve the existing
 *   safe default: the watcher defers/retries provider readiness at dispatch.
 *
 * Failure order: unknown model -> runtime unsupported -> policy/chat restriction
 * -> provider unavailable.
 */
export function resolveAgentTaskModelEligibility(input: {
  model: unknown
  providerAvailable?: boolean
}): AgentModelEligibilityResult {
  if (input.model === undefined || input.model === null || input.model === '') {
    return { ok: false, status: 400, code: 'unknown-model', reason: 'Invalid agentModel; a model id is required.' }
  }
  if (typeof input.model !== 'string') {
    return { ok: false, status: 400, code: 'unknown-model', reason: 'Invalid agentModel; expected a string model id.' }
  }
  const id = input.model.trim()
  const entry = BY_ID.get(id)
  if (!entry) {
    return {
      ok: false,
      status: 400,
      code: 'unknown-model',
      reason: `Invalid agentModel '${id}'; it is not in the platform model catalogue.`,
    }
  }
  if (!entry.runtimeCompatible) {
    return {
      ok: false,
      status: 400,
      code: 'runtime-unsupported',
      reason: `Model '${id}' is not supported by Hermes agent runtimes.`,
    }
  }
  if (entry.agentTaskRestriction) {
    return {
      ok: false,
      status: entry.agentTaskRestriction.code === 'policy-restricted' ? 403 : 400,
      code: entry.agentTaskRestriction.code,
      reason: entry.agentTaskRestriction.reason,
    }
  }
  if (input.providerAvailable === false) {
    return {
      ok: false,
      status: 400,
      code: 'provider-unavailable',
      reason: `No live-verified ${entry.provider} credentials for this user; connect the provider in Settings and retry.`,
    }
  }
  return { ok: true, model: entry }
}
