import {
  resolveDocumentHolderOrgId,
  resolveDocumentRecipientClientOrgId,
} from '@/lib/client-documents/holder'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

describe('document holder / recipient org resolution', () => {
  it('holds platform-company work under the platform org', () => {
    expect(resolveDocumentHolderOrgId({
      requestedOrgId: 'client-org',
      platformCompanyIdForClientOrg: 'company-1',
    })).toBe(PIB_PLATFORM_ORG_ID)
  })

  it('never uses the platform holder org as the recipient client org', () => {
    expect(resolveDocumentRecipientClientOrgId({
      holderOrgId: PIB_PLATFORM_ORG_ID,
      linkedClientOrgId: PIB_PLATFORM_ORG_ID,
      companyLinkedOrgId: 'saaiman-client-org',
    })).toBe('saaiman-client-org')

    expect(resolveDocumentRecipientClientOrgId({
      holderOrgId: PIB_PLATFORM_ORG_ID,
      linkedClientOrgId: PIB_PLATFORM_ORG_ID,
      linkedClientOrgIds: [PIB_PLATFORM_ORG_ID],
    })).toBeUndefined()

    expect(resolveDocumentRecipientClientOrgId({
      holderOrgId: PIB_PLATFORM_ORG_ID,
      linkedClientOrgId: 'client-org',
    })).toBe('client-org')
  })

  it('allows recipient to equal holder when the document is client-org held', () => {
    expect(resolveDocumentRecipientClientOrgId({
      holderOrgId: 'client-org',
      linkedClientOrgId: 'client-org',
    })).toBe('client-org')
  })

  it('prefers company.linkedOrgId over a bad request clientOrgId stamp', () => {
    expect(resolveDocumentRecipientClientOrgId({
      holderOrgId: PIB_PLATFORM_ORG_ID,
      linkedClientOrgId: PIB_PLATFORM_ORG_ID,
      linkedClientOrgIds: [PIB_PLATFORM_ORG_ID, 'other-client'],
      companyLinkedOrgId: 'correct-client-org',
    })).toBe('correct-client-org')
  })
})
