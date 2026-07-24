import {
  buildCoworkPaths,
  buildCoworkWorkspaceId,
  isLegacyFlatCoworkPath,
  resolveCoworkNestingOrgSlug,
  rewriteLegacyFlatCoworkPath,
  sanitizeCoworkNestingSlug,
} from '@/lib/client-provisioning/cowork-paths'

describe('cowork-paths', () => {
  it('nests platform owner workspaces under partners with historical workspace ids', () => {
    const paths = buildCoworkPaths({
      folderName: 'Hunt and Gun',
      domain: 'hunt-and-gun',
      orgId: 'pib-platform-owner',
    })

    expect(paths).toMatchObject({
      nestingOrgSlug: 'partners',
      workspaceId: 'hunt-and-gun',
      orgSlug: 'partners',
      relativeFromCoworkRoot: 'partners/Hunt and Gun',
      localPath: '~/Cowork/partners/Hunt and Gun',
      vpsPath: '/var/lib/hermes/Cowork/partners/Hunt and Gun',
      localAgentDomainPath: '~/Cowork/Cowork/agents/hunt-and-gun',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/hunt-and-gun',
    })
    expect(resolveCoworkNestingOrgSlug({ orgId: 'pib-platform-owner' })).toBe('partners')
    expect(buildCoworkWorkspaceId('partners', 'hunt-and-gun')).toBe('hunt-and-gun')
  })

  it('nests tenant orgs under their slug with a prefixed workspaceId', () => {
    const paths = buildCoworkPaths({
      folderName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'org_123',
      orgSlug: 'acme',
      platformOwned: false,
    })

    expect(paths).toMatchObject({
      nestingOrgSlug: 'acme',
      workspaceId: 'acme__acme-inc',
      relativeFromCoworkRoot: 'acme/Acme Inc',
      localPath: '~/Cowork/acme/Acme Inc',
      vpsPath: '/var/lib/hermes/Cowork/acme/Acme Inc',
      agentDomainPath: '/var/lib/hermes/Cowork/Cowork/agents/acme-inc',
    })
  })

  it('falls back to a sanitized orgId when tenant orgSlug is omitted', () => {
    expect(resolveCoworkNestingOrgSlug({ orgId: 'org_123' })).toBe('org-123')
    expect(buildCoworkPaths({
      folderName: 'Acme Inc',
      domain: 'acme-inc',
      orgId: 'org_123',
    })).toMatchObject({
      nestingOrgSlug: 'org-123',
      workspaceId: 'org-123__acme-inc',
      localPath: '~/Cowork/org-123/Acme Inc',
    })
  })

  it('detects and rewrites legacy flat Cowork paths', () => {
    expect(isLegacyFlatCoworkPath('~/Cowork/Hunt and Gun')).toBe(true)
    expect(isLegacyFlatCoworkPath('/var/lib/hermes/Cowork/AHS Law')).toBe(true)
    expect(isLegacyFlatCoworkPath('/Users/peetstander/Cowork/Acme')).toBe(true)
    expect(isLegacyFlatCoworkPath('~/Cowork/partners/Hunt and Gun')).toBe(false)
    expect(isLegacyFlatCoworkPath('~/Cowork/Cowork/agents/partners')).toBe(false)
    expect(isLegacyFlatCoworkPath('~/Cowork/partners')).toBe(false)

    expect(rewriteLegacyFlatCoworkPath('~/Cowork/Hunt and Gun')).toBe('~/Cowork/partners/Hunt and Gun')
    expect(rewriteLegacyFlatCoworkPath('/var/lib/hermes/Cowork/Partners in Biz')).toBe(
      '/var/lib/hermes/Cowork/partners/Partners in Biz',
    )
    expect(rewriteLegacyFlatCoworkPath('/Users/peetstander/Cowork/AHS Law/projects/p1')).toBe(
      '/Users/peetstander/Cowork/partners/AHS Law/projects/p1',
    )
    expect(rewriteLegacyFlatCoworkPath('~/Cowork/partners/Hunt and Gun')).toBe('~/Cowork/partners/Hunt and Gun')
    expect(rewriteLegacyFlatCoworkPath('~/Cowork/Cowork/agents/partners')).toBe('~/Cowork/Cowork/agents/partners')
    expect(rewriteLegacyFlatCoworkPath('~/Cowork/Hunt and Gun', 'acme')).toBe('~/Cowork/acme/Hunt and Gun')
    expect(rewriteLegacyFlatCoworkPath('/tmp/elsewhere')).toBeNull()
  })

  it('rejects invalid folder names and nesting slugs', () => {
    expect(() => sanitizeCoworkNestingSlug('../escape')).toThrow(/Invalid Cowork nesting slug/)
    expect(() => sanitizeCoworkNestingSlug('')).toThrow(/Invalid Cowork nesting slug/)
    expect(() => sanitizeCoworkNestingSlug('!!!')).toThrow(/Invalid Cowork nesting slug/)
    expect(() => buildCoworkPaths({
      folderName: '../escape',
      domain: 'escape',
      orgId: 'pib-platform-owner',
    })).toThrow(/Invalid Cowork folderName/)
    expect(() => buildCoworkPaths({
      folderName: 'Acme/Inc',
      domain: 'acme',
      orgId: 'pib-platform-owner',
    })).toThrow(/Invalid Cowork folderName/)
    expect(() => buildCoworkPaths({
      folderName: '',
      domain: 'acme',
      orgId: 'pib-platform-owner',
    })).toThrow(/Cowork folderName is required/)
    expect(() => resolveCoworkNestingOrgSlug({ orgId: '' })).toThrow(/orgId is required/)
  })
})
