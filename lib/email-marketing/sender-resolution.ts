import { adminDb } from '@/lib/firebase/admin'
import { listSenderIdentities } from '@/lib/email-marketing/sender-store'
import type {
  EmailSenderIdentity,
  SenderIdentitySnapshot,
  SenderResolution,
  SenderResolutionDependencies,
  SenderResolutionInput,
  SenderResolutionReason,
  SenderStrategy,
} from '@/lib/email-marketing/sender-types'

function snapshot(identity: EmailSenderIdentity): SenderIdentitySnapshot {
  return {
    id: identity.id,
    ownerUid: identity.ownerUid,
    displayName: identity.displayName,
    emailAddress: identity.emailAddress,
    replyTo: identity.replyTo ?? null,
    mode: identity.mode,
    domainId: identity.domainId,
    mailboxAccountId: identity.mailboxAccountId,
  }
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % length
}

function unresolved(
  input: SenderResolutionInput,
  reason: SenderResolutionReason,
  source: SenderStrategy | 'fallback',
): SenderResolution {
  return {
    status: input.policy.noOwnerBehavior === 'exclude' ? 'excluded' : 'blocked',
    identity: null,
    policyId: input.policy.id,
    purpose: input.policy.purpose,
    resolutionSource: source,
    ownerUid: null,
    reason,
    fallbackReason: null,
  }
}

function ownerForStrategy(input: SenderResolutionInput): { uid: string | null; missingReason: SenderResolutionReason } {
  switch (input.policy.strategy) {
    case 'campaign_creator':
      return { uid: input.campaignCreatorUid?.trim() || null, missingReason: 'no_campaign_creator' }
    case 'contact_owner':
      return { uid: input.recipient.contactOwnerUid?.trim() || null, missingReason: 'no_contact_owner' }
    case 'company_account_manager':
      return { uid: input.recipient.companyAccountManagerUid?.trim() || null, missingReason: 'no_company_account_manager' }
    case 'deal_owner':
      return { uid: input.recipient.dealOwnerUid?.trim() || null, missingReason: 'no_deal_owner' }
    default:
      return { uid: null, missingReason: 'identity_not_found' }
  }
}

function isActiveMember(member: Awaited<ReturnType<SenderResolutionDependencies['getMember']>>): boolean {
  if (!member || member.disabled || member.deletedAt) return false
  return !member.status || member.status === 'active' || member.status === 'enabled'
}

async function identityIneligibility(
  identity: EmailSenderIdentity,
  input: SenderResolutionInput,
  deps: SenderResolutionDependencies,
): Promise<SenderResolutionReason | null> {
  if (identity.orgId !== input.orgId) return 'identity_cross_org'
  if (identity.deleted || !identity.enabled) return 'identity_disabled'
  if (identity.verificationStatus !== 'verified') return 'identity_unverified'
  if (identity.healthStatus === 'blocked') return 'identity_unhealthy'
  if (identity.quota && identity.quota.dailyLimit > 0 && identity.quota.sentToday >= identity.quota.dailyLimit) return 'identity_over_quota'
  if (!identity.purposes.includes(input.policy.purpose)) return 'identity_purpose_not_allowed'

  if (identity.ownerUid) {
    const owner = await deps.getMember(identity.ownerUid, input.orgId)
    if (!isActiveMember(owner) || (owner?.orgId && owner.orgId !== input.orgId)) return 'identity_owner_not_member'

    if (input.actorUid !== identity.ownerUid && input.policy.strategy === 'fixed_identity') {
      const actor = await deps.getMember(input.actorUid, input.orgId)
      const actorIsManager = isActiveMember(actor) && actor?.orgId === input.orgId && ['owner', 'admin'].includes(actor.role ?? '')
      if (!actorIsManager && !identity.delegatedActorUids.includes(input.actorUid)) return 'identity_not_delegated'
    }
  }

  if (identity.mode === 'esp_domain') {
    if (!identity.domainId) return 'identity_domain_unverified'
    const domain = await deps.getDomain(identity.domainId)
    if (!domain || domain.orgId !== input.orgId || domain.deleted || domain.status !== 'verified') return 'identity_domain_unverified'
    return null
  }

  if (
    input.policy.purpose !== 'sales_1to1' ||
    !input.policy.allowConnectedMailbox ||
    input.batchSize > input.policy.connectedMailboxMaxRecipients
  ) return 'identity_mode_not_allowed'

  if (!identity.mailboxAccountId || !identity.ownerUid) return 'identity_mailbox_unauthorised'
  const mailbox = await deps.getMailbox(identity.mailboxAccountId)
  if (
    !mailbox || mailbox.orgId !== input.orgId || mailbox.uid !== identity.ownerUid ||
    mailbox.status !== 'connected' || mailbox.deletedAt ||
    mailbox.emailAddress?.trim().toLowerCase() !== identity.emailAddress.trim().toLowerCase()
  ) return 'identity_mailbox_unauthorised'
  return null
}

async function resolveCandidate(
  identity: EmailSenderIdentity | undefined,
  input: SenderResolutionInput,
  deps: SenderResolutionDependencies,
  source: SenderStrategy | 'fallback',
  ownerUid: string | null,
): Promise<{ result: SenderResolution | null; reason: SenderResolutionReason }> {
  if (!identity) return { result: null, reason: 'identity_not_found' }
  const reason = await identityIneligibility(identity, input, deps)
  if (reason) return { result: null, reason }
  return {
    reason: 'identity_not_found',
    result: {
      status: 'resolved',
      identity: snapshot(identity),
      policyId: input.policy.id,
      purpose: input.policy.purpose,
      resolutionSource: source,
      ownerUid,
      reason: null,
      fallbackReason: null,
    },
  }
}

async function applyFallback(
  input: SenderResolutionInput,
  deps: SenderResolutionDependencies,
  identities: EmailSenderIdentity[],
  fallbackReason: SenderResolutionReason,
): Promise<SenderResolution> {
  if (input.policy.noOwnerBehavior !== 'fallback') return unresolved(input, fallbackReason, input.policy.strategy)
  const fallback = identities.find((item) => item.id === input.policy.fallbackIdentityId)
  const attempt = await resolveCandidate(fallback, input, deps, 'fallback', fallback?.ownerUid ?? null)
  if (!attempt.result) {
    return {
      ...unresolved({ ...input, policy: { ...input.policy, noOwnerBehavior: 'block' } }, 'fallback_identity_unavailable', 'fallback'),
      fallbackReason,
    }
  }
  return { ...attempt.result, fallbackReason }
}

export async function resolveSenderForRecipient(
  input: SenderResolutionInput,
  dependencies: SenderResolutionDependencies = defaultDependencies,
): Promise<SenderResolution> {
  if (input.policy.orgId !== input.orgId || !input.policy.enabled) return unresolved(input, 'policy_disabled', input.policy.strategy)
  const identities = await dependencies.listIdentities(input.orgId)
  const policy = input.policy

  if (policy.strategy === 'round_robin_pool') {
    const pool = Array.from(new Set(policy.roundRobinIdentityIds)).sort()
    if (pool.length === 0) return applyFallback(input, dependencies, identities, 'round_robin_pool_empty')
    const start = stableIndex(`${input.orgId}:${policy.id}:${input.recipient.contactId}`, pool.length)
    let lastReason: SenderResolutionReason = 'round_robin_pool_empty'
    for (let offset = 0; offset < pool.length; offset += 1) {
      const id = pool[(start + offset) % pool.length]
      const candidate = identities.find((item) => item.id === id)
      const attempt = await resolveCandidate(candidate, input, dependencies, policy.strategy, candidate?.ownerUid ?? null)
      if (attempt.result) return attempt.result
      lastReason = attempt.reason
    }
    return applyFallback(input, dependencies, identities, lastReason)
  }

  if (['campaign_creator', 'contact_owner', 'company_account_manager', 'deal_owner'].includes(policy.strategy)) {
    const { uid, missingReason } = ownerForStrategy(input)
    if (!uid) return applyFallback(input, dependencies, identities, missingReason)
    const owned = identities.filter((item) => item.ownerUid === uid).sort((a, b) => a.id.localeCompare(b.id))
    for (const candidate of owned) {
      const attempt = await resolveCandidate(candidate, input, dependencies, policy.strategy, uid)
      if (attempt.result) return attempt.result
    }
    return applyFallback(input, dependencies, identities, 'owner_identity_unavailable')
  }

  const candidateId = policy.strategy === 'fixed_identity' ? policy.fixedIdentityId : policy.defaultIdentityId
  const candidate = candidateId
    ? identities.find((item) => item.id === candidateId)
    : identities.find((item) => item.isDefault)
  const attempt = await resolveCandidate(candidate, input, dependencies, policy.strategy, candidate?.ownerUid ?? null)
  if (attempt.result) return attempt.result
  return applyFallback(input, dependencies, identities, attempt.reason)
}

const defaultDependencies: SenderResolutionDependencies = {
  listIdentities: listSenderIdentities,
  async getDomain(id) {
    const snap = await adminDb.collection('email_domains').doc(id).get()
    return snap.exists ? (snap.data() as { orgId: string; status?: string; deleted?: boolean; name?: string }) : null
  },
  async getMailbox(id) {
    const snap = await adminDb.collection('mailbox_accounts').doc(id).get()
    return snap.exists ? (snap.data() as { orgId: string; uid: string; status?: string; emailAddress?: string; deletedAt?: unknown }) : null
  },
  async getMember(uid, orgId) {
    if (!orgId) return null
    const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    return snap.exists ? (snap.data() as { orgId?: string; role?: string; status?: string; disabled?: boolean; deletedAt?: unknown }) : null
  },
}
