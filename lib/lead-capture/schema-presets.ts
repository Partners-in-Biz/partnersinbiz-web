import type { FormField } from '@/lib/forms/types'
import type { CaptureField } from '@/lib/lead-capture/types'
import { sanitizeCaptureFields } from '@/lib/lead-capture/schema'

export const LEGACY_PUBLIC_CAPTURE_FIELDS: CaptureField[] = sanitizeCaptureFields([
  { key: 'name', label: 'Name', type: 'text', required: false },
  { key: 'firstName', label: 'First name', type: 'text', required: false },
  { key: 'lastName', label: 'Last name', type: 'text', required: false },
  { key: 'phone', label: 'Phone', type: 'tel', required: false },
  { key: 'company', label: 'Company', type: 'text', required: false },
  { key: 'notes', label: 'Notes', type: 'textarea', required: false },
  { key: '_utm_source', label: 'UTM source', type: 'hidden', required: false, attributionKey: 'utm_source' },
  { key: '_utm_campaign', label: 'UTM campaign', type: 'hidden', required: false, attributionKey: 'utm_campaign' },
  { key: '_referrer', label: 'Referrer', type: 'hidden', required: false, attributionKey: 'referrer' },
  { key: '_campaign', label: 'Campaign lineage', type: 'hidden', required: false, attributionKey: 'campaignId' },
])

export function formCaptureSchemaFields(fields: FormField[]): CaptureField[] {
  return sanitizeCaptureFields(fields.filter((field) => field.type !== 'hidden').map((field) => ({
    key: field.id,
    label: field.label,
    type: field.type === 'phone' ? 'tel' : field.type,
    required: field.required,
    options: field.options,
    validation: field.validation,
  })))
}
