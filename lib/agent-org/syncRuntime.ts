/**
 * Bridge between org-chart task defaults (Firestore agent_org_nodes) and
 * live Hermes runtime model settings (profile config.yaml via admin sidecar).
 *
 * Org defaults are task-routing hints (Kanban agentModel / agentEffort).
 * Live runtime is what Messages Auto and Hermes actually run.
 * These helpers keep the two aligned when an admin opts into sync.
 */
import {
  cleanAgentEffort,
  cleanAgentModel,
  type AgentEffort,
  type AgentModel,
} from '@/lib/agents/runRouting'
import type { AgentRuntimeModelSettings } from '@/lib/agents/runtime-config'

export function buildRuntimePatchFromOrgDefaults(
  current: AgentRuntimeModelSettings,
  org: { defaultModel?: string | null; defaultEffort?: string | null },
): AgentRuntimeModelSettings {
  const nextModel = typeof org.defaultModel === 'string' ? org.defaultModel.trim() : ''
  const nextEffort = typeof org.defaultEffort === 'string' ? org.defaultEffort.trim() : ''
  return {
    ...current,
    primaryModel: nextModel || current.primaryModel,
    // Empty string is a valid "unset" effort on the runtime form.
    reasoningEffort: nextEffort || current.reasoningEffort,
  }
}

export function buildOrgDefaultsFromRuntime(settings: AgentRuntimeModelSettings): {
  defaultModel: AgentModel | null
  defaultEffort: AgentEffort | null
} {
  return {
    defaultModel: cleanAgentModel(settings.primaryModel),
    defaultEffort: cleanAgentEffort(settings.reasoningEffort),
  }
}
