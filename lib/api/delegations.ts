import { createHash, randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'

import type { ApiRole, ApiUser } from '@/lib/api/types'
import { canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { resolveMemberAccessPolicy } from '@/lib/orgMembers/access-policy'
import {
  ORGANIZATION_MODULE_POLICY_KEYS,
  resolveOrganizationModulePolicies,
  canRolePerformModuleAction,
} from '@/lib/organizations/module-policies'
import { resolveOrganizationPolicyRole } from '@/lib/organizations/module-policy-access'
import type { OrgRole } from '@/lib/organizations/types'
import { isActiveOrgMembershipRow } from '@/lib/linked-computers/policy'

const DELEGATION_COLLECTION = 'agent_delegations'
const DELEGATION_PREFIX = 'pib_dlg_'
const DEFAULT_TTL_SECONDS = 3600
const MAX_TTL_SECONDS = 24 * 60 * 60

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

export async function mintAgentDelegation(input: {
  user: ApiUser
  orgId: string
  agentId: string
  purpose: string
  ttlSeconds?: number
  conversationId?: string
}) {
  const orgId = normalizeText(input.orgId)
  const agentId = normalizeText(input.agentId)
  const purpose = normalizeText(input.purpose)
  if (!orgId) throw Object.assign(new Error('orgId is required'), { status: 400 })
  if (!agentId) throw Object.assign(new Error('agentId is required'), { status: 400 })
  if (!purpose) throw Object.assign(new Error('purpose is required'), { status: 400 })
  if (input.user.role === 'ai') throw Object.assign(new Error('AI/system users cannot mint delegations'), { status: 403 })
  if (!canAccessOrg(input.user, orgId)) throw Object.assign(new Error('Forbidden'), { status: 403 })

  const ttlSeconds = Math.min(Math.max(Math.trunc(input.ttlSeconds ?? DEFAULT_TTL_SECONDS), 60), MAX_TTL_SECONDS)
  const token = `${DELEGATION_PREFIX}${randomBytes(24).toString('hex')}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const scopes = await buildDelegationScopes(input.user, orgId)
  const memberAccessPolicy = await loadMemberAccessPolicy(input.user.uid, orgId)
  const ref = adminDb.collection(DELEGATION_COLLECTION).doc()

  await ref.set({
    tokenHash,
    tokenPrefix: token.slice(0, 16),
    actingForUserId: input.user.uid,
    agentId,
    role: input.user.role,
    orgId,
    activeOrgId: orgId,
    orgIds: [orgId],
    allowedOrgIds: input.user.allowedOrgIds ?? null,
    memberAccessPolicy: memberAccessPolicy ?? null,
    scopes,
    purpose,
    conversationId: normalizeText(input.conversationId) || null,
    status: 'active',
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.user.uid,
    createdByType: 'user',
    lastUsedAt: null,
  })

  return {
    id: ref.id,
    token,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    actingForUserId: input.user.uid,
    agentId,
    orgIds: [orgId],
    scopes,
  }
}

export async function resolveDelegationTokenUser(rawToken: string): Promise<ApiUser | null> {
  if (!rawToken || !rawToken.startsWith(DELEGATION_PREFIX)) return null
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  try {
    const snap = await adminDb.collection(DELEGATION_COLLECTION).where('tokenHash', '==', tokenHash).limit(1).get()
    if (snap.empty || snap.docs.length === 0) return null
    const doc = snap.docs[0]
    const data = doc.data() ?? {}
    if (normalizeText(data.status) !== 'active' || data.revokedAt) return null
    const expiresAt = timestampToMillis(data.expiresAt)
    if (expiresAt !== null && expiresAt <= Date.now()) return null

    try {
      await doc.ref.update({ lastUsedAt: FieldValue.serverTimestamp() })
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
      delegationId: doc.id,
      actingForUserId,
      delegationScopes: scopes,
      orgId: orgId || undefined,
      activeOrgId,
      orgIds: orgIds.length > 0 ? orgIds : (activeOrgId ? [activeOrgId] : undefined),
      allowedOrgIds: allowedOrgIds.length > 0 ? allowedOrgIds : undefined,
      memberAccessPolicy: data.memberAccessPolicy ?? undefined,
    }
  } catch {
    return null
  }
}
