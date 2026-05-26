import { adminDb } from '@/lib/firebase/admin'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export type PortalUserData = {
  activeOrgId?: unknown
  orgId?: unknown
  orgIds?: unknown
  role?: unknown
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isAdminUser(data: PortalUserData): boolean {
  return cleanString(data.role) === 'admin'
}

function canIncludePortalOrg(data: PortalUserData, orgId: string): boolean {
  return !isAdminUser(data) || orgId !== PIB_PLATFORM_ORG_ID
}

function userLinkedOrgIds(data: PortalUserData): string[] {
  const ids = new Set<string>()

  if (Array.isArray(data.orgIds)) {
    for (const value of data.orgIds) {
      const orgId = cleanString(value)
      if (orgId && canIncludePortalOrg(data, orgId)) ids.add(orgId)
    }
  }

  const activeOrgId = cleanString(data.activeOrgId)
  if (activeOrgId && canIncludePortalOrg(data, activeOrgId)) ids.add(activeOrgId)

  const primaryOrgId = cleanString(data.orgId)
  if (primaryOrgId && canIncludePortalOrg(data, primaryOrgId)) {
    ids.add(primaryOrgId)
  }

  return Array.from(ids)
}

function orgIdFromMemberDoc(docId: string, uid: string): string {
  const suffix = `_${uid}`
  return docId.endsWith(suffix) ? docId.slice(0, -suffix.length) : ''
}

async function orgMemberOrgIds(uid: string): Promise<string[]> {
  const snap = await adminDb.collection('orgMembers').where('uid', '==', uid).get()
  const ids = new Set<string>()
  for (const doc of snap.docs) {
    const data = doc.data() ?? {}
    const orgId = cleanString(data.orgId) || orgIdFromMemberDoc(doc.id, uid)
    if (orgId) ids.add(orgId)
  }
  return Array.from(ids)
}

export function choosePortalActiveOrgId(data: PortalUserData, orgIds: string[]): string | null {
  const accessible = new Set(orgIds)
  const activeOrgId = cleanString(data.activeOrgId)
  if (activeOrgId && accessible.has(activeOrgId)) return activeOrgId

  const primaryOrgId = cleanString(data.orgId)
  if (primaryOrgId && accessible.has(primaryOrgId)) return primaryOrgId

  return orgIds[0] ?? null
}

export async function getPortalOrgIdsForUser(uid: string, data: PortalUserData): Promise<string[]> {
  const ids = new Set(userLinkedOrgIds(data))
  for (const orgId of await orgMemberOrgIds(uid)) {
    if (canIncludePortalOrg(data, orgId)) ids.add(orgId)
  }
  return Array.from(ids)
}

export async function resolvePortalActiveOrgId(uid: string, data: PortalUserData): Promise<string | null> {
  const linkedIds = userLinkedOrgIds(data)
  const linkedActive = choosePortalActiveOrgId(data, linkedIds)
  if (linkedActive) return linkedActive

  const orgIds = await getPortalOrgIdsForUser(uid, data)
  return choosePortalActiveOrgId(data, orgIds)
}

export async function canUsePortalOrg(uid: string, data: PortalUserData, orgId: string): Promise<boolean> {
  const requestedOrgId = cleanString(orgId)
  if (!requestedOrgId) return false
  if (!canIncludePortalOrg(data, requestedOrgId)) return false
  if (userLinkedOrgIds(data).includes(requestedOrgId)) return true
  const memberOrgIds = await orgMemberOrgIds(uid)
  return memberOrgIds.includes(requestedOrgId)
}
