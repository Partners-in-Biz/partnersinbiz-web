/**
 * Client-safe actor display helpers.
 *
 * Keep this module free of firebase-admin / Node-only imports so UI components
 * can render ownership labels without pulling server SDKs into the browser bundle.
 */

export type ActorType = 'user' | 'agent' | 'system'

/**
 * Human-readable attribution label for lists and detail headers.
 * Prefer resolved display name for the owner; append "via {agent}" when assisted.
 */
export function formatActorLabel(input: {
  createdBy?: string | null
  createdByType?: ActorType | string | null
  createdByAgentId?: string | null
  ownerDisplayName?: string | null
}): string {
  const ownerName = (input.ownerDisplayName || '').trim()
  const createdBy = (input.createdBy || '').trim()
  const agentId = (input.createdByAgentId || '').trim()
  const agentLabel = agentId
    ? agentId.charAt(0).toUpperCase() + agentId.slice(1)
    : ''

  let ownerLabel = ownerName
  if (!ownerLabel) {
    if (createdBy.includes('@')) ownerLabel = createdBy
    else if (input.createdByType === 'agent' || createdBy.startsWith('agent:')) {
      const bare = createdBy.startsWith('agent:') ? createdBy.slice('agent:'.length) : createdBy
      ownerLabel = bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : 'AI agent'
    } else if (createdBy) {
      ownerLabel = 'Team member'
    } else {
      ownerLabel = 'Unknown'
    }
  }

  if (agentLabel && input.createdByType !== 'agent' && !createdBy.startsWith('agent:')) {
    return `${ownerLabel} via ${agentLabel}`
  }
  if (agentLabel && (input.createdByType === 'agent' || createdBy.startsWith('agent:'))) {
    return agentLabel
  }
  return ownerLabel
}
