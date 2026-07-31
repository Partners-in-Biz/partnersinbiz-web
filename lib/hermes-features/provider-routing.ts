import type { ProviderRoutingPolicy } from './types'

export function createRoutingPolicy(input: {
  orgId: string
  sort?: ProviderRoutingPolicy['sort']
  allowlist?: string[]
  denylist?: string[]
  priority?: string[]
}): ProviderRoutingPolicy {
  return {
    orgId: input.orgId,
    sort: input.sort || 'priority',
    allowlist: [...(input.allowlist || [])],
    denylist: [...(input.denylist || [])],
    priority: [...(input.priority || [])],
    updatedAt: new Date().toISOString(),
  }
}

export function applyRoutingPolicy(
  policy: ProviderRoutingPolicy,
  candidates: string[],
): string[] {
  let list = candidates.map((c) => c.trim()).filter(Boolean)
  if (policy.allowlist.length > 0) {
    const allow = new Set(policy.allowlist.map((x) => x.toLowerCase()))
    list = list.filter((c) => allow.has(c.toLowerCase()))
  }
  if (policy.denylist.length > 0) {
    const deny = new Set(policy.denylist.map((x) => x.toLowerCase()))
    list = list.filter((c) => !deny.has(c.toLowerCase()))
  }
  if (policy.sort === 'priority' && policy.priority.length > 0) {
    const order = new Map(policy.priority.map((p, i) => [p.toLowerCase(), i]))
    list = [...list].sort((a, b) => {
      const ai = order.has(a.toLowerCase()) ? order.get(a.toLowerCase())! : 999
      const bi = order.has(b.toLowerCase()) ? order.get(b.toLowerCase())! : 999
      return ai - bi || a.localeCompare(b)
    })
  } else if (policy.sort === 'cost' || policy.sort === 'speed' || policy.sort === 'quality') {
    // Stable alpha when no external cost/speed metadata is present
    list = [...list].sort((a, b) => a.localeCompare(b))
  }
  return list
}

export function updateRoutingPolicy(
  policy: ProviderRoutingPolicy,
  patch: Partial<Pick<ProviderRoutingPolicy, 'sort' | 'allowlist' | 'denylist' | 'priority'>>,
): ProviderRoutingPolicy {
  return {
    ...policy,
    ...(patch.sort ? { sort: patch.sort } : {}),
    ...(patch.allowlist ? { allowlist: [...patch.allowlist] } : {}),
    ...(patch.denylist ? { denylist: [...patch.denylist] } : {}),
    ...(patch.priority ? { priority: [...patch.priority] } : {}),
    updatedAt: new Date().toISOString(),
  }
}
