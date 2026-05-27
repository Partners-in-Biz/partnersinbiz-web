// lib/orgMembers/types.ts
import type { OrgRole } from '@/lib/organizations/types'
import type { Timestamp } from 'firebase-admin/firestore'

export interface OrgMemberProfile {
  orgId: string
  uid: string
  firstName: string
  lastName: string
  jobTitle?: string
  department?: string
  accessScope?: string
  phone?: string
  avatarUrl?: string
  role: OrgRole
  profileBannerDismissed?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
}
