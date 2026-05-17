// lib/customFields/types.ts
import type { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export type CustomFieldResource = 'contact' | 'deal' | 'company'

export type CustomFieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'dropdown'
  | 'multi_select'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'

export interface CustomFieldDropdownOption {
  value: string    // stored value
  label: string    // displayed label
  color?: string   // optional chip color
}

export interface CustomFieldDefinition {
  id: string
  orgId: string
  resource: CustomFieldResource
  key: string                             // unique within (orgId, resource); used as the `customFields` map key
  label: string                           // displayed in UI
  type: CustomFieldType
  required: boolean                       // enforced on POST/PATCH writes
  defaultValue?: unknown                  // applied at form-render time only
  options?: CustomFieldDropdownOption[]   // for dropdown / multi_select
  helpText?: string
  group?: string                          // optional grouping in UI (e.g. "Billing", "Compliance")
  order: number                           // sort order within (resource, group)
  // Type-specific constraints (optional)
  minLength?: number                      // for text/longtext
  maxLength?: number
  min?: number                            // for number/currency
  max?: number
  currencyCode?: string                   // for currency type (default workspace currency)
  // Attribution + soft-delete
  createdBy?: string
  createdByRef?: MemberRef
  updatedBy?: string
  updatedByRef?: MemberRef
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
  deleted?: boolean
}

export interface CustomFieldValidationError {
  key: string
  message: string
}
