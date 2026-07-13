import { captureSchemaFingerprint } from '@/lib/lead-capture/schema'
import { formCaptureSchemaFields, LEGACY_PUBLIC_CAPTURE_FIELDS } from '@/lib/lead-capture/schema-presets'

describe('cross-route capture schema reconstruction', () => {
  it('builds deterministic canonical versions for legacy and generic form routes', () => {
    const formFields = formCaptureSchemaFields([
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'company', label: 'Company', type: 'text', required: false },
    ])
    expect(captureSchemaFingerprint(LEGACY_PUBLIC_CAPTURE_FIELDS)).toMatch(/^schema_/)
    expect(captureSchemaFingerprint(formFields)).toBe(captureSchemaFingerprint(formCaptureSchemaFields([
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'company', label: 'Company', type: 'text', required: false },
    ])))
  })

  it('faithfully maps every generic form field type and excludes hidden caller fields', () => {
    const fields = formCaptureSchemaFields([
      { id: 'amount', label: 'Amount', type: 'number', required: true, validation: { min: 1 } },
      { id: 'date', label: 'Date', type: 'date', required: true },
      { id: 'choice', label: 'Choice', type: 'radio', required: true, options: ['a', 'b'] },
      { id: 'many', label: 'Many', type: 'multiselect', required: false, options: ['a', 'b'] },
      { id: 'agree', label: 'Agree', type: 'checkbox', required: true },
      { id: 'attachment', label: 'Attachment', type: 'file', required: false },
      { id: 'internal', label: 'Internal', type: 'hidden', required: false },
    ])
    expect(fields.map(({ key, type }) => ({ key, type }))).toEqual([
      { key: 'amount', type: 'number' }, { key: 'date', type: 'date' },
      { key: 'choice', type: 'radio' }, { key: 'many', type: 'multiselect' },
      { key: 'agree', type: 'checkbox' }, { key: 'attachment', type: 'file' },
    ])
    expect(fields[0].validation).toEqual({ min: 1 })
  })
})
