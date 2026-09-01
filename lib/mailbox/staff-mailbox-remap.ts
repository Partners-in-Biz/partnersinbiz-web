import { loadPlatformStaffMembership } from '@/lib/orgMembers/platform-staff'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export type StaffMailboxRemap = {
  mailboxOrgId: string
  conversationOrgId: string
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * PiB staff mailboxes live on pib-platform-owner. Client-company chats use the
 * conversation org as X-Org-Id / prompt orgId — remap mailbox reads/drafts onto
 * the platform org so Stean-shaped staff reach their connected Gmail.
 *
 * Returns null when the existing path should run unchanged.
 */
export async function resolvePibStaffMailboxRemap(input: {
  uid: string
  requestedOrgId: string
}): Promise<StaffMailboxRemap | null> {
  const uid = clean(input.uid)
  const requestedOrgId = clean(input.requestedOrgId)
  if (!uid || !requestedOrgId) return null
  if (requestedOrgId === PIB_PLATFORM_ORG_ID) return null

  const staff = await loadPlatformStaffMembership(uid)
  if (!staff) return null

  return {
    mailboxOrgId: staff.platformOrgId,
    conversationOrgId: requestedOrgId,
  }
}

export async function resolveMailboxOrgIdForActor(input: {
  uid: string
  requestedOrgId: string
}): Promise<{ orgId: string; conversationOrgId?: string }> {
  const requestedOrgId = clean(input.requestedOrgId)
  const remap = await resolvePibStaffMailboxRemap(input)
  if (!remap) return { orgId: requestedOrgId }
  return {
    orgId: remap.mailboxOrgId,
    conversationOrgId: remap.conversationOrgId,
  }
}
