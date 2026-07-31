import type { EventHookConfig, HookKind } from './types'

const HOOK_KINDS: HookKind[] = ['gateway_log', 'tool_guard', 'webhook', 'metrics']

export function isHookKind(value: string): value is HookKind {
  return (HOOK_KINDS as string[]).includes(value)
}

export function createHook(input: {
  orgId: string
  kind: string
  name: string
  config?: Record<string, string>
  enabled?: boolean
  id?: string
}): EventHookConfig {
  if (!isHookKind(input.kind)) throw new Error(`Unknown hook kind: ${input.kind}`)
  if (!input.name.trim()) throw new Error('Hook name is required')
  const now = new Date().toISOString()
  return {
    id: input.id || `hook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    orgId: input.orgId,
    kind: input.kind,
    name: input.name.trim(),
    enabled: input.enabled !== false,
    config: { ...(input.config || {}) },
    createdAt: now,
    updatedAt: now,
  }
}

export function setHookEnabled(hook: EventHookConfig, enabled: boolean): EventHookConfig {
  return { ...hook, enabled, updatedAt: new Date().toISOString() }
}

export function listHookKinds(): HookKind[] {
  return [...HOOK_KINDS]
}
