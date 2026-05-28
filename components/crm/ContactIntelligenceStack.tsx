'use client'

import {
  ContactEngagementPanel,
  type ContactEngagementActivity,
  type ContactEngagementEmail,
  type ContactEngagementSuggestion,
} from '@/components/crm/ContactEngagementPanel'
import { ContactIdentityPanel } from '@/components/crm/ContactIdentityPanel'
import { ContactOwnershipPanel } from '@/components/crm/ContactOwnershipPanel'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export interface ContactIntelligenceStackContact {
  assignedTo?: string
  assignedToRef?: MemberRef
  source?: string
  capturedFromId?: string
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  jobTitle?: string
  department?: string
  timezone?: string
  phoneVerified?: boolean
  smsOptedIn?: boolean
  smsUnsubscribedAt?: unknown
  unsubscribedAt?: unknown
  bouncedAt?: unknown
  repliesCount?: number
  lastContactedAt?: unknown
}

export function ContactIntelligenceStack({
  contact,
  emails,
  activities,
  nextSuggestion,
}: {
  contact: ContactIntelligenceStackContact
  emails: ContactEngagementEmail[]
  activities: ContactEngagementActivity[]
  nextSuggestion?: ContactEngagementSuggestion
}) {
  return (
    <div className="space-y-5">
      <ContactEngagementPanel
        profile={{
          lastContactedAt: contact.lastContactedAt,
          emails,
          activities,
          nextSuggestion,
        }}
      />

      <ContactIdentityPanel
        profile={{
          jobTitle: contact.jobTitle,
          department: contact.department,
          timezone: contact.timezone,
          phoneVerified: contact.phoneVerified,
          smsOptedIn: contact.smsOptedIn && !contact.smsUnsubscribedAt,
          unsubscribedAt: contact.unsubscribedAt,
          bouncedAt: contact.bouncedAt,
          repliesCount: contact.repliesCount,
        }}
      />

      <ContactOwnershipPanel
        profile={{
          assignedTo: contact.assignedTo,
          assignedToRef: contact.assignedToRef,
          source: contact.source,
          capturedFromId: contact.capturedFromId,
          createdByRef: contact.createdByRef,
          updatedByRef: contact.updatedByRef,
        }}
      />
    </div>
  )
}
