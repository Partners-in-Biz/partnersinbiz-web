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
})
