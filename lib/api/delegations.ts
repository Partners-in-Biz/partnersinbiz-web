import { createHash, randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'

import type { ApiRole, ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { resolveMemberAccessPolicy, type MemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import {
  ORGANIZATION_MODULE_POLICY_KEYS,
  resolveOrganizationModulePolicies,
  canRolePerformModuleAction,
} from '@/lib/organizations/module-policies'
import { resolveOrganizationPolicyRole } from '@/lib/organizations/module-policy-access'
import type { OrgRole } from '@/lib/organizations/types'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'
import { pibStaffCanServeClientOrg } from '@/lib/auth/staff-client-org'
import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'
import { canAccessConversation } from '@/lib/conversations/access'
import type { Conversation } from '@/lib/conversations/types'
import {
  CHAT_REMINT_RITUAL_PATTERNS,
  containsChatRemintRitual,
  redactDelegationSecretsFromText,
} from '@/lib/api/delegation-text'

export {
  CHAT_REMINT_RITUAL_PATTERNS,
  containsChatRemintRitual,
  redactDelegationSecretsFromText,
}

const DELEGATION_COLLECTION = 'agent_delegations'
const DELEGATION_PREFIX = 'pib_dlg_'
const DEFAULT_TTL_SECONDS = 3600
const MAX_TTL_SECONDS = 24 * 60 * 60

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function conversationFromSnap(id: string, data: Record<string, unknown>): Conversation {
  const participantUids = Array.isArray(data.participantUids)
    ? data.participantUids.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : []
  const participantAgentIds = Array.isArray(data.participantAgentIds)
    ? data.participantAgentIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : []
  return {
    id,
    orgId: normalizeText(data.orgId),
    participantUids,
    participantAgentIds,
    participants: Array.isArray(data.participants) ? data.participants as Conversation['participants'] : [],
    startedBy: typeof data.startedBy === 'string' ? data.startedBy : '',
    title: typeof data.title === 'string' ? data.title : '',
    messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
    archived: data.archived === true,
    workspaceContext: data.workspaceContext && typeof data.workspaceContext === 'object'
      ? data.workspaceContext as Conversation['workspaceContext']
      : undefined,
  } as Conversation
}

/** A conversationId only authorises staff mint when the thread exists, matches orgId, and the caller can access it. */
async function conversationAuthorizesStaffMint(
  user: ApiUser,
  orgId: string,
  conversationId: string,
): Promise<boolean> {
  if (!conversationId) return false
  const snap = await adminDb.collection('conversations').doc(conversationId).get()
  if (!snap.exists) return false
  const conversation = conversationFromSnap(snap.id, (snap.data() ?? {}) as Record<string, unknown>)
  if (!conversation.orgId || conversation.orgId !== orgId) return false
  return canAccessConversation(user, conversation)
}

function timestampToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'object') {
    const source = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof source.toDate === 'function') {
      try { return source.toDate().getTime() } catch { return null }
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isMemberAccessPolicy(value: unknown): value is MemberAccessPolicy {
  if (!isRecord(value)) return false
  return typeof value.preset === 'string'
    && isRecord(value.modules)
    && isRecord(value.recordScopes)
    && isRecord(value.agentRuntimeAccess)
    && typeof value.allowPersonalLlmOnOrgVps === 'boolean'
    && isRecord(value.capabilities)
}

function memberAccessPolicyFromUnknown(value: unknown): MemberAccessPolicy | undefined {
  return isMemberAccessPolicy(value) ? value : undefined
}

async function loadMemberAccessPolicy(uid: string, orgId: string) {
  try {
    const memberDoc = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
    if (!memberDoc.exists) return undefined
    const data = memberDoc.data() ?? {}
    if (!isActiveOrgMembershipRow(data)) return undefined
    return resolveMemberAccessPolicy({
      role: (data.role as OrgRole | undefined) ?? 'viewer',
      accessScope: data.accessScope,
      accessPolicy: data.accessPolicy,
    })
  } catch {
    return undefined
  }
}

function delegationScope(moduleKey: string, actionId: string) {
  return `${moduleKey}:${actionId}`
}

async function buildDelegationScopes(user: ApiUser, orgId: string): Promise<string[]> {
  const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgDoc.exists) return []
  const orgData = orgDoc.data() ?? {}
  const policies = resolveOrganizationModulePolicies((orgData as { settings?: unknown }).settings)
  const role = user.role === 'client'
    ? await resolveOrganizationPolicyRole(orgId, user.uid, orgData)
    : 'admin'

  const scopes = new Set<string>()
  for (const moduleKey of ORGANIZATION_MODULE_POLICY_KEYS) {
    for (const actionId of Object.keys(policies[moduleKey]?.actions ?? {})) {
      if (canRolePerformModuleAction(policies, moduleKey, actionId, role)) {
        scopes.add(delegationScope(moduleKey, actionId))
      }
    }
  }
  return Array.from(scopes).sort()
}

export type MintedDelegation = {
  id: string
  token: string
  expiresAt: string
  actingForUserId: string
  agentId: string
  orgIds: string[]
  scopes: string[]
  mailboxDelegationEvidenceId?: string
  issuerOrgId?: string
}

export async function mintAgentDelegation(input: {
  user: ApiUser
  orgId: string
  agentId: string
  purpose: string
  ttlSeconds?: number
  conversationId?: string
}): Promise<MintedDelegation> {
  const orgId = normalizeText(input.orgId)
  const agentId = normalizeText(input.agentId)
  const purpose = normalizeText(input.purpose)
  if (!orgId) throw Object.assign(new Error('orgId is required'), { status: 400 })
  if (!agentId) throw Object.assign(new Error('agentId is required'), { status: 400 })
  if (!purpose) throw Object.assign(new Error('purpose is required'), { status: 400 })
  if (input.user.role === 'ai') throw Object.assign(new Error('AI/system users cannot mint delegations'), { status: 403 })
  const staff = await loadPlatformStaffMembership(input.user.uid)
  const conversationId = normalizeText(input.conversationId)
  const conversationAuthorizes = conversationId
    ? await conversationAuthorizesStaffMint(input.user, orgId, conversationId)
    : false
  const staffServesClient = Boolean(
    staff
    && orgId !== staff.platformOrgId
    && (conversationAuthorizes || await pibStaffCanServeClientOrg(input.user, orgId)),
  )
  if (!canAccessOrg(input.user, orgId) && !staffServesClient) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }

  const ttlSeconds = Math.min(Math.max(Math.trunc(input.ttlSeconds ?? DEFAULT_TTL_SECONDS), 60), MAX_TTL_SECONDS)
  const token = `${DELEGATION_PREFIX}${randomBytes(24).toString('hex')}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const orgIds = staff && orgId !== staff.platformOrgId
    ? Array.from(new Set([orgId, staff.platformOrgId]))
    : [orgId]
  const conversationScopes = await buildDelegationScopes(input.user, orgId)
  const staffScopes = staff && orgId !== staff.platformOrgId
    ? await buildDelegationScopes(input.user, staff.platformOrgId)
    : []
  const scopes = Array.from(new Set([...conversationScopes, ...staffScopes])).sort()
  const conversationPolicy = await loadMemberAccessPolicy(input.user.uid, orgId)
  const memberAccessPolicy = staff?.policy ?? conversationPolicy
  const ref = adminDb.collection(DELEGATION_COLLECTION).doc()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  await ref.set({
    tokenHash,
    tokenPrefix: token.slice(0, 16),
    actingForUserId: input.user.uid,
    agentId,
    role: input.user.role,
    orgId,
    activeOrgId: orgId,
    orgIds,
    issuerOrgId: staff?.platformOrgId ?? null,
    allowedOrgIds: input.user.allowedOrgIds ?? null,
    memberAccessPolicy: memberAccessPolicy ?? null,
    scopes,
    purpose,
    conversationId: normalizeText(input.conversationId) || null,
    status: 'active',
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.user.uid,
    createdByType: 'user',
    lastUsedAt: null,
  })

  // Parallel mailbox evidence so agent/system keys can still call /agent/email/*
  // when Messages also injects the user-delegation Bearer token (preferred).
  // PiB staff mailboxes live on the platform org even when the chat is a client workspace.
  const mailboxOrgId = staff?.platformOrgId ?? orgId
  const mailboxRef = adminDb.collection('mailbox_agent_delegations').doc()
  await mailboxRef.set({
    orgId: mailboxOrgId,
    uid: input.user.uid,
    delegatedUid: input.user.uid,
    agentId,
    actorId: `agent:${agentId}`,
    actionClasses: ['read', 'draft'],
    status: 'active',
    purpose,
    conversationId: normalizeText(input.conversationId) || null,
    conversationOrgId: orgId !== mailboxOrgId ? orgId : null,
    sourceDelegationId: ref.id,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.user.uid,
  })

  return {
    id: ref.id,
    token,
    expiresAt,
    actingForUserId: input.user.uid,
    agentId,
    orgIds,
    scopes,
    mailboxDelegationEvidenceId: mailboxRef.id,
    issuerOrgId: staff?.platformOrgId,
  }
}

export async function lookupDelegationRecordByToken(rawToken: string): Promise<{
  id: string
  data: Record<string, unknown>
  expired: boolean
  revoked: boolean
  ref: { update: (data: Record<string, unknown>) => Promise<unknown> }
} | null> {
  if (!rawToken || !rawToken.startsWith(DELEGATION_PREFIX)) return null
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  try {
    const snap = await adminDb.collection(DELEGATION_COLLECTION).where('tokenHash', '==', tokenHash).limit(1).get()
    if (snap.empty || snap.docs.length === 0) return null
    const doc = snap.docs[0]
    const data = (doc.data() ?? {}) as Record<string, unknown>
    const revoked = Boolean(data.revokedAt) || normalizeText(data.status) === 'revoked'
    const expiresAt = timestampToMillis(data.expiresAt)
    const expired = expiresAt !== null && expiresAt <= Date.now()
    return { id: doc.id, data, expired, revoked, ref: doc.ref }
  } catch {
    return null
  }
}

export function actingUserFromDelegationRecord(data: Record<string, unknown>): ApiUser | null {
  const actingForUserId = normalizeText(data.actingForUserId)
  const role = normalizeText(data.role)
  const validRole: ApiRole = role === 'admin' || role === 'client' ? role : 'client'
  const orgId = normalizeText(data.orgId)
  if (!actingForUserId || !orgId) return null
  const orgIds = cleanStringArray(data.orgIds)
  const allowedOrgIds = cleanStringArray(data.allowedOrgIds)
  return {
    uid: actingForUserId,
    role: validRole,
    authKind: 'session',
    orgId,
    activeOrgId: normalizeText(data.activeOrgId) || orgId,
    orgIds: orgIds.length > 0 ? orgIds : [orgId],
    allowedOrgIds: allowedOrgIds.length > 0 ? allowedOrgIds : undefined,
    memberAccessPolicy: memberAccessPolicyFromUnknown(data.memberAccessPolicy),
  }
}

/**
 * Re-mint a Messages-purpose delegation from an expired (or otherwise unusable)
 * pib_dlg_ token. Uses the same system-auth mint path. Never returns AI_API_KEY.
 */
export async function remintExpiredMessagesDelegation(rawToken: string): Promise<MintedDelegation | null> {
  const record = await lookupDelegationRecordByToken(rawToken)
  if (!record || record.revoked) return null
  const purpose = normalizeText(record.data.purpose)
  if (!purpose.startsWith('messages:')) return null
  const user = actingUserFromDelegationRecord(record.data)
  const agentId = normalizeText(record.data.agentId)
  const orgId = normalizeText(record.data.orgId)
  const conversationId = normalizeText(record.data.conversationId) || purpose.slice('messages:'.length)
  if (!user || !agentId || !orgId) return null
  try {
    return await mintAgentDelegation({
      user,
      orgId,
      agentId,
      purpose,
      conversationId,
    })
  } catch (error) {
    console.error('[delegation-remint-messages-failed]', {
      conversationId,
      agentId,
      orgId,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function resolveDelegationTokenUser(rawToken: string): Promise<ApiUser | null> {
  if (!rawToken || !rawToken.startsWith(DELEGATION_PREFIX)) return null
  try {
    const record = await lookupDelegationRecordByToken(rawToken)
    if (!record) return null
    const data = record.data
    if (normalizeText(data.status) !== 'active' || record.revoked || record.expired) return null

    try {
      await record.ref.update({ lastUsedAt: FieldValue.serverTimestamp() })
    } catch {
      // Non-fatal telemetry.
    }

    const actingForUserId = normalizeText(data.actingForUserId)
    const role = normalizeText(data.role)
    const validRole: ApiRole = role === 'admin' || role === 'client' ? role : 'client'
    const orgId = normalizeText(data.orgId)
    const activeOrgId = normalizeText(data.activeOrgId) || orgId || undefined
    const orgIds = cleanStringArray(data.orgIds)
    const allowedOrgIds = cleanStringArray(data.allowedOrgIds)
    const scopes = cleanStringArray(data.scopes)
    const agentId = normalizeText(data.agentId) || undefined

    if (!actingForUserId || !agentId) return null

    return {
      uid: actingForUserId,
      role: validRole,
      authKind: 'user_delegation',
      agentId,
      delegationId: record.id,
      actingForUserId,
      delegationScopes: scopes,
      orgId: orgId || undefined,
      activeOrgId,
      orgIds: orgIds.length > 0 ? orgIds : (activeOrgId ? [activeOrgId] : undefined),
      allowedOrgIds: allowedOrgIds.length > 0 ? allowedOrgIds : undefined,
      memberAccessPolicy: memberAccessPolicyFromUnknown(data.memberAccessPolicy),
    }
  } catch {
    return null
  }
}

/** Resolve a pib_dlg_ bearer, reminting an expired Messages token once. Never falls through to AI_API_KEY. */
export async function resolveDelegationBearerUser(rawToken: string): Promise<ApiUser | null> {
  if (!rawToken.startsWith(DELEGATION_PREFIX)) return null
  const live = await resolveDelegationTokenUser(rawToken)
  if (live) return live
  const reminted = await remintExpiredMessagesDelegation(rawToken)
  if (!reminted?.token) return null
  return resolveDelegationTokenUser(reminted.token)
}

/** Prompt block injected into Messages → Hermes / linked-computer runs. */
export function buildDelegationAuthPromptBlock(input: {
  token: string
  expiresAt: string
  orgId: string
  agentId: string
  actingForUserId: string
  scopes: string[]
  apiBaseUrl?: string
  mailboxDelegationEvidenceId?: string
  orgIds?: string[]
  issuerOrgId?: string
}): string {
  const apiBase = (input.apiBaseUrl || 'https://partnersinbiz.online').replace(/\/+$/, '')
  const scopeLine = input.scopes.length > 0
    ? input.scopes.join(', ')
    : '(org module policy — none explicitly listed)'
  const extraOrgIds = (input.orgIds ?? []).filter((id) => id && id !== input.orgId)
  const issuerOrgId = input.issuerOrgId?.trim() || ''
  const mailboxLines = input.mailboxDelegationEvidenceId
    ? [
      `Mailbox delegationEvidenceId for /api/v1/agent/email/* (if using an agent/system key): ${input.mailboxDelegationEvidenceId}`,
      'Prefer the user-delegation Bearer token above for mailbox reads/drafts; it already authorises the acting user.',
    ]
    : [
      'For connected mailbox reads/drafts, call /api/v1/agent/email/* with this same user-delegation Bearer token and the acting user uid.',
    ]
  const staffBillingLines = issuerOrgId && issuerOrgId !== input.orgId
    ? [
      `This human is Partners in Biz staff. Conversation org is ${input.orgId}. PiB home/issuer org is ${issuerOrgId}.`,
      'Server remaps these onto the platform org when the chat passes the conversation orgId: CRM companies/contacts, invoice/quote create+issuer list, and /api/v1/agent/email/* mailbox.',
      'For PiB invoices/quotes for this customer, POST orgId as the conversation/client org (or companyId on platform CRM). Prefer orgId=' + issuerOrgId + ' when listing issuer invoices/quotes or reading mailbox.',
      'Client Cowork folders, conversation identity, and received billing stay on the conversation org.',
      'Do not wait for Peet when this human asked for invoice/quote/CRM/doc/email on their own book.',
      extraOrgIds.length > 0 ? `This token is also scoped to: ${extraOrgIds.join(', ')}.` : '',
    ].filter(Boolean)
    : []
  return [
    '',
    '[Partners in Biz API auth — user delegation]',
    `You are acting for user ${input.actingForUserId} as agent ${input.agentId} in org ${input.orgId}.`,
    'For every Partners in Biz /api/v1/* call in this run:',
    `- Authorization: Bearer ${input.token}`,
    `- X-Org-Id: ${input.orgId}`,
    `- API base: ${apiBase}`,
    `Token expires at ${input.expiresAt} (ISO). Do not reuse after expiry.`,
    'Use ONLY the Bearer token in THIS block. Ignore any earlier pib_dlg_ value from conversation history or a cached Hermes conversation.',
    `Scopes for this delegation: ${scopeLine}`,
    ...staffBillingLines,
    ...mailboxLines,
    'Do not use AI_API_KEY, agent system keys, or invent credentials for PiB API calls in this run.',
    'Do not print the full Bearer token in client-visible replies; use it only in HTTP Authorization headers.',
    'If /api/v1/agent/email/* (or another mailbox route that requires delegation evidence) returns 401/403, the platform remints a fresh user-delegation token once in this run and retries. Do not ask the human to do anything.',
    'If the mailbox call still fails after that silent remint, say the mailbox call failed and stop.',
    'If a non-mailbox PiB API call returns 401/403 for an expired pib_dlg_ token, the platform remints once on the next call. If it still fails, stop and report the exact error — do not fall back to another key.',
    '',
  ].join('\n')
}

/**
 * Mint a Messages-dispatch delegation for a human sender.
 * Soft-fails (returns null) so chat dispatch is never blocked by auth mint issues.
 */
export async function mintMessagesDispatchDelegation(input: {
  user: ApiUser
  orgId: string
  agentId: string
  conversationId: string
}): Promise<MintedDelegation | null> {
  if (input.user.role === 'ai') return null
  if (input.user.authKind === 'user_delegation') return null
  try {
    return await mintAgentDelegation({
      user: input.user,
      orgId: input.orgId,
      agentId: input.agentId,
      purpose: `messages:${input.conversationId}`,
      conversationId: input.conversationId,
      ttlSeconds: 60 * 60,
    })
  } catch (error) {
    console.error('[delegation-mint-messages-failed]', {
      conversationId: input.conversationId,
      agentId: input.agentId,
      orgId: input.orgId,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
