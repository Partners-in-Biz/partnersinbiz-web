import {
  buildCaptureSchemaVersion,
  captureSchemaFingerprint,
  resolveCaptureFields,
  sanitizeCaptureFields,
} from '@/lib/lead-capture/schema'

describe('lead capture schema', () => {
  it('sanitizes versionable hidden, progressive and conditional fields', () => {
    expect(sanitizeCaptureFields([
      {
        key: 'company',
        label: 'Company',
        type: 'text',
        required: true,
        progressiveStep: 2,
        showWhen: { fieldKey: 'role', operator: 'equals', value: 'owner' },
      },
      {
        key: 'utm_source',
        label: 'UTM source',
        type: 'hidden',
        required: false,
        attributionKey: 'utm_source',
      },
    ])).toEqual([
      {
        key: 'company',
        label: 'Company',
        type: 'text',
        required: true,
        progressiveStep: 2,
        showWhen: { fieldKey: 'role', operator: 'equals', value: 'owner' },
      },
      {
        key: 'utm_source',
        label: 'UTM source',
        type: 'hidden',
        required: false,
        attributionKey: 'utm_source',
      },
    ])
  })

  it('drops duplicate keys and invalid conditions instead of creating ambiguous schemas', () => {
    expect(sanitizeCaptureFields([
      { key: 'name', label: 'Name', type: 'text', required: false },
      { key: 'name', label: 'Duplicate', type: 'text', required: false },
      {
        key: 'company', label: 'Company', type: 'text', required: false,
        showWhen: { fieldKey: 'role', operator: 'executes-code', value: 'owner' },
      },
    ])).toEqual([
      { key: 'name', label: 'Name', type: 'text', required: false },
      { key: 'company', label: 'Company', type: 'text', required: false },
    ])
  })

  it('uses trusted attribution for hidden fields and never accepts spoofed hidden values', () => {
    const fields = sanitizeCaptureFields([
      { key: 'utm_source', label: 'UTM source', type: 'hidden', required: false, attributionKey: 'utm_source' },
      { key: 'campaign', label: 'Campaign', type: 'hidden', required: false, attributionKey: 'campaignId' },
    ])

    expect(resolveCaptureFields(fields, {
      utm_source: 'spoofed',
      campaign: 'spoofed-campaign',
    }, {
      utm_source: 'newsletter',
      campaignId: 'campaign-1',
    })).toEqual({
      ok: true,
      data: { utm_source: 'newsletter', campaign: 'campaign-1' },
      visibleFieldKeys: [],
    })
  })

  it('requires a conditional field only when its condition is visible', () => {
    const fields = sanitizeCaptureFields([
      { key: 'role', label: 'Role', type: 'select', required: true, options: ['owner', 'staff'] },
      {
        key: 'company', label: 'Company', type: 'text', required: true,
        showWhen: { fieldKey: 'role', operator: 'equals', value: 'owner' },
      },
    ])

    expect(resolveCaptureFields(fields, { role: 'staff' }, {})).toMatchObject({
      ok: true,
      data: { role: 'staff' },
      visibleFieldKeys: ['role'],
    })
    expect(resolveCaptureFields(fields, { role: 'owner' }, {})).toMatchObject({
      ok: false,
      errors: ['Field "Company" is required'],
      visibleFieldKeys: ['role', 'company'],
    })
  })

  it('validates only the requested progressive step', () => {
    const fields = sanitizeCaptureFields([
      { key: 'firstName', label: 'First name', type: 'text', required: true, progressiveStep: 1 },
      { key: 'company', label: 'Company', type: 'text', required: true, progressiveStep: 2 },
    ])

    expect(resolveCaptureFields(fields, { firstName: 'Ari' }, {}, { progressiveStep: 1 })).toMatchObject({
      ok: true,
      data: { firstName: 'Ari' },
    })
  })

  it('produces the same immutable fingerprint for semantically identical schemas', () => {
    const a = sanitizeCaptureFields([
      { key: 'email', label: 'Email', type: 'email', required: true },
    ])
    const b = sanitizeCaptureFields([
      { required: true, type: 'email', label: 'Email', key: 'email' },
    ])

    expect(captureSchemaFingerprint(a)).toMatch(/^schema_[a-f0-9]{24}$/)
    expect(captureSchemaFingerprint(a)).toBe(captureSchemaFingerprint(b))
  })

  it('builds an immutable tenant-scoped schema version record', () => {
    const fields = sanitizeCaptureFields([
      { key: 'email', label: 'Email', type: 'email', required: true },
    ])
    expect(buildCaptureSchemaVersion({ orgId: 'org-1', sourceId: 'source-1', fields })).toEqual({
      id: captureSchemaFingerprint(fields),
      orgId: 'org-1',
      captureSourceId: 'source-1',
      fields,
    })
  })
})
