/**
 * Client-safe Kanban task allowlists (no Node/Firebase imports).
 *
 * Workflow Graph engine + authoring run in the browser via
 * WorkflowGraphAuthoringPanel. Do not import taskPayload or task-llm from
 * client-reachable paths — those pull firebase-admin and break the Vercel
 * webpack client build (async_hooks / fs / net / http2).
 */

export const VALID_APPROVAL_GATES = [
  'none',
  'human-review',
  'client-visible',
  'public-publishing',
  'paid-spend',
  'production-deploy',
  'finance',
  'destructive',
  'secret-config',
  'none-until-production-or-client-visible',
] as const

export const VALID_AGENT_CAPABILITIES = [
  'read',
  'draft',
  'write',
  'approve',
  'publish',
  'deploy',
  'spend',
  'message_client',
  'access_secret',
  'delete',
  'software_build',
  'client_document',
  'research',
  'seo',
  'geo_seo',
  'qa',
  'content',
  'engineering',
  'quality-assurance',
  'research-recommendation-followup',
  'research-intelligence',
  'agent-evolution-review',
  'business-insight-review',
  'platform-engineering',
  'platform-ops',
  'coordination',
  'decision-routing',
  'review',
  'public-publishing',
  'production-deploy',
] as const

export type ApprovalGate = (typeof VALID_APPROVAL_GATES)[number]
export type AgentCapability = (typeof VALID_AGENT_CAPABILITIES)[number]

export function isValidAgentCapability(value: unknown): value is AgentCapability {
  const cleaned = typeof value === 'string' ? value.trim() : ''
  return Boolean(cleaned) && VALID_AGENT_CAPABILITIES.includes(cleaned as AgentCapability)
}

export function isValidApprovalGate(value: unknown): value is ApprovalGate {
  const cleaned = typeof value === 'string' ? value.trim() : ''
  return Boolean(cleaned) && VALID_APPROVAL_GATES.includes(cleaned as ApprovalGate)
}
