import { createHash } from 'crypto'
import type { Contact } from '@/lib/crm/types'
import type {
  AudienceClause,
  AudienceDefinition,
  AudienceEstimate,
  AudienceExclusion,
  AudienceExclusionReason,
} from './audience-types'

export interface EligibilityGateResult {
  allowed: boolean
  reason?: string
}

export interface AudienceEligibilityInput {
  contacts: Contact[]
  topicId: string
  holdoutPercent?: number
  holdoutSeed?: string
  isSuppressed: (contact: Contact) => Promise<boolean>
  checkPreference: (contact: Contact, topicId: string) => Promise<EligibilityGateResult>
  checkFrequency: (contact: Contact, topicId: string) => Promise<EligibilityGateResult>
  checkSender: (contact: Contact) => Promise<EligibilityGateResult>
  checkPolicy?: (contact: Contact) => Promise<EligibilityGateResult>
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function dedupeAudienceContacts(contacts: Contact[]): {
  contacts: Contact[]
  duplicateContactIds: string[]
} {
  const seen = new Set<string>()
  const unique: Contact[] = []
  const duplicateContactIds: string[] = []

  for (const contact of contacts) {
    const key = normalizeEmail(contact.email ?? '')
    if (key && seen.has(key)) {
      duplicateContactIds.push(contact.id)
      continue
    }
    if (key) seen.add(key)
    unique.push(contact)
  }

  return { contacts: unique, duplicateContactIds }
}

export function applyDeterministicHoldout(
  contactIds: string[],
  percentage: number,
  seed: string,
): { eligibleContactIds: string[]; holdoutContactIds: string[] } {
  const bounded = Math.max(0, Math.min(100, Number.isFinite(percentage) ? percentage : 0))
  const unique = [...new Set(contactIds)]
  const ranked = unique
    .map((contactId) => ({
      contactId,
      rank: createHash('sha256').update(`${seed}:${contactId}`).digest('hex'),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
  const holdoutCount = Math.floor((ranked.length * bounded) / 100)
  const holdoutContactIds = ranked.slice(0, holdoutCount).map((item) => item.contactId).sort()
  const holdout = new Set(holdoutContactIds)
  const eligibleContactIds = unique.filter((contactId) => !holdout.has(contactId)).sort()
  return { eligibleContactIds, holdoutContactIds }
}

function increment(
  counts: Partial<Record<AudienceExclusionReason, number>>,
  reason: AudienceExclusionReason,
): void {
  counts[reason] = (counts[reason] ?? 0) + 1
}

export async function classifyAudienceEligibility(
  input: AudienceEligibilityInput,
): Promise<AudienceEstimate> {
  const excludedCounts: Partial<Record<AudienceExclusionReason, number>> = {}
  const exclusions: AudienceExclusion[] = []
  const deduped = dedupeAudienceContacts(input.contacts)

  for (const contactId of deduped.duplicateContactIds) {
    increment(excludedCounts, 'duplicate')
    exclusions.push({ contactId, reason: 'duplicate' })
  }

  const eligible: string[] = []
  for (const contact of deduped.contacts) {
    const email = normalizeEmail(contact.email ?? '')
    let reason: AudienceExclusionReason | null = null
    let detail: string | undefined

    if (!email) {
      reason = 'no_email'
    } else if (!isValidEmail(email)) {
      reason = 'invalid_email'
    } else if (await input.isSuppressed(contact)) {
      reason = 'suppressed'
    } else {
      const preference = await input.checkPreference(contact, input.topicId)
      if (!preference.allowed) {
        reason = 'topic_opt_out'
        detail = preference.reason
      } else {
        const frequency = await input.checkFrequency(contact, input.topicId)
        if (!frequency.allowed) {
          reason = 'frequency_cap'
          detail = frequency.reason
        } else {
          const sender = await input.checkSender(contact)
          if (!sender.allowed) {
            reason = 'sender_failure'
            detail = sender.reason
          } else if (input.checkPolicy) {
            const policy = await input.checkPolicy(contact)
            if (!policy.allowed) {
              reason = 'policy_block'
              detail = policy.reason
            }
          }
        }
      }
    }

    if (reason) {
      increment(excludedCounts, reason)
      exclusions.push({ contactId: contact.id, email: email || undefined, reason, detail })
    } else {
      eligible.push(contact.id)
    }
  }

  const held = applyDeterministicHoldout(
    eligible,
    input.holdoutPercent ?? 0,
    input.holdoutSeed ?? 'audience',
  )
  for (const contactId of held.holdoutContactIds) {
    increment(excludedCounts, 'holdout')
    exclusions.push({ contactId, reason: 'holdout' })
  }

  return {
    totalCandidates: input.contacts.length,
    eligibleCount: held.eligibleContactIds.length,
    holdoutCount: held.holdoutContactIds.length,
    eligibleContactIds: held.eligibleContactIds,
    holdoutContactIds: held.holdoutContactIds,
    excludedCounts,
    exclusions,
    generatedAt: new Date().toISOString(),
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

async function resolveClause(orgId: string, clause: AudienceClause): Promise<Contact[]> {
  const [{ adminDb }, segments] = await Promise.all([
    import('@/lib/firebase/admin'),
    import('@/lib/crm/segments'),
  ])
  const found = new Map<string, Contact>()

  if (clause.type === 'all_contacts') {
    const snapshot = await adminDb.collection('contacts').where('orgId', '==', orgId).limit(50_000).get()
    for (const doc of snapshot.docs) found.set(doc.id, { id: doc.id, ...doc.data() } as Contact)
  } else if (clause.type === 'segment') {
    const snapshot = await adminDb.collection('segments').doc(clause.segmentId).get()
    const data = snapshot.data()
    if (snapshot.exists && data?.orgId === orgId && data.deleted !== true) {
      const contacts = data.ruleGroup
        ? await segments.resolveRuleGroup(orgId, data.ruleGroup)
        : await segments.resolveSegmentContacts(orgId, data.filters ?? {})
      for (const contact of contacts) found.set(contact.id, contact)
    }
  } else if (clause.type === 'contacts') {
    for (const ids of chunks(clause.contactIds, 10)) {
      const snapshot = await adminDb.collection('contacts').where('__name__', 'in', ids).get()
      for (const doc of snapshot.docs) {
        const contact = { id: doc.id, ...doc.data() } as Contact
        if (contact.orgId === orgId) found.set(contact.id, contact)
      }
    }
  } else if (clause.type === 'tags') {
    for (const tags of chunks(clause.tags, 10)) {
      const snapshot = await adminDb
        .collection('contacts')
        .where('orgId', '==', orgId)
        .where('tags', 'array-contains-any', tags)
        .limit(50_000)
        .get()
      for (const doc of snapshot.docs) found.set(doc.id, { id: doc.id, ...doc.data() } as Contact)
    }
  } else {
    const group = segments.sanitizeRuleGroup(clause.ruleGroup)
    if (group) {
      const contacts = await segments.resolveRuleGroup(orgId, group)
      for (const contact of contacts) found.set(contact.id, contact)
    }
  }
  return [...found.values()]
}

/** Resolve include clauses as a union, then subtract every exclude clause. */
export async function resolveAudienceDefinition(
  orgId: string,
  definition: AudienceDefinition,
): Promise<Contact[]> {
  if (!orgId) return []
  const included = new Map<string, Contact>()
  for (const clause of definition.include) {
    for (const contact of await resolveClause(orgId, clause)) included.set(contact.id, contact)
  }
  for (const clause of definition.exclude ?? []) {
    for (const contact of await resolveClause(orgId, clause)) included.delete(contact.id)
  }
  return [...included.values()]
}

export interface EstimateAudienceOptions {
  holdoutSeed?: string
  checkSender?: (contact: Contact) => Promise<EligibilityGateResult>
  checkPolicy?: (contact: Contact) => Promise<EligibilityGateResult>
}

/** Use the same suppression, preference, and frequency gates as send execution. */
export async function estimateAudienceDefinition(
  orgId: string,
  definition: AudienceDefinition,
  options: EstimateAudienceOptions = {},
): Promise<AudienceEstimate> {
  const [contacts, suppressions, preferences, frequency] = await Promise.all([
    resolveAudienceDefinition(orgId, definition),
    import('@/lib/email/suppressions'),
    import('@/lib/preferences/store'),
    import('@/lib/email/frequency'),
  ])
  const suppressed = await suppressions.getSuppressedEmails(orgId, contacts.map((item) => item.email))
  return classifyAudienceEligibility({
    contacts,
    topicId: definition.topicId,
    holdoutPercent: definition.holdoutPercent,
    holdoutSeed: options.holdoutSeed,
    isSuppressed: async (contact) => suppressed.has(suppressions.normalizeEmail(contact.email)),
    checkPreference: (contact, topicId) =>
      preferences.shouldSendToContact({ contactId: contact.id, orgId, topicId }),
    checkFrequency: (contact, topicId) => frequency.isWithinFrequencyCap(orgId, contact.id, topicId),
    checkSender: options.checkSender ?? (async () => ({ allowed: true })),
    checkPolicy: options.checkPolicy,
  })
}
