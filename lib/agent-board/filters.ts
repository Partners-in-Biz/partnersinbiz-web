import type { AgentId } from './types'

export type AgentBoardOperationalView =
  | 'all'
  | 'blocked'
  | 'awaiting-input'
  | 'document-linked'
  | 'dependency-blocked'
  | 'cron-origin'
  | 'cross-client'

export type AgentBoardBadgeId =
  | `agent:${AgentId}`
  | 'blocked'
  | 'awaiting-input'
  | 'document-linked'
  | 'dependency-blocked'
  | 'cron-origin'
  | 'cross-client'

export type AgentBoardBadgeTone = 'agent' | 'danger' | 'warning' | 'info' | 'purple' | 'neutral'

export type AgentBoardBadge = {
  id: AgentBoardBadgeId
  label: string
  tone: AgentBoardBadgeTone
  title?: string
}

export type AgentBoardTaskLike = {
  id: string
  source: 'project' | 'standalone'
  orgId: string
  title: string
  projectId: string | null
  projectName: string | null
  assigneeAgentId: AgentId | null
  agentStatus: string | null
  agentInputSpec: string | null
  agentOutputSummary: string | null
  priority: string | null
  tags: string[]
  labels?: string[]
  updatedAt: string | null
  createdAt: string | null
  href: string
  columnId?: string | null
  dependsOn?: string[]
  dependencyStatuses?: Record<string, string | null>
  linkedDocumentId?: string | null
  linkedDocumentIds?: string[]
  linkedDocuments?: Array<string | { id?: string | null; ref?: string | null; type?: string | null }>
  clientDocumentId?: string | null
  documentId?: string | null
  sourceOrigin?: string | null
  origin?: string | null
  originType?: string | null
  createdBy?: string | null
  clientOrgId?: string | null
}

export const AGENT_BOARD_OPERATIONAL_VIEWS: Array<{ id: AgentBoardOperationalView; label: string; shortLabel: string }> = [
  { id: 'all', label: 'All operations', shortLabel: 'All' },
  { id: 'blocked', label: 'Blocked', shortLabel: 'Blocked' },
  { id: 'awaiting-input', label: 'Awaiting input', shortLabel: 'Input' },
  { id: 'document-linked', label: 'Document-linked', shortLabel: 'Docs' },
  { id: 'dependency-blocked', label: 'Dependency-blocked', shortLabel: 'Deps' },
  { id: 'cron-origin', label: 'Cron-origin', shortLabel: 'Cron' },
  { id: 'cross-client', label: 'Cross-client', shortLabel: 'X-client' },
]

function lowerValues(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.toLowerCase())
}

function hasMarker(card: AgentBoardTaskLike, marker: string): boolean {
  const needle = marker.toLowerCase()
  return lowerValues([...(card.tags ?? []), ...(card.labels ?? [])]).some((value) => value === needle || value.startsWith(`${needle}:`))
}

export function hasDocumentLink(card: AgentBoardTaskLike): boolean {
  return Boolean(
    card.linkedDocumentId
    || card.clientDocumentId
    || card.documentId
    || (Array.isArray(card.linkedDocumentIds) && card.linkedDocumentIds.length > 0)
    || (Array.isArray(card.linkedDocuments) && card.linkedDocuments.length > 0)
    || hasMarker(card, 'document')
    || hasMarker(card, 'client-document')
  )
}

export function hasDependencyBlocker(card: AgentBoardTaskLike): boolean {
  if (hasMarker(card, 'dependency-blocked') || hasMarker(card, 'blocked-by')) return true
  const deps = Array.isArray(card.dependsOn) ? card.dependsOn.filter(Boolean) : []
  if (deps.length === 0) return false
  const statuses = card.dependencyStatuses ?? {}
  const knownStatuses = deps.map((dep) => statuses[dep]).filter((status): status is string => typeof status === 'string')
  if (knownStatuses.length === 0) return card.agentStatus === 'pending' || card.agentStatus === 'awaiting-input'
  return knownStatuses.some((status) => !['done', 'completed', 'approved'].includes(status))
}

export function hasCronOrigin(card: AgentBoardTaskLike): boolean {
  if (hasMarker(card, 'cron') || hasMarker(card, 'cron-origin')) return true
  return lowerValues([card.sourceOrigin, card.origin, card.originType, card.createdBy]).some((value) => value.includes('cron'))
}

export function isCrossClient(card: AgentBoardTaskLike): boolean {
  if (hasMarker(card, 'cross-client')) return true
  return Boolean(card.clientOrgId && card.clientOrgId !== card.orgId)
}

export function isBlocked(card: AgentBoardTaskLike): boolean {
  return card.agentStatus === 'blocked' || card.columnId === 'blocked' || hasMarker(card, 'blocked')
}

export function isAwaitingInput(card: AgentBoardTaskLike): boolean {
  return card.agentStatus === 'awaiting-input' || hasMarker(card, 'awaiting-input')
}

export function matchesAgentBoardView(card: AgentBoardTaskLike, view: AgentBoardOperationalView): boolean {
  switch (view) {
    case 'all':
      return true
    case 'blocked':
      return isBlocked(card)
    case 'awaiting-input':
      return isAwaitingInput(card)
    case 'document-linked':
      return hasDocumentLink(card)
    case 'dependency-blocked':
      return hasDependencyBlocker(card)
    case 'cron-origin':
      return hasCronOrigin(card)
    case 'cross-client':
      return isCrossClient(card)
  }
}

export function getAgentBoardBadges(card: AgentBoardTaskLike): AgentBoardBadge[] {
  const badges: AgentBoardBadge[] = []
  if (card.assigneeAgentId) {
    badges.push({ id: `agent:${card.assigneeAgentId}`, label: card.assigneeAgentId, tone: 'agent', title: `Assigned to ${card.assigneeAgentId}` })
  }
  if (isBlocked(card)) badges.push({ id: 'blocked', label: 'Blocked', tone: 'danger' })
  if (isAwaitingInput(card)) badges.push({ id: 'awaiting-input', label: 'Awaiting input', tone: 'warning' })
  if (hasDocumentLink(card)) badges.push({ id: 'document-linked', label: 'Doc-linked', tone: 'info' })
  if (hasDependencyBlocker(card)) badges.push({ id: 'dependency-blocked', label: 'Dependency', tone: 'warning' })
  if (hasCronOrigin(card)) badges.push({ id: 'cron-origin', label: 'Cron', tone: 'purple' })
  if (isCrossClient(card)) badges.push({ id: 'cross-client', label: 'Cross-client', tone: 'neutral' })
  return badges
}

export function getAgentBoardFilterCounts(cards: AgentBoardTaskLike[]): Record<AgentBoardOperationalView, number> {
  return AGENT_BOARD_OPERATIONAL_VIEWS.reduce((acc, view) => {
    acc[view.id] = cards.filter((card) => matchesAgentBoardView(card, view.id)).length
    return acc
  }, {} as Record<AgentBoardOperationalView, number>)
}
