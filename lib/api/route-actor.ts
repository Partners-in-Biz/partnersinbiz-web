/**
 * Route-level X-Agent-Actor forwarding helpers (design-audit / design-iteration).
 *
 * Distinct from `lib/api/actor.ts` (the pre-existing actor-info module).
 * The security gate (427443696 / allow-private precedent) requires every
 * route an agent can call to read the `X-Agent-Actor` header and treat an
 * agent caller distinctly from a human UI caller:
 *   - UI calls from Messages never send it -> 'user'
 *   - Agent skill calls always send it -> 'agent'
 *
 * `workbenchBrowserActorKindFromHeader` is the canonical resolver (pure,
 * dependency-free). These wrappers add the ApiUser-aware audit label used by
 * design-audit / design-iteration record fields (createdBy / decidedBy /
 * appliedBy).
 */

import { workbenchBrowserActorKindFromHeader } from '@/lib/messages/workbench/browser-sessions'
import type { ApiUser } from './types'

export type RouteActorKind = 'user' | 'agent' | undefined

/** Resolves the acting side from the X-Agent-Actor header (canonical workbench resolver). */
export function routeActorKind(header: string | null | undefined): RouteActorKind {
  return workbenchBrowserActorKindFromHeader(header)
}

/**
 * Audit label for a record field. Agent callers (header present, or an ai-role
 * API key caller) are labelled `agent:<id>`; human UI callers use their uid.
 */
export function routeActorLabel(header: string | null | undefined, user: ApiUser): string {
  const kind = workbenchBrowserActorKindFromHeader(header)
  if (kind === 'agent') return `agent:${user.agentId ?? 'unknown'}`
  if (user.role === 'ai') return user.uid
  return user.uid
}
