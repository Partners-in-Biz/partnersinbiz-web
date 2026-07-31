import {
  isClientDocumentVisibleToUser,
  assertClientDocumentDataAccess,
} from '@/lib/client-documents/access'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

const stean = {
  uid: 'stean-1',
  role: 'client' as const,
  orgId: PIB_PLATFORM_ORG_ID,
  orgIds: [PIB_PLATFORM_ORG_ID, 'saaiman-org'],
}

describe('client-role document visibility', () => {
  it('denies platform-held docs to client members of the platform org', () => {
    const scholtz = {
      orgId: PIB_PLATFORM_ORG_ID,
      status: 'client_review' as const,
      linked: { clientOrgId: 'other-client', companyId: 'scholtz-co' },
      createdBy: 'someone-else',
    }
    expect(isClientDocumentVisibleToUser(scholtz, stean)).toBe(false)
    expect(assertClientDocumentDataAccess(scholtz, stean).ok).toBe(false)
  })

  it('allows recipient-linked client-facing docs for the client org', () => {
    const saaiman = {
      orgId: PIB_PLATFORM_ORG_ID,
      status: 'client_review' as const,
      linked: { clientOrgId: 'saaiman-org' },
      createdBy: 'pip-human',
    }
    expect(isClientDocumentVisibleToUser(saaiman, stean)).toBe(true)
  })

  it('denies docs that only stamp platform as recipient', () => {
    const bad = {
      orgId: PIB_PLATFORM_ORG_ID,
      status: 'client_review' as const,
      linked: { clientOrgId: PIB_PLATFORM_ORG_ID },
      createdBy: 'other',
    }
    expect(isClientDocumentVisibleToUser(bad, stean)).toBe(false)
  })

  it('allows own drafts on the platform holder', () => {
    const own = {
      orgId: PIB_PLATFORM_ORG_ID,
      status: 'internal_draft' as const,
      createdBy: 'stean-1',
    }
    expect(isClientDocumentVisibleToUser(own, stean)).toBe(true)
  })
})
