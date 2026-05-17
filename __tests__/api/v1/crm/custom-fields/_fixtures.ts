// __tests__/api/v1/crm/custom-fields/_fixtures.ts
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import { Timestamp } from 'firebase-admin/firestore'

// Re-export shared member + uid helpers from the companies fixtures so
// A2 tests don't drift from A1's distinct-uid convention.
export { uidFor, buildAdminMember, buildRegularMember, buildOwnerMember, buildViewerMember } from '../companies/_fixtures'

let defCounter = 0
export function buildDefinition(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  defCounter++
  return {
    id: overrides.id ?? `def_${defCounter}_${Math.random().toString(36).slice(2, 6)}`,
    orgId: 'org-a',
    resource: 'contact',
    key: `field_${defCounter}`,
    label: `Field ${defCounter}`,
    type: 'text',
    required: false,
    order: defCounter,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }
}

export const sampleDefs = {
  contactTier: buildDefinition({
    resource: 'contact',
    key: 'tier',
    label: 'Tier',
    type: 'dropdown',
    required: true,
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
      { value: 'bronze', label: 'Bronze' },
    ],
  }),
  dealBudget: buildDefinition({
    resource: 'deal',
    key: 'budget',
    label: 'Budget',
    type: 'currency',
    currencyCode: 'USD',
    min: 0,
  }),
  companyComplianceNotes: buildDefinition({
    resource: 'company',
    key: 'compliance_notes',
    label: 'Compliance Notes',
    type: 'longtext',
    maxLength: 5000,
    group: 'Compliance',
  }),
  contactSegmentEmails: buildDefinition({
    resource: 'contact',
    key: 'segment_emails',
    label: 'Segments',
    type: 'multi_select',
    options: [
      { value: 'newsletter', label: 'Newsletter' },
      { value: 'product_updates', label: 'Product updates' },
      { value: 'webinars', label: 'Webinars' },
    ],
  }),
  dealClosedOn: buildDefinition({
    resource: 'deal',
    key: 'closed_on',
    label: 'Closed on',
    type: 'date',
  }),
  companyVerified: buildDefinition({
    resource: 'company',
    key: 'verified',
    label: 'Verified',
    type: 'checkbox',
  }),
}
