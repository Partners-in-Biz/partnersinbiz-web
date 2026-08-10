/**
 * Design Iteration ("Design this page") — org-scoped Firestore store.
 *
 * Persists design-iteration sessions (variant decks) for the P1 live-browser
 * design iteration flow in Messages. Mirrors the design-audit runs store
 * pattern: every read/write is scoped by orgId resolved from auth
 * (X-Org-Id), never from an unauthenticated body field.
 *
 * Collection: `design_iteration_sessions`.
 */

import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '@/lib/firebase/admin'
import {
  type CreateDesignIterationSessionInput,
  type DesignIterationSession,
  type DesignIterationVariant,
  designIterationOwnedBy,
} from './types'

export const DESIGN_ITERATION_SESSIONS_COLLECTION = 'design_iteration_sessions'

function sessionDoc(sessionId: string) {
  return adminDb.collection(DESIGN_ITERATION_SESSIONS_COLLECTION).doc(sessionId)
}

function toStored(session: DesignIterationSession): Record<string, unknown> {
  return {
    orgId: session.orgId,
    url: session.url,
    ...(session.title ? { title: session.title } : {}),
    ...(session.browserSessionId ? { browserSessionId: session.browserSessionId } : {}),
    ...(session.screenshotUrl ? { screenshotUrl: session.screenshotUrl } : {}),
    instruction: session.instruction,
    elementRefs: session.elementRefs,
    variants: session.variants,
    status: session.status,
    ...(session.acceptedVariantId ? { acceptedVariantId: session.acceptedVariantId } : {}),
    ...(session.apply ? { apply: session.apply } : {}),
    ...(session.createdBy ? { createdBy: session.createdBy } : {}),
    createdAtMs: session.createdAtMs,
    updatedAtMs: session.updatedAtMs,
    ...(session.error ? { error: session.error } : {}),
  }
}

function fromStored(id: string, data: Record<string, unknown>): DesignIterationSession {
  const variants = Array.isArray(data.variants)
    ? data.variants.filter((v): v is DesignIterationVariant => Boolean(v) && typeof v === 'object')
    : []
  const elementRefs = Array.isArray(data.elementRefs)
    ? data.elementRefs.filter((ref): ref is DesignIterationSession['elementRefs'][number] => Boolean(ref) && typeof ref === 'object')
    : []
  return {
    id,
    orgId: typeof data.orgId === 'string' ? data.orgId : '',
    url: typeof data.url === 'string' ? data.url : '',
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    ...(typeof data.browserSessionId === 'string' ? { browserSessionId: data.browserSessionId } : {}),
    ...(typeof data.screenshotUrl === 'string' ? { screenshotUrl: data.screenshotUrl } : {}),
    instruction: typeof data.instruction === 'string' ? data.instruction : '',
    elementRefs,
    variants,
    status: data.status === 'draft' || data.status === 'review' || data.status === 'accepted' || data.status === 'rejected' || data.status === 'applied' || data.status === 'failed'
      ? data.status
      : 'review',
    ...(typeof data.acceptedVariantId === 'string' ? { acceptedVariantId: data.acceptedVariantId } : {}),
    ...(data.apply && typeof data.apply === 'object' ? { apply: data.apply as DesignIterationSession['apply'] } : {}),
    ...(typeof data.createdBy === 'string' ? { createdBy: data.createdBy } : {}),
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
    updatedAtMs: typeof data.updatedAtMs === 'number' ? data.updatedAtMs : 0,
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
  }
}

export function generateDesignIterationSessionId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto') as typeof import('node:crypto')
  return `di_${crypto.randomBytes(16).toString('base64url')}`
}

/** Creates a new org-scoped design-iteration session (variant deck). */
export async function createDesignIterationSession(input: CreateDesignIterationSessionInput): Promise<DesignIterationSession> {
  const nowMs = input.nowMs ?? Date.now()
  const session: DesignIterationSession = {
    id: generateDesignIterationSessionId(),
    orgId: input.orgId,
    url: input.url,
    ...(input.title ? { title: input.title } : {}),
    ...(input.browserSessionId ? { browserSessionId: input.browserSessionId } : {}),
    ...(input.screenshotUrl ? { screenshotUrl: input.screenshotUrl } : {}),
    instruction: input.instruction,
    elementRefs: input.elementRefs ?? [],
    variants: input.variants ?? [],
    status: (input.variants?.length ?? 0) > 0 ? 'review' : 'draft',
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }
  await sessionDoc(session.id).set(toStored(session))
  return session
}

/** Reads a session scoped to orgId. Returns null when missing or org-mismatched. */
export async function getDesignIterationSession(orgId: string, sessionId: string): Promise<DesignIterationSession | null> {
  if (!sessionId || !orgId) return null
  const snap = await sessionDoc(sessionId).get()
  if (!snap.exists) return null
  const session = fromStored(snap.id, snap.data() ?? {})
  if (!designIterationOwnedBy(session, orgId)) return null
  return session
}

/** Appends variants to an existing deck (org-scoped). Returns null when missing/org-mismatched. */
export async function addDesignIterationVariants(
  orgId: string,
  sessionId: string,
  variants: DesignIterationVariant[],
  options: { nowMs?: number } = {},
): Promise<DesignIterationSession | null> {
  const existing = await getDesignIterationSession(orgId, sessionId)
  if (!existing) return null
  const nowMs = options.nowMs ?? Date.now()
  const next: DesignIterationSession = {
    ...existing,
    variants: [...existing.variants, ...variants],
    status: 'review',
    updatedAtMs: nowMs,
  }
  await sessionDoc(existing.id).update({
    variants: next.variants,
    status: next.status,
    updatedAtMs: next.updatedAtMs,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return next
}

export interface DecideVariantResult {
  session: DesignIterationSession | null
  variant: DesignIterationVariant | null
}

/** Accepts or rejects a single variant; updates the session status accordingly. */
export async function decideDesignIterationVariant(input: {
  orgId: string
  sessionId: string
  variantId: string
  decision: 'accept' | 'reject'
  decisionNote?: string
  decidedBy?: string
  nowMs?: number
}): Promise<DecideVariantResult> {
  const existing = await getDesignIterationSession(input.orgId, input.sessionId)
  if (!existing) return { session: null, variant: null }

  const nowMs = input.nowMs ?? Date.now()
  let target: DesignIterationVariant | null = null
  const variants = existing.variants.map((variant) => {
    if (variant.id !== input.variantId) return variant
    target = {
      ...variant,
      status: input.decision === 'accept' ? 'accepted' : 'rejected',
      ...(input.decisionNote ? { decisionNote: input.decisionNote } : {}),
      ...(input.decidedBy ? { decidedBy: input.decidedBy } : {}),
      decidedAtMs: nowMs,
    }
    return target
  })

  const accepted = variants.find((variant) => variant.status === 'accepted')
  const pendingCount = variants.filter((variant) => variant.status === 'pending').length
  const nextStatus = accepted
    ? 'accepted'
    : pendingCount === 0
      ? 'rejected'
      : existing.status === 'applied'
        ? existing.status
        : 'review'

  const next: DesignIterationSession = {
    ...existing,
    variants,
    status: nextStatus,
    ...(accepted ? { acceptedVariantId: accepted.id } : {}),
    updatedAtMs: nowMs,
  }
  await sessionDoc(existing.id).update({
    variants: next.variants,
    status: next.status,
    ...(accepted ? { acceptedVariantId: accepted.id } : {}),
    updatedAtMs: next.updatedAtMs,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { session: next, variant: target }
}

/** Records the repo-write after an explicit Accept (agent-reported evidence). */
export async function applyDesignIteration(input: {
  orgId: string
  sessionId: string
  apply: DesignIterationSession['apply']
  nowMs?: number
}): Promise<DesignIterationSession | null> {
  const existing = await getDesignIterationSession(input.orgId, input.sessionId)
  if (!existing) return null
  if (!existing.acceptedVariantId) return null
  const nowMs = input.nowMs ?? Date.now()
  const next: DesignIterationSession = {
    ...existing,
    apply: input.apply,
    status: 'applied',
    updatedAtMs: nowMs,
  }
  await sessionDoc(existing.id).update({
    apply: input.apply,
    status: next.status,
    updatedAtMs: next.updatedAtMs,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return next
}

/** Lists the most recent sessions for an org (descending by createdAtMs). */
export async function listDesignIterationSessions(orgId: string, limit = 20): Promise<DesignIterationSession[]> {
  const snap = await adminDb
    .collection(DESIGN_ITERATION_SESSIONS_COLLECTION)
    .where('orgId', '==', orgId)
    .orderBy('createdAtMs', 'desc')
    .limit(limit)
    .get()
  return snap.docs.map((doc) => fromStored(doc.id, doc.data() ?? {}))
}
