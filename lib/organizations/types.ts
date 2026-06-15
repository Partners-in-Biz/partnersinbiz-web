// lib/organizations/types.ts

import type { Timestamp } from 'firebase-admin/firestore'
import type { PortalModules } from '@/lib/organizations/portal-modules'
import type { OrganizationModulePolicies } from '@/lib/organizations/module-policies'
import type { MemberAccessPolicy } from '@/lib/orgMembers/access-policy'

// ── Org Type & Status ─────────────────────────────────────────────────────

/**
 * platform_owner = the PIB org itself (unlocks CRM, cross-org dashboard, invoicing)
 * client         = paying client org (portal access, scoped workspace)
 * partner        = future use
 */
export type OrgType = 'platform_owner' | 'client' | 'partner'

export type OrgStatus = 'active' | 'onboarding' | 'suspended' | 'churned'

// ── Brand Profile ─────────────────────────────────────────────────────────

export interface BrandProfile {
  logoUrl?: string          // URL to logo (stored externally or Firebase Storage)
  logoMarkUrl?: string      // URL to icon/mark variant
  tagline?: string          // e.g. "Build faster, grow smarter"
  toneOfVoice?: string      // e.g. "Professional but approachable, avoid jargon"
  targetAudience?: string   // e.g. "SMB founders in tech"
  doWords?: string[]        // Words/phrases to use: ["innovative", "partner"]
  dontWords?: string[]      // Words/phrases to avoid: ["cheap", "basic"]
  fonts?: {
    heading?: string        // e.g. "Inter"
    body?: string           // e.g. "DM Sans"
  }
  socialHandles?: Record<string, string>  // { twitter: "@handle", linkedin: "company/slug" }
  guidelines?: string       // Free-form markdown for additional brand notes
}

// ── Address ──────────────────────────────────────────────────────────────

export interface Address {
  line1: string           // Street address line 1
  line2?: string          // Street address line 2
  city: string
  state?: string          // State/province/region
  postalCode: string
  country: string         // e.g. "South Africa", "United States"
}

// ── Billing Details ──────────────────────────────────────────────────────

export interface BankingDetails {
  bankName: string
  accountHolder: string
  accountNumber: string
  branchCode?: string     // Used in ZA
  routingNumber?: string  // Used in US
  swiftCode?: string      // For international payments
  iban?: string           // For EU payments
}

export interface BillingDetails {
  legalName?: string
  tradingName?: string
  address?: Address
  vatNumber?: string          // e.g. "4000000000"
  registrationNumber?: string // Company registration
  taxNumber?: string
  phone?: string
  accountsContact?: {
    name?: string
    title?: string
    email?: string
    phone?: string
  }
  authorizedSignatory?: {
    name?: string
    title?: string
    email?: string
    phone?: string
  }
  purchaseOrderRequired?: boolean
  purchaseOrderNumber?: string
  invoiceInstructions?: string
  bankingDetails?: BankingDetails
}

// ── Org Settings ──────────────────────────────────────────────────────────

export interface OrgSettings {
  timezone: string           // IANA timezone e.g. "America/New_York"
  currency: 'USD' | 'EUR' | 'ZAR'
  defaultApprovalRequired: boolean  // social posts need client approval by default
  notificationEmail: string
  portalModules?: Partial<PortalModules>
  modulePolicies?: Partial<OrganizationModulePolicies>
  brandColors?: {
    primary: string
    secondary: string
    accent: string
  }
  // Email send-time optimisation.
  // Hour 0-23 (org-local clock) at which sequences/broadcasts target sends.
  preferredSendHourLocal?: number
  // Days-of-week (0=Sun..6=Sat) sequences/broadcasts may target.
  preferredSendDaysOfWeek?: number[]
  // Addresses notified when a contact replies / bounces / unsubscribes via reply.
  replyNotifyEmails?: string[]
}

// ── Members ───────────────────────────────────────────────────────────────

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface OrgMember {
  userId: string
  role: OrgRole
  joinedAt?: Timestamp | null
  invitedBy?: string
  jobTitle?: string
  department?: string
  accessScope?: 'none' | 'all' | 'crm' | 'marketing' | 'projects' | 'billing' | 'readonly'
  accessPolicy?: MemberAccessPolicy
  accessNotes?: string
}

// ── Organization ──────────────────────────────────────────────────────────

export interface Organization {
  id?: string
  name: string
  slug: string
  type: OrgType
  status: OrgStatus
  description: string
  logoUrl: string
  website: string
  industry?: string
  plan?: string
  billingEmail?: string
  billingDetails?: BillingDetails
  createdBy: string
  members: OrgMember[]
  settings?: OrgSettings
  brandProfile?: BrandProfile

  /** @deprecated Use status field instead */
  active?: boolean

  /** @deprecated Legacy link — use orgId on related entities instead */
  linkedClientId?: string

  createdAt?: unknown   // Firestore Timestamp (serialised as { _seconds, _nanoseconds })
  updatedAt?: unknown
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  type: OrgType
  status: OrgStatus
  description: string
  logoUrl: string
  website: string
  industry?: string
  memberCount: number
  createdAt?: unknown
  updatedAt?: unknown
}
