import {
  LINKED_ARRAY_FIELDS,
  normalizeClientDocumentLinks,
  normalizeProjectLinks,
  normalizeResourceRelationshipLinks,
} from '@/lib/client-documents/linkedValidation'

describe('multi-link normalization', () => {
  it('normalizes document scalar-plus-array links with trimming, dedupe, caps, and primary inclusion', () => {
    const result = normalizeClientDocumentLinks({
      companyId: ' company-primary ',
      companyIds: [' company-secondary ', 'company-primary', 'company-secondary', 'company-over-cap'],
      contactId: 'contact-primary',
      contactIds: [' contact-secondary '],
      clientOrgId: 'client-primary',
      clientOrgIds: ['client-secondary'],
      projectId: 'project-primary',
      projectIds: ['project-secondary'],
      dealId: 'deal-primary',
      dealIds: ['deal-primary'],
    }, { maxIdsPerField: 3 })

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        companyId: 'company-primary',
        companyIds: ['company-primary', 'company-secondary', 'company-over-cap'],
        contactId: 'contact-primary',
        contactIds: ['contact-primary', 'contact-secondary'],
        clientOrgId: 'client-primary',
        clientOrgIds: ['client-primary', 'client-secondary'],
        projectId: 'project-primary',
        projectIds: ['project-primary', 'project-secondary'],
        dealId: 'deal-primary',
        dealIds: ['deal-primary'],
      }),
    })
  })

  it('rejects invalid document link array values instead of silently dropping them', () => {
    const result = normalizeClientDocumentLinks({ companyIds: ['company-1', '', 'company-2'] })

    expect(result).toEqual({ ok: false, error: 'linked.companyIds[1] must be a non-empty string' })
  })

  it('preserves scalar-only document compatibility by creating matching arrays', () => {
    const result = normalizeClientDocumentLinks({ companyId: 'company-1', contactId: 'contact-1' })

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        companyId: 'company-1',
        companyIds: ['company-1'],
        contactId: 'contact-1',
        contactIds: ['contact-1'],
      }),
    })
  })

  it('normalizes project relationship arrays while preserving primary scalar claim/share fields', () => {
    const result = normalizeProjectLinks({
      companyId: ' company-primary ',
      companyIds: ['company-secondary'],
      contactId: ' contact-primary ',
      sourceCompanyId: ' source-company-primary ',
      sourceCompanyIds: ['source-company-secondary'],
      sourceContactId: ' source-contact-primary ',
      recipientOrgId: ' recipient-primary ',
      recipientOrgIds: ['recipient-secondary'],
    })

    expect(result).toEqual({
      ok: true,
      value: {
        companyId: 'company-primary',
        companyIds: ['company-primary', 'company-secondary'],
        contactId: 'contact-primary',
        contactIds: ['contact-primary'],
        sourceCompanyId: 'source-company-primary',
        sourceCompanyIds: ['source-company-primary', 'source-company-secondary'],
        sourceContactId: 'source-contact-primary',
        sourceContactIds: ['source-contact-primary'],
        recipientOrgId: 'recipient-primary',
        recipientOrgIds: ['recipient-primary', 'recipient-secondary'],
      },
    })
  })

  it('exposes the new document many-to-many fields as linked array fields', () => {
    expect(Array.from(LINKED_ARRAY_FIELDS)).toEqual(expect.arrayContaining([
      'companyIds',
      'contactIds',
      'clientOrgIds',
      'projectIds',
      'dealIds',
    ]))
  })

  it('normalizes non-document resource company/contact links without changing primary buyer fields', () => {
    const result = normalizeResourceRelationshipLinks({
      companyId: ' primary-company ',
      companyIds: ['secondary-company', 'primary-company'],
      contactId: ' signatory-contact ',
      contactIds: [' stakeholder-contact ', 'signatory-contact'],
      dealId: 'primary-deal',
      dealIds: ['secondary-deal'],
      projectId: 'project-1',
      projectIds: ['project-2'],
      contextRefs: [{ type: 'company', id: 'primary-company', label: 'Primary Company' }],
    })

    expect(result).toEqual({
      ok: true,
      value: {
        companyId: 'primary-company',
        companyIds: ['primary-company', 'secondary-company'],
        contactId: 'signatory-contact',
        contactIds: ['signatory-contact', 'stakeholder-contact'],
        dealId: 'primary-deal',
        dealIds: ['primary-deal', 'secondary-deal'],
        projectId: 'project-1',
        projectIds: ['project-1', 'project-2'],
        contextRefs: [{ type: 'company', id: 'primary-company', label: 'Primary Company' }],
      },
    })
  })

  it('rejects invalid non-document resource link arrays', () => {
    const result = normalizeResourceRelationshipLinks({ contactIds: ['contact-1', 42] })

    expect(result).toEqual({ ok: false, error: 'linked.contactIds[1] must be a string' })
  })
})
