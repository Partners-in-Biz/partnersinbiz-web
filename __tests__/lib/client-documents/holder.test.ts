/**
 * @jest-environment node
 */
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import {
  isDocumentClientFacingStatus,
  isDocumentInternalStatus,
  resolveDocumentHolderOrgId,
} from '@/lib/client-documents/holder'

describe('document holder model', () => {
  it('holds on platform when client org maps to a platform company', () => {
    expect(resolveDocumentHolderOrgId({
      requestedOrgId: 'client-org-1',
      platformCompanyIdForClientOrg: 'company-1',
    })).toBe(PIB_PLATFORM_ORG_ID)
  })

  it('holds on the company CRM org when creating via company link', () => {
    expect(resolveDocumentHolderOrgId({
      linkedCompany: { id: 'c1', orgId: PIB_PLATFORM_ORG_ID, linkedOrgId: 'client-org-1' },
    })).toBe(PIB_PLATFORM_ORG_ID)
  })

  it('falls back to requested then creator home org', () => {
    expect(resolveDocumentHolderOrgId({ requestedOrgId: 'org-a' })).toBe('org-a')
    expect(resolveDocumentHolderOrgId({ creatorHomeOrgId: 'home-1' })).toBe('home-1')
  })

  it('classifies statuses', () => {
    expect(isDocumentInternalStatus('internal_draft')).toBe(true)
    expect(isDocumentClientFacingStatus('accepted')).toBe(true)
    expect(isDocumentClientFacingStatus('internal_draft')).toBe(false)
  })
})
