import { describe, it, expect } from '@jest/globals'
import { canAssign, describeAssignability } from '@/lib/agent-org/permissions'
import type { AgentOrgNode, OrgNodeDelegation } from '@/lib/agent-org/types'
import { DEFAULT_ORG_NODE_DELEGATION } from '@/lib/agent-org/types'

function node(
  overrides: Partial<AgentOrgNode> & { id: string; agentId?: string | null },
): AgentOrgNode {
  const delegation: OrgNodeDelegation = {
    ...DEFAULT_ORG_NODE_DELEGATION,
    ...(overrides.delegation ?? {}),
  }
  return {
    orgId: 'org-test',
    agentId: overrides.agentId ?? overrides.id,
    name: overrides.id,
    title: overrides.id,
    reportsTo: null,
    chainOfCommand: [],
    capabilities: [],
    defaultModel: null,
    defaultEffort: null,
    delegation,
    status: 'active',
    iconKey: 'bot',
    colorKey: 'blue',
    createdAt: null,
    updatedAt: null,
    ...overrides,
    delegation,
  }
}

const chart = [
  node({ id: 'pip', agentId: 'pip', reportsTo: null }),
  node({
    id: 'theo',
    agentId: 'theo',
    reportsTo: 'pip',
    delegation: { assignableFrom: 'manager_only', escalateToManager: true, allowLateral: false },
  }),
  node({
    id: 'fe',
    agentId: 'theo-fe',
    reportsTo: 'theo',
    delegation: { assignableFrom: 'manager_only', escalateToManager: true, allowLateral: false },
  }),
  node({
    id: 'be',
    agentId: 'theo-be',
    reportsTo: 'theo',
    delegation: { assignableFrom: 'manager_and_peers', escalateToManager: true, allowLateral: true },
  }),
]

describe('agent-org permissions', () => {
  it('lets humans assign to anyone', () => {
    expect(canAssign(chart, { kind: 'human', uid: 'peet' }, 'theo-fe').allowed).toBe(true)
  })

  it('lets a manager assign down the tree', () => {
    expect(canAssign(chart, { kind: 'agent', agentId: 'theo' }, 'theo-fe').allowed).toBe(true)
    expect(canAssign(chart, { kind: 'agent', agentId: 'pip' }, 'theo-be').allowed).toBe(true)
  })

  it('allows peer assignment when assignee has manager_and_peers + allowLateral', () => {
    // Assignee is BE (manager_and_peers + lateral). FE is a peer under Theo.
    expect(canAssign(chart, { kind: 'agent', agentId: 'theo-fe' }, 'theo-be').allowed).toBe(true)
  })

  it('blocks peer assignment into a manager_only node', () => {
    // Assignee is FE (manager_only). BE may not assign laterally into FE.
    expect(canAssign(chart, { kind: 'agent', agentId: 'theo-be' }, 'theo-fe').allowed).toBe(false)
  })

  it('blocks a report assigning up to the manager when manager_only', () => {
    const res = canAssign(chart, { kind: 'agent', agentId: 'theo-fe' }, 'theo')
    expect(res.allowed).toBe(false)
  })

  it('blocks assignment to a paused node for agents', () => {
    const paused = chart.map((n) => (n.id === 'fe' ? { ...n, status: 'paused' as const } : n))
    const res = canAssign(paused, { kind: 'agent', agentId: 'theo' }, 'theo-fe')
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/paused/i)
  })

  it('allows self-assignment and open nodes', () => {
    expect(canAssign(chart, { kind: 'agent', agentId: 'theo' }, 'theo').allowed).toBe(true)
    const open = chart.map((n) =>
      n.id === 'fe'
        ? { ...n, delegation: { assignableFrom: 'anyone' as const, escalateToManager: true, allowLateral: false } }
        : n,
    )
    expect(canAssign(open, { kind: 'agent', agentId: 'theo-be' }, 'theo-fe').allowed).toBe(true)
  })

  it('describes assignability for the UI', () => {
    expect(describeAssignability(chart[1])).toMatch(/Manager only/i)
    expect(describeAssignability(chart[3])).toMatch(/peers/i)
  })
})
