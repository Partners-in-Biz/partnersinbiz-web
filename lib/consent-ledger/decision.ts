import { adminDb } from '@/lib/firebase/admin'
import { isSuppressed } from '@/lib/email/suppressions'
import { evaluateConsentPrecedence, type ConsentDecision } from './precedence'
import type { ConsentChannel, ConsentState } from './types'

interface ConsentRow {
  orgId?: string
  contactId?: string
  channel?: ConsentChannel
  topicId?: string
  state?: ConsentState
  occurredAt?: string | { toDate?: () => Date; toMillis?: () => number }
}

interface QueryLike {
  where(field: string, op: '==', value: string): QueryLike
  get(): Promise<{ docs: Array<{ data(): ConsentRow }> }>
}
interface DatabaseLike { collection(name: string): QueryLike }

export interface CanonicalEmailConsentInput {
  orgId: string
  contactId: string
  email: string
  topicId: string
  transactional?: boolean
  requireConsent?: boolean
}

export interface CanonicalConsentOptions {
  db?: DatabaseLike
  lookupSuppression?: (orgId: string, email: string) => Promise<{ active: boolean; reason?: string }>
}

function time(value: ConsentRow['occurredAt']): number {
  if (typeof value === 'string') return Date.parse(value) || 0
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()
  return 0
}

function latest(rows: ConsentRow[]): { state: ConsentState } | undefined {
  const row = [...rows].sort((a, b) => time(b.occurredAt) - time(a.occurredAt))[0]
  return row?.state ? { state: row.state } : undefined
}

/** Build the canonical read model from immutable, tenant-scoped ledger rows. */
export function projectConsentFacts(input: {
  orgId: string
  contactId: string
  channel: ConsentChannel
  topicId: string
  events: ConsentRow[]
}) {
  const rows = input.events.filter((row) =>
    row.orgId === input.orgId && row.contactId === input.contactId && row.channel === input.channel,
  )
  return {
    globalConsent: latest(rows.filter((row) => row.topicId === '*')),
    channelConsent: latest(rows.filter((row) => row.topicId === `${input.channel}:*`)),
    topicConsent: latest(rows.filter((row) => row.topicId === input.topicId)),
  }
}

/**
 * Canonical dispatch-time decision. Marketing fails closed when ledger truth
 * cannot be read; transactional mail still requires the read to succeed and
 * can only bypass an absence of consent, never a revocation or suppression.
 */
export async function resolveCanonicalEmailConsent(
  input: CanonicalEmailConsentInput,
  options: CanonicalConsentOptions = {},
): Promise<ConsentDecision> {
  if (!input.orgId || !input.contactId || !input.email) {
    return { allowed: false, reason: 'missing consent scope', precedence: 'default-deny' }
  }
  try {
    const lookupSuppression = options.lookupSuppression ?? (async (orgId, email) => ({
      active: await isSuppressed(orgId, email),
    }))
    const [suppression, snapshot] = await Promise.all([
      lookupSuppression(input.orgId, input.email),
      (options.db ?? (adminDb as unknown as DatabaseLike))
        .collection('contact_consent_events')
        .where('orgId', '==', input.orgId)
        .where('contactId', '==', input.contactId)
        .get(),
    ])
    const facts = projectConsentFacts({
      orgId: input.orgId,
      contactId: input.contactId,
      channel: 'email',
      topicId: input.topicId,
      events: snapshot.docs.map((doc) => doc.data()),
    })
    return evaluateConsentPrecedence({
      suppression,
      ...facts,
      transactional: input.transactional,
      requireConsent: input.requireConsent ?? !input.transactional,
    })
  } catch {
    return { allowed: false, reason: 'consent-ledger-unavailable', precedence: 'default-deny' }
  }
}
