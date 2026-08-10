import { describe, it, expect } from '@jest/globals'
import {
  buildOrgTree,
  deriveChainOfCommand,
  validateReparent,
  isDescendantOf,
  isAncestorOf,
  findNodeByAgentId,
} from '@/lib/agent-org/tree'
import type { AgentOrgNode } from '@/lib/agent-org/types'

function node(overrides: Partial<AgentOrgNode> & { id: string; orgId?: string }): AgentOrgNode {
  return {
    orgId: 'org-test',
    agentId: null,
    name: overrides.id,
    title: overrides.id,
    reportsTo: null,
    chainOfCommand: [],
    capabilities: [],
    defaultModel: null,
    defaultEffort: null,
    delegation: { assignableFrom: 'manager_only', escalateToManager: true, allowLateral: false },
    status: 'active',
    iconKey: 'bot',
    colorKey: 'blue',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('agent-org tree', () => {
  it('builds a forest with depth and children', () => {
    const nodes = [
      node({ id: 'ceo', reportsTo: null }),
      node({ id: 'lead', reportsTo: 'ceo' }),
      node({ id: 'fe', reportsTo: 'lead' }),
      node({ id: 'be', reportsTo: 'lead' }),
    ]
    const tree = buildOrgTree(nodes)
    expect(tree.ok).toBe(true)
    const roots = tree.roots ?? []
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('ceo')
    expect(roots[0].children.map((c) => c.id)).toEqual(['lead'])
    expect(roots[0].children[0].children.map((c) => c.id)).toEqual(['fe', 'be'])
    expect(roots[0].depth).toBe(0)
    expect(roots[0].children[0].depth).toBe(1)
    const lead = tree.byId?.get('lead')
    expect(lead?.descendantIds).toEqual(['fe', 'be'])
  })

  it('allows multiple roots', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b' })]
    const tree = buildOrgTree(nodes)
    expect(tree.ok).toBe(true)
    expect(tree.roots).toHaveLength(2)
  })

  it('rejects a reportsTo cycle', () => {
    const nodes = [
      node({ id: 'a', reportsTo: 'b' }),
      node({ id: 'b', reportsTo: 'a' }),
    ]
    const tree = buildOrgTree(nodes)
    expect(tree.ok).toBe(false)
    expect(tree.error).toMatch(/cycle/i)
  })

  it('rejects self-reporting', () => {
    const tree = buildOrgTree([node({ id: 'a', reportsTo: 'a' })])
    expect(tree.ok).toBe(false)
  })

  it('derives chain of command root-first', () => {
    const chain = deriveChainOfCommand([
      node({ id: 'ceo' }),
      node({ id: 'lead', reportsTo: 'ceo' }),
      node({ id: 'fe', reportsTo: 'lead' }),
    ], 'fe')
    expect(chain).toEqual(['ceo', 'lead'])
  })

  it('returns empty chain for unknown or root node', () => {
    expect(deriveChainOfCommand([node({ id: 'a' })], 'a')).toEqual([])
    expect(deriveChainOfCommand([node({ id: 'a' })], 'zzz')).toEqual([])
  })

  it('validateReparent rejects moving a node under its own descendant', () => {
    const nodes = [
      node({ id: 'ceo' }),
      node({ id: 'lead', reportsTo: 'ceo' }),
      node({ id: 'fe', reportsTo: 'lead' }),
    ]
    const res = validateReparent(nodes, 'lead', 'fe')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('descendant')
  })

  it('validateReparent rejects self and unknown targets', () => {
    const nodes = [node({ id: 'a' }), node({ id: 'b', reportsTo: 'a' })]
    expect(validateReparent(nodes, 'a', 'a').ok).toBe(false)
    expect(validateReparent(nodes, 'a', 'nope').ok).toBe(false)
  })

  it('validateReparent accepts a valid move', () => {
    const nodes = [
      node({ id: 'ceo' }),
      node({ id: 'a', reportsTo: 'ceo' }),
      node({ id: 'b', reportsTo: 'a' }),
    ]
    expect(validateReparent(nodes, 'b', 'ceo').ok).toBe(true)
  })

  it('detects ancestry helpers', () => {
    const nodes = [
      node({ id: 'ceo' }),
      node({ id: 'lead', reportsTo: 'ceo' }),
      node({ id: 'fe', reportsTo: 'lead' }),
    ]
    expect(isAncestorOf(nodes, 'ceo', 'fe')).toBe(true)
    expect(isAncestorOf(nodes, 'lead', 'fe')).toBe(true)
    expect(isAncestorOf(nodes, 'fe', 'ceo')).toBe(false)
    expect(isDescendantOf(nodes, 'fe', 'ceo')).toBe(true)
    expect(isDescendantOf(nodes, 'ceo', 'fe')).toBe(false)
  })

  it('finds nodes by bound agentId', () => {
    const nodes = [node({ id: 'fe', agentId: 'theo-fe' })]
    expect(findNodeByAgentId(nodes, 'theo-fe')?.id).toBe('fe')
    expect(findNodeByAgentId(nodes, 'ghost')).toBeNull()
  })
})
