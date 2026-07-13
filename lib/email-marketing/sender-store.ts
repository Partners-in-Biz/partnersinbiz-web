import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type {
  EmailSenderIdentity,
  EmailSenderPolicy,
  NoOwnerBehavior,
  SenderHealthStatus,
  SenderMode,
  SenderPurpose,
  SenderStrategy,
  SenderVerificationStatus,
} from '@/lib/email-marketing/sender-types'

const IDENTITY_COLLECTION = 'email_sender_identities'
const POLICY_COLLECTION = 'email_sender_policies'
const PURPOSES: SenderPurpose[] = ['marketing_bulk', 'lifecycle', 'sales_1to1', 'transactional']
const STRATEGIES: SenderStrategy[] = ['organisation_default', 'fixed_identity', 'campaign_creator', 'contact_owner', 'company_account_manager', 'deal_owner', 'round_robin_pool']
const NO_OWNER: NoOwnerBehavior[] = ['exclude', 'fallback', 'block']

class SenderStoreError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableString(value: unknown): string | null {
  const cleaned = cleanString(value)
  return cleaned || null
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(cleanString).filter(Boolean))) : []
}

function mapIdentity(id: string, data: Record<string, unknown>): EmailSenderIdentity {
  return { id, ...data } as unknown as EmailSenderIdentity
}

function mapPolicy(id: string, data: Record<string, unknown>): EmailSenderPolicy {
  return { id, ...data } as unknown as EmailSenderPolicy
}

async function assertIdentityReferences(orgId: string, value: Record<string, unknown>): Promise<SenderVerificationStatus> {
  const mode = value.mode as SenderMode
  const ownerUid = value.ownerUid as string | null
  const emailAddress = value.emailAddress as string
  if (ownerUid) {
    const member = await adminDb.collection('orgMembers').doc(`${orgId}_${ownerUid}`).get()
    const data = member.data() ?? {}
    if (!member.exists || data.disabled || data.deletedAt || (data.status && !['active', 'enabled'].includes(data.status))) {
      throw new SenderStoreError('Sender owner must be an active member of the organisation')
    }
  }
  for (const delegatedUid of value.delegatedActorUids as string[]) {
    const member = await adminDb.collection('orgMembers').doc(`${orgId}_${delegatedUid}`).get()
    if (!member.exists) throw new SenderStoreError('Every delegated actor must be a member of the organisation')
  }

  if (mode === 'esp_domain') {
    const domainId = value.domainId as string | null
    if (!domainId) throw new SenderStoreError('domainId is required for ESP domain identities')
    const domain = await adminDb.collection('email_domains').doc(domainId).get()
    const data = domain.data() ?? {}
    if (!domain.exists || data.orgId !== orgId || data.deleted) throw new SenderStoreError('Sending domain not found')
    const emailDomain = emailAddress.split('@')[1]?.toLowerCase()
    if (cleanString(data.name).toLowerCase() !== emailDomain) throw new SenderStoreError('Identity email must use the selected sending domain')
    return data.status === 'verified' ? 'verified' : 'pending'
  }

  const mailboxAccountId = value.mailboxAccountId as string | null
  if (!mailboxAccountId || !ownerUid) throw new SenderStoreError('Connected mailbox identities require mailboxAccountId and ownerUid')
  const mailbox = await adminDb.collection('mailbox_accounts').doc(mailboxAccountId).get()
  const data = mailbox.data() ?? {}
  if (!mailbox.exists || data.orgId !== orgId || data.uid !== ownerUid || data.deletedAt) throw new SenderStoreError('Connected mailbox is not authorised for this sender')
  if (cleanString(data.emailAddress).toLowerCase() !== emailAddress.toLowerCase()) throw new SenderStoreError('Identity email must match the connected mailbox')
  return data.status === 'connected' ? 'verified' : 'pending'
}

function normalizeIdentity(input: Record<string, unknown>, existing?: EmailSenderIdentity): Record<string, unknown> {
  const mode: SenderMode = input.mode === undefined && existing ? existing.mode : input.mode === 'connected_mailbox' ? 'connected_mailbox' : 'esp_domain'
  const displayName = input.displayName === undefined && existing ? existing.displayName : cleanString(input.displayName)
  const emailAddress = (input.emailAddress === undefined && existing ? existing.emailAddress : cleanString(input.emailAddress)).toLowerCase()
  if (!displayName) throw new SenderStoreError('displayName is required')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new SenderStoreError('A valid emailAddress is required')
  const purposes = input.purposes === undefined && existing ? existing.purposes : uniqueStrings(input.purposes).filter((item): item is SenderPurpose => PURPOSES.includes(item as SenderPurpose))
  if (purposes.length === 0) throw new SenderStoreError('At least one valid purpose is required')
  if (mode === 'connected_mailbox' && purposes.some((purpose) => purpose !== 'sales_1to1')) {
    throw new SenderStoreError('Connected mailbox identities may only be used for sales_1to1')
  }
  const localPart = emailAddress.split('@')[0]
  const healthStatus = (input.healthStatus === undefined && existing ? existing.healthStatus : input.healthStatus) as SenderHealthStatus
  const quotaInput = input.quota === undefined && existing ? existing.quota : input.quota
  const quota = quotaInput && typeof quotaInput === 'object'
    ? {
        dailyLimit: Math.max(0, Math.floor(Number((quotaInput as Record<string, unknown>).dailyLimit) || 0)),
        sentToday: Math.max(0, Math.floor(Number((quotaInput as Record<string, unknown>).sentToday) || 0)),
      }
    : null
  return {
    displayName,
    emailAddress,
    localPart,
    replyTo: input.replyTo === undefined && existing ? existing.replyTo ?? null : nullableString(input.replyTo),
    ownerUid: input.ownerUid === undefined && existing ? existing.ownerUid : nullableString(input.ownerUid),
    domainId: mode === 'esp_domain' ? (input.domainId === undefined && existing ? existing.domainId : nullableString(input.domainId)) : null,
    mailboxAccountId: mode === 'connected_mailbox' ? (input.mailboxAccountId === undefined && existing ? existing.mailboxAccountId : nullableString(input.mailboxAccountId)) : null,
    mode,
    purposes,
    enabled: input.enabled === undefined ? existing?.enabled ?? true : input.enabled === true,
    isDefault: input.isDefault === undefined ? existing?.isDefault ?? false : input.isDefault === true,
    delegatedActorUids: input.delegatedActorUids === undefined && existing ? existing.delegatedActorUids : uniqueStrings(input.delegatedActorUids),
    signatureTemplateId: input.signatureTemplateId === undefined && existing ? existing.signatureTemplateId ?? null : nullableString(input.signatureTemplateId),
    healthStatus: ['healthy', 'warning', 'blocked'].includes(healthStatus) ? healthStatus : 'healthy',
    quota,
  }
}

export async function listSenderIdentities(orgId: string): Promise<EmailSenderIdentity[]> {
  const snap = await adminDb.collection(IDENTITY_COLLECTION).where('orgId', '==', orgId).get()
  return snap.docs.map((doc) => mapIdentity(doc.id, doc.data())).filter((item) => !item.deleted).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))
}

export async function getSenderIdentity(orgId: string, id: string): Promise<EmailSenderIdentity | null> {
  const snap = await adminDb.collection(IDENTITY_COLLECTION).doc(id).get()
  if (!snap.exists) return null
  const identity = mapIdentity(snap.id, snap.data() ?? {})
  return identity.orgId === orgId && !identity.deleted ? identity : null
}

export async function createSenderIdentity(orgId: string, input: Record<string, unknown>, actorUid: string): Promise<EmailSenderIdentity> {
  const normalized = normalizeIdentity(input)
  const verificationStatus = await assertIdentityReferences(orgId, normalized)
  const ref = adminDb.collection(IDENTITY_COLLECTION).doc()
  const payload = {
    ...normalized,
    orgId,
    verificationStatus,
    deleted: false,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  await ref.set(payload)
  return mapIdentity(ref.id, payload)
}

export async function updateSenderIdentity(orgId: string, id: string, input: Record<string, unknown>, actorUid: string): Promise<EmailSenderIdentity | null> {
  const existing = await getSenderIdentity(orgId, id)
  if (!existing) return null
  const normalized = normalizeIdentity(input, existing)
  const verificationStatus = await assertIdentityReferences(orgId, normalized)
  const patch = { ...normalized, verificationStatus, updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp() }
  await adminDb.collection(IDENTITY_COLLECTION).doc(id).update(patch)
  return { ...existing, ...patch }
}

export async function deleteSenderIdentity(orgId: string, id: string, actorUid: string): Promise<boolean> {
  const existing = await getSenderIdentity(orgId, id)
  if (!existing) return false
  await adminDb.collection(IDENTITY_COLLECTION).doc(id).update({ deleted: true, enabled: false, updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp() })
  return true
}

export function normalizeSenderPolicy(input: Record<string, unknown>, orgId: string, existing?: EmailSenderPolicy): Omit<EmailSenderPolicy, 'createdAt' | 'updatedAt'> {
  const strategy = (input.strategy === undefined && existing ? existing.strategy : input.strategy) as SenderStrategy
  const purpose = (input.purpose === undefined && existing ? existing.purpose : input.purpose) as SenderPurpose
  const noOwnerBehavior = (input.noOwnerBehavior === undefined && existing ? existing.noOwnerBehavior : input.noOwnerBehavior) as NoOwnerBehavior
  const name = input.name === undefined && existing ? existing.name : cleanString(input.name)
  if (!name) throw new SenderStoreError('name is required')
  if (!STRATEGIES.includes(strategy)) throw new SenderStoreError('A valid strategy is required')
  if (!PURPOSES.includes(purpose)) throw new SenderStoreError('A valid purpose is required')
  if (!NO_OWNER.includes(noOwnerBehavior)) throw new SenderStoreError('A valid noOwnerBehavior is required')
  const fallbackIdentityId = input.fallbackIdentityId === undefined && existing ? existing.fallbackIdentityId : nullableString(input.fallbackIdentityId)
  if (noOwnerBehavior === 'fallback' && !fallbackIdentityId) throw new SenderStoreError('fallbackIdentityId is required when noOwnerBehavior is fallback')
  const allowConnectedMailbox = input.allowConnectedMailbox === undefined ? existing?.allowConnectedMailbox ?? false : input.allowConnectedMailbox === true
  if (allowConnectedMailbox && purpose !== 'sales_1to1') throw new SenderStoreError('Connected mailbox mode is only permitted for sales_1to1')
  return {
    id: existing?.id ?? (cleanString(input.id) || 'preview'),
    orgId,
    name,
    strategy,
    purpose,
    defaultIdentityId: input.defaultIdentityId === undefined && existing ? existing.defaultIdentityId : nullableString(input.defaultIdentityId),
    fixedIdentityId: input.fixedIdentityId === undefined && existing ? existing.fixedIdentityId : nullableString(input.fixedIdentityId),
    fallbackIdentityId,
    roundRobinIdentityIds: input.roundRobinIdentityIds === undefined && existing ? existing.roundRobinIdentityIds : uniqueStrings(input.roundRobinIdentityIds),
    noOwnerBehavior,
    allowConnectedMailbox,
    connectedMailboxMaxRecipients: Math.max(1, Math.min(50, Math.floor(Number(input.connectedMailboxMaxRecipients ?? existing?.connectedMailboxMaxRecipients ?? 1) || 1))),
    enabled: input.enabled === undefined ? existing?.enabled ?? true : input.enabled === true,
    deleted: false,
  }
}

async function assertPolicyIdentityRefs(orgId: string, policy: Omit<EmailSenderPolicy, 'createdAt' | 'updatedAt'>): Promise<void> {
  const ids = Array.from(new Set([policy.defaultIdentityId, policy.fixedIdentityId, policy.fallbackIdentityId, ...policy.roundRobinIdentityIds].filter((id): id is string => Boolean(id))))
  const identities = await Promise.all(ids.map((id) => getSenderIdentity(orgId, id)))
  if (identities.some((identity) => !identity)) throw new SenderStoreError('Every policy identity must be an enabled same-organisation identity')
  if (identities.some((identity) => !identity!.enabled || identity!.verificationStatus !== 'verified')) throw new SenderStoreError('Every policy identity must be verified and enabled')
  if (policy.strategy === 'fixed_identity' && !policy.fixedIdentityId) throw new SenderStoreError('fixedIdentityId is required for fixed_identity')
  if (policy.strategy === 'round_robin_pool' && policy.roundRobinIdentityIds.length === 0) throw new SenderStoreError('roundRobinIdentityIds is required for round_robin_pool')
}

export async function listSenderPolicies(orgId: string): Promise<EmailSenderPolicy[]> {
  const snap = await adminDb.collection(POLICY_COLLECTION).where('orgId', '==', orgId).get()
  return snap.docs.map((doc) => mapPolicy(doc.id, doc.data())).filter((item) => !item.deleted).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export async function getSenderPolicy(orgId: string, id: string): Promise<EmailSenderPolicy | null> {
  const snap = await adminDb.collection(POLICY_COLLECTION).doc(id).get()
  if (!snap.exists) return null
  const policy = mapPolicy(snap.id, snap.data() ?? {})
  return policy.orgId === orgId && !policy.deleted ? policy : null
}

export async function createSenderPolicy(orgId: string, input: Record<string, unknown>, actorUid: string): Promise<EmailSenderPolicy> {
  const normalized = normalizeSenderPolicy(input, orgId)
  await assertPolicyIdentityRefs(orgId, normalized)
  const ref = adminDb.collection(POLICY_COLLECTION).doc()
  const payload = { ...normalized, id: undefined, createdBy: actorUid, updatedBy: actorUid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
  const sanitized = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
  await ref.set(sanitized)
  return mapPolicy(ref.id, sanitized)
}

export async function updateSenderPolicy(orgId: string, id: string, input: Record<string, unknown>, actorUid: string): Promise<EmailSenderPolicy | null> {
  const existing = await getSenderPolicy(orgId, id)
  if (!existing) return null
  const normalized = normalizeSenderPolicy(input, orgId, existing)
  await assertPolicyIdentityRefs(orgId, normalized)
  const patch = { ...normalized, id: undefined, updatedBy: actorUid, updatedAt: FieldValue.serverTimestamp() }
  const sanitized = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  await adminDb.collection(POLICY_COLLECTION).doc(id).update(sanitized)
  return { ...existing, ...normalized, id }
}
