import {
  getResearchPropertyActionPolicy,
  projectPropertyForPartner,
  projectResearchEvidenceForPartner,
  projectResearchForPartner,
  projectResearchReportForPartner,
} from '@/lib/cross-org/research-properties-adapter'
import { resolvePrejoinResourceAdapter } from '@/lib/cross-org/prejoin-resource-adapter'

describe('research/properties cross-org collaboration adapter', () => {
  it('maps the only supported research actions to explicit named-user grants', () => {
    for (const action of ['view', 'comment', 'contribute', 'approve']) {
      expect(getResearchPropertyActionPolicy('research', action)).toEqual({
        allowed: true,
        requiredCapability: 'research',
        requireNamedUser: true,
      })
    }
    expect(getResearchPropertyActionPolicy('research', 'attachment')).toEqual({
      allowed: false,
      reason: 'ATTACHMENT_DENIED',
    })
    expect(getResearchPropertyActionPolicy('research', 'export')).toEqual({
      allowed: false,
      reason: 'OWNER_ONLY_ACTION',
    })
  })

  it('restricts properties to named-user view/comment access and denies sensitive controls', () => {
    expect(getResearchPropertyActionPolicy('property', 'view')).toEqual({
      allowed: true,
      requiredCapability: 'properties',
      requireNamedUser: true,
    })
    expect(getResearchPropertyActionPolicy('property', 'comment')).toEqual({
      allowed: true,
      requiredCapability: 'properties',
      requireNamedUser: true,
    })
    for (const action of ['contribute', 'approve', 'rotate_ingest_key', 'configure', 'pull_metrics', 'attachment']) {
      expect(getResearchPropertyActionPolicy('property', action)).toEqual({
        allowed: false,
        reason: action === 'attachment' ? 'ATTACHMENT_DENIED' : 'OWNER_ONLY_ACTION',
      })
    }
  })

  it('uses existing exact-resource pre-join claim contracts only for enforced safe research/property view/comment grants', () => {
    // Fail-closed until research/property main-tree handlers call CrossOrgPolicyService.
    expect(resolvePrejoinResourceAdapter('research', ['view', 'comment'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('property', ['view', 'comment'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('research', ['contribute'])).toBeNull()
    expect(resolvePrejoinResourceAdapter('property', ['approve'])).toBeNull()
  })

  it('projects research summaries and reports through a fixed allowlist plus item grants', () => {
    const record = {
      id: 'research-1',
      title: 'Competitor review',
      kind: 'competitor',
      status: 'verified',
      visibility: 'internal',
      summary: 'Safe executive summary',
      tags: ['market'],
      findings: [
        { id: 'finding-approved', title: 'Safe finding', body: 'Safe body', sourceIds: ['source-1'] },
        { id: 'finding-private', title: 'Private finding', body: 'Private body' },
      ],
      recommendations: [{ id: 'recommendation-approved', title: 'Safe recommendation', body: 'Safe next step' }],
      notesMarkdown: 'Internal working notes',
      designContext: { strategy: 'internal' },
      linked: { companyId: 'crm-secret' },
      obsidian: { path: 'private/path' },
      createdBy: 'owner-user',
    }
    const projection = { fields: null, items: ['finding-approved', 'recommendation-approved'] }

    const item = projectResearchForPartner(record, projection)
    expect(item).toEqual(expect.objectContaining({
      id: 'research-1',
      title: 'Competitor review',
      findings: [{ id: 'finding-approved', title: 'Safe finding', body: 'Safe body' }],
      recommendations: [{ id: 'recommendation-approved', title: 'Safe recommendation', body: 'Safe next step' }],
    }))
    for (const privateField of ['notesMarkdown', 'designContext', 'linked', 'obsidian', 'createdBy']) {
      expect(item).not.toHaveProperty(privateField)
    }
    expect(projectResearchReportForPartner(record, projection)).toEqual(item)
    expect(projectResearchForPartner(record, { fields: ['title'], items: null })).toEqual({ title: 'Competitor review' })
  })

  it('never exposes raw research evidence, source metadata, media, or attachment locators', () => {
    const evidence = projectResearchEvidenceForPartner({
      id: 'source-1',
      title: 'Public source',
      type: 'url',
      url: 'https://example.test/public',
      excerpt: 'Safe excerpt',
      sourceDate: '2026-08-09',
      publisher: 'Example',
      confidence: 'high',
      verified: true,
      rawText: 'Full scraped content',
      metadata: { apiKey: 'never-share' },
      mediaUrl: 'https://storage.test/private',
      attachmentPath: 'private/source.pdf',
    }, { fields: null, items: null })

    expect(evidence).toEqual({
      id: 'source-1', title: 'Public source', type: 'url', url: 'https://example.test/public',
      excerpt: 'Safe excerpt', sourceDate: '2026-08-09', publisher: 'Example', confidence: 'high', verified: true,
    })
  })

  it('returns a static property DTO even for an unrestricted legacy grant', () => {
    const property = projectPropertyForPartner({
      id: 'property-1',
      name: 'Public site',
      domain: 'example.test',
      type: 'web',
      status: 'active',
      config: {
        siteUrl: 'https://example.test',
        appStoreUrl: 'https://apps.apple.com/example',
        playStoreUrl: 'https://play.google.com/example',
        primaryCtaUrl: 'https://example.test/signup',
        killSwitch: false,
        featureFlags: { experimental: true },
        customConfig: { secret: 'private' },
        revenue: { ga4PropertyId: 'private', googleAdsCustomerId: 'private' },
      },
      ingestKey: 'credential',
      conversionSequenceId: 'sequence-private',
      emailSenderDomain: 'private.example.test',
      creatorLinkPrefix: 'https://example.test/ref/',
      createdBy: 'owner-user',
    }, { fields: null, items: null })

    expect(property).toEqual({
      id: 'property-1', name: 'Public site', domain: 'example.test', type: 'web', status: 'active',
      config: {
        siteUrl: 'https://example.test', appStoreUrl: 'https://apps.apple.com/example',
        playStoreUrl: 'https://play.google.com/example', primaryCtaUrl: 'https://example.test/signup',
      },
    })
    expect(projectPropertyForPartner(property, { fields: ['name', 'config'], items: null })).toEqual({
      name: 'Public site',
      config: {
        siteUrl: 'https://example.test', appStoreUrl: 'https://apps.apple.com/example',
        playStoreUrl: 'https://play.google.com/example', primaryCtaUrl: 'https://example.test/signup',
      },
    })
  })
})
