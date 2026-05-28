import {
  buildDocumentLinkPlan,
  parseFlags,
  type PlatformCompanyLink,
} from '@/scripts/backfill-platform-client-document-links'

const companies: PlatformCompanyLink[] = [
  {
    companyId: 'company-1',
    companyName: 'Client One',
    linkedOrgId: 'client-org',
    domain: 'clientone.co.za',
  },
  {
    companyId: 'company-2',
    companyName: 'Client Two',
    linkedOrgId: 'client-two',
    domain: 'clienttwo.co.za',
  },
]

describe('backfill-platform-client-document-links helpers', () => {
  it('defaults to dry-run and parses commit/org filters', () => {
    expect(parseFlags([])).toEqual({ dryRun: true, batchSize: 300 })
    expect(parseFlags(['--commit', '--org-id', 'client-org', '--batch-size', '50'])).toEqual({
      dryRun: false,
      orgId: 'client-org',
      batchSize: 50,
    })
    expect(parseFlags(['--commit', '--dry-run'])).toEqual({ dryRun: true, batchSize: 300 })
  })

  it('skips documents already linked to a company and client org', () => {
    expect(buildDocumentLinkPlan({
      id: 'doc-1',
      title: 'Client One Proposal',
      linked: { companyId: 'company-1', clientOrgId: 'client-org' },
    }, companies)).toEqual({
      action: 'skip',
      confidence: 'high',
      companyId: 'company-1',
      clientOrgId: 'client-org',
      reason: 'already linked',
    })
  })

  it('links documents by exact company name in the title', () => {
    expect(buildDocumentLinkPlan({
      id: 'doc-1',
      title: 'Client One Growth Proposal',
      linked: {},
    }, companies)).toEqual({
      action: 'link',
      confidence: 'high',
      companyId: 'company-1',
      clientOrgId: 'client-org',
      reason: 'matched company name in document title',
    })
  })

  it('flags ambiguous document matches for review', () => {
    expect(buildDocumentLinkPlan({
      id: 'doc-1',
      title: 'Client Proposal',
      linked: {},
    }, companies)).toEqual({
      action: 'review_required',
      confidence: 'low',
      companyId: '',
      clientOrgId: '',
      reason: 'no confident client/company match',
    })
  })
})
