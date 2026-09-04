import type { BriefingCard, Mode } from './cockpit/cockpitTypes'

/** Hermes run cards can be stopped from the desk when the run is still live and the user is an admin. */
export function canStopAgentRun(item: BriefingCard, mode: Mode) {
  if (mode !== 'admin' || item.source.type !== 'agent-run') return false
  const runId = item.context.agentRunId ?? (typeof item.metadata?.hermesRunId === 'string' ? item.metadata.hermesRunId : null)
  const orgId = item.orgId || item.context.orgId
  if (!runId || !orgId) return false
  const status = String(item.metadata?.runStatus ?? '').toLowerCase()
  return ['running', 'in_progress', 'in-progress', 'streaming', 'queued', 'pending', 'waiting_for_approval', 'waiting_approval', 'awaiting_approval', 'approval_required'].includes(status)
}

/** Pull the newest assistant message out of a conversation so the reply box can adopt it. */
export async function harvestPipDraft(conversationId: string): Promise<string | null> {
  const res = await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`)
  if (!res.ok) return null
  const body = await res.json().catch(() => null) as { data?: { messages?: unknown }; messages?: unknown } | null
  const raw = body?.data && typeof body.data === 'object' && 'messages' in body.data ? body.data.messages : body?.messages
  if (!Array.isArray(raw)) return null
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const message = raw[index] as { role?: unknown; content?: unknown; status?: unknown } | null
    if (!message || message.role !== 'assistant') continue
    if (typeof message.status === 'string' && /pending|streaming|running/i.test(message.status)) continue
    if (typeof message.content === 'string' && message.content.trim()) return message.content.trim()
  }
  return null
}
