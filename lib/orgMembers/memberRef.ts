import { adminDb } from '@/lib/firebase/admin'

export type MemberRefKind = 'human' | 'agent' | 'system'

export interface MemberRef {
  uid: string
  displayName: string
  avatarUrl?: string
  jobTitle?: string
  kind: MemberRefKind
}

export const AGENT_PIP_REF: MemberRef = {
  uid: 'agent:pip',
  displayName: 'Pip',
  jobTitle: 'AI Agent',
  kind: 'agent',
}

export const LEGACY_REF: MemberRef = {
  uid: 'system:legacy',
  displayName: 'Imported',
  jobTitle: 'Pre-CRM-rewire',
  kind: 'system',
}

export function FORMER_MEMBER_REF(uid: string): MemberRef {
  return {
    uid,
    displayName: 'Former member',
    kind: 'system',
  }
}

export function formSubmissionRef(formId: string, formName: string): MemberRef {
  return {
    uid: `system:form-submission:${formId}`,
    displayName: formName,
    kind: 'system',
  }
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitDisplayName(value: string): { firstName?: string; lastName?: string } {
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) }
}

export function buildHumanRef(uid: string, data: Record<string, unknown> | undefined): MemberRef {
  if (!data) return FORMER_MEMBER_REF(uid)
  const displayNameField = cleanString(data.displayName) || cleanString(data.name)
  const firstName = cleanString(data.firstName) || splitDisplayName(displayNameField).firstName || ''
  const lastName = cleanString(data.lastName) || splitDisplayName(displayNameField).lastName || ''
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || displayNameField || cleanString(data.email) || uid
  const ref: MemberRef = { uid, displayName, kind: 'human' }
  const jobTitle = cleanString(data.jobTitle)
  const avatarUrl = cleanString(data.avatarUrl) || cleanString(data.photoURL)
  if (jobTitle) ref.jobTitle = jobTitle
  if (avatarUrl) ref.avatarUrl = avatarUrl
  return ref
}

async function resolveOrgMemberArrayRef(orgId: string, uid: string): Promise<MemberRef | null> {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  if (!orgSnap.exists) return null
  const orgData = orgSnap.data() ?? {}
  const members = Array.isArray(orgData.members) ? orgData.members : []
  const member = members.find((row) => {
    if (!row || typeof row !== 'object') return false
    return cleanString((row as Record<string, unknown>).userId) === uid
  }) as Record<string, unknown> | undefined
  if (!member) return null
  return buildHumanRef(uid, member)
}

async function resolveUserDocRef(uid: string): Promise<MemberRef | null> {
  const userSnap = await adminDb.collection('users').doc(uid).get()
  if (!userSnap.exists) return null
  return buildHumanRef(uid, userSnap.data())
}

export async function resolveMemberRef(orgId: string, uid: string): Promise<MemberRef> {
  const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  if (snap.exists) return buildHumanRef(uid, snap.data())

  const orgMemberRef = await resolveOrgMemberArrayRef(orgId, uid)
  if (orgMemberRef) return orgMemberRef

  const userRef = await resolveUserDocRef(uid)
  if (userRef) return userRef

  return FORMER_MEMBER_REF(uid)
}

export async function snapshotForWrite(orgId: string, uid: string): Promise<MemberRef> {
  const snap = await adminDb.collection('orgMembers').doc(`${orgId}_${uid}`).get()
  if (snap.exists) return buildHumanRef(uid, snap.data())

  const orgMemberRef = await resolveOrgMemberArrayRef(orgId, uid)
  if (orgMemberRef) return orgMemberRef

  const userRef = await resolveUserDocRef(uid)
  if (userRef) return userRef

  throw new Error(`snapshotForWrite: ${uid} is not a member of org ${orgId}`)
}
