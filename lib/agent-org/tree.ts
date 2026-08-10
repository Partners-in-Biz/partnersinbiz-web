/**
 * AgentOrgNode tree builder — pure functions for org chart structure:
 * tree assembly, cycle detection, chain-of-command derivation, and reparent validation.
 *
 * All functions are pure (no Firestore) so they are unit-testable in isolation.
 */
import type { AgentOrgNode, OrgTreeNode } from './types'

export interface TreeResult {
  ok: boolean
  roots: OrgTreeNode[]
  /** Flat lookup keyed by node id. */
  byId: Map<string, OrgTreeNode>
  /** Node ids involved in a cycle (when ok is false). */
  cycleIds?: string[]
  error?: string
}

function nodeToTree(node: AgentOrgNode): OrgTreeNode {
  return {
    ...node,
    children: [],
    depth: 0,
    descendantIds: [],
  }
}

/**
 * Assemble nodes into a forest and derive chainOfCommand / depth / descendantIds.
 *
 * Returns ok:false when the graph contains a cycle (self-report or ancestor loop).
 */
export function buildOrgTree(nodes: AgentOrgNode[]): TreeResult {
  const byId = new Map<string, OrgTreeNode>()
  for (const node of nodes) byId.set(node.id, nodeToTree(node))

  // Validate no self-reports first.
  for (const node of nodes) {
    if (node.reportsTo === node.id) {
      return { ok: false, roots: [], byId, cycleIds: [node.id], error: `Node '${node.id}' reports to itself` }
    }
  }

  // Detect cycles by walking up reportsTo chains.
  for (const node of nodes) {
    const seen = new Set<string>()
    let cursor: string | null = node.id
    while (cursor) {
      if (seen.has(cursor)) {
        return { ok: false, roots: [], byId, cycleIds: Array.from(seen), error: `Cycle detected starting at '${node.id}'` }
      }
      seen.add(cursor)
      const parent = byId.get(cursor)
      if (!parent) break
      cursor = parent.reportsTo
    }
  }

  // Attach children and compute chains.
  const roots: OrgTreeNode[] = []
  for (const node of byId.values()) {
    if (node.reportsTo && byId.has(node.reportsTo)) {
      byId.get(node.reportsTo)!.children.push(node)
    } else {
      // Missing parent = root (also the case when reportsTo is null).
      roots.push(node)
    }
  }

  const computeDepth = (node: OrgTreeNode, depth: number, ancestors: string[]): void => {
    node.depth = depth
    node.chainOfCommand = [...ancestors]
    const nextAncestors = [...ancestors, node.id]
    for (const child of node.children) {
      computeDepth(child, depth + 1, nextAncestors)
      node.descendantIds.push(child.id, ...child.descendantIds)
    }
  }

  for (const root of roots) computeDepth(root, 0, [])

  return { ok: true, roots, byId }
}

/**
 * Validate that moving `nodeId` under `newReportsTo` keeps the tree acyclic.
 * Assumes `nodes` is the full org set (pre-move). Returns the updated node list
 * with the parent switched (without persisting), or an error.
 */
export function validateReparent(
  nodes: AgentOrgNode[],
  nodeId: string,
  newReportsTo: string | null,
): { ok: true; nodes: AgentOrgNode[] } | { ok: false; error: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const target = byId.get(nodeId)
  if (!target) return { ok: false, error: `Node '${nodeId}' not found` }

  if (newReportsTo !== null) {
    if (newReportsTo === nodeId) return { ok: false, error: 'A node cannot report to itself' }
    if (!byId.has(newReportsTo)) return { ok: false, error: `Target parent '${newReportsTo}' not found` }
    // Moving under an existing descendant would create a cycle.
    let cursor: string | null = newReportsTo
    const seen = new Set<string>()
    while (cursor) {
      if (cursor === nodeId) return { ok: false, error: `Cannot reparent '${nodeId}' under its own descendant '${newReportsTo}'` }
      if (seen.has(cursor)) break
      seen.add(cursor)
      const parent = byId.get(cursor)
      if (!parent) break
      cursor = parent.reportsTo
    }
  }

  const updated = nodes.map((n) => (n.id === nodeId ? { ...n, reportsTo: newReportsTo } : n))
  return { ok: true, nodes: updated }
}

/** Walk the reportsTo chain from a node to the root; returns ordered ids [self, parent, …, root]. */
export function chainToRoot(byId: Map<string, AgentOrgNode>, nodeId: string): string[] {
  const out: string[] = []
  let cursor: string | null = nodeId
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    out.push(cursor)
    const node = byId.get(cursor)
    cursor = node?.reportsTo ?? null
  }
  return out
}

/** True when `managerId` is a strict ancestor of `nodeId` (manager can assign down). */
export function isAncestor(byId: Map<string, AgentOrgNode>, managerId: string, nodeId: string): boolean {
  return chainToRoot(byId, nodeId).slice(1).includes(managerId)
}

/** True when two nodes share the same direct reportsTo (peers). */
export function arePeers(byId: Map<string, AgentOrgNode>, a: string, b: string): boolean {
  const na = byId.get(a)
  const nb = byId.get(b)
  if (!na || !nb) return false
  if (a === b) return false
  return (na.reportsTo ?? null) === (nb.reportsTo ?? null) && na.reportsTo !== null
}

/**
 * Root-first chain of command for a node, excluding the node itself
 * (e.g. ['ceo', 'lead'] for 'fe'). Empty for unknown or root nodes.
 */
export function deriveChainOfCommand(nodes: AgentOrgNode[], nodeId: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain = chainToRoot(byId, nodeId)
  return chain.slice(1).reverse()
}

/** True when `ancestorId` is a strict ancestor of `nodeId`. */
export function isAncestorOf(nodes: AgentOrgNode[], ancestorId: string, nodeId: string): boolean {
  return isAncestor(new Map(nodes.map((n) => [n.id, n])), ancestorId, nodeId)
}

/** True when `nodeId` sits strictly below `ancestorId` in the tree. */
export function isDescendantOf(nodes: AgentOrgNode[], nodeId: string, ancestorId: string): boolean {
  return isAncestorOf(nodes, ancestorId, nodeId)
}

/** Find the first node bound to a runtime agent id, or null. */
export function findNodeByAgentId(nodes: AgentOrgNode[], agentId: string | null): AgentOrgNode | null {
  if (!agentId) return null
  return nodes.find((n) => n.agentId === agentId) ?? null
}
