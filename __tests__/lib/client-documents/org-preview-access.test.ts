import {
  getDocumentPreviewOrgIds,
  isDocumentPreviewableInOrg,
} from '@/lib/client-documents/org-preview-access'

describe('isDocumentPreviewableInOrg', () => {
  it('allows documents owned by the current org', () => {
    expect(isDocumentPreviewableInOrg({ orgId: 'org_a', linked: {} }, 'org_a')).toBe(true)
  })

  it('allows PiB-owned documents linked into the current client org', () => {
    expect(
      isDocumentPreviewableInOrg(
        { orgId: 'pib-platform-owner', linked: { clientOrgId: 'client_org' } },
        'client_org',
      ),
    ).toBe(true)
  })

  it('rejects unrelated org-scoped documents', () => {
    expect(
      isDocumentPreviewableInOrg(
        { orgId: 'pib-platform-owner', linked: { clientOrgId: 'other_client' } },
        'client_org',
      ),
    ).toBe(false)
  })
})

describe('getDocumentPreviewOrgIds', () => {
  it('includes both source owner and linked client org for access checks', () => {
    expect(
      getDocumentPreviewOrgIds({
        orgId: 'pib-platform-owner',
        linked: { clientOrgId: 'client_org' },
      }),
    ).toEqual(['pib-platform-owner', 'client_org'])
  })

  it('deduplicates documents owned by and linked to the same org', () => {
    expect(
      getDocumentPreviewOrgIds({
        orgId: 'client_org',
        linked: { clientOrgId: 'client_org' },
      }),
    ).toEqual(['client_org'])
  })
})
